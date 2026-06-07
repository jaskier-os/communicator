/**
 * Transform OpenAI format request to Anthropic format
 */
export function transformOpenAIToAnthropicRequest(openaiRequest) {
  const {
    messages,
    model,
    max_tokens,
    temperature,
    tools,
    tool_choice,
    stream,
    effort
  } = openaiRequest;

  const anthropicMessages = [];

  for (const message of messages) {
    if (message.role === 'system') {
      // System messages are demoted to user turns. The only system block that
      // may reach inference is enforced downstream in gatewayProvider.
      const text = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content);
      if (text && text.trim()) {
        anthropicMessages.push({
          role: 'user',
          content: [{ type: 'text', text }]
        });
      }
    } else if (message.role === 'tool') {
      // Tool responses become tool_result blocks in user messages
      // Ensure content is never empty
      const toolContent = message.content || '{"error": "No result"}';
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: toolContent
        }]
      });
    } else if (message.role === 'assistant') {
      const contentBlocks = [];

      // Re-inject thinking blocks from previous response (must come first)
      if (message.thinking_blocks?.length > 0) {
        for (const tb of message.thinking_blocks) {
          contentBlocks.push({
            type: 'thinking',
            thinking: tb.thinking || '',
            signature: tb.signature || ''
          });
        }
      }

      // Add text content if present (check for non-empty string)
      if (message.content && (typeof message.content !== 'string' || message.content.trim())) {
        contentBlocks.push({
          type: 'text',
          text: typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content)
        });
      }

      // Convert tool_calls to tool_use blocks
      if (message.tool_calls?.length > 0) {
        for (const toolCall of message.tool_calls) {
          const args = typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;

          contentBlocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: args
          });
        }
      }

      // Anthropic requires non-empty content - add placeholder if needed
      if (contentBlocks.length === 0) {
        contentBlocks.push({
          type: 'text',
          text: '...'
        });
      }

      anthropicMessages.push({
        role: 'assistant',
        content: contentBlocks
      });
    } else if (message.role === 'user') {
      // User content must be array of blocks
      let content;
      if (typeof message.content === 'string') {
        content = [{ type: 'text', text: message.content || '...' }];
      } else if (Array.isArray(message.content)) {
        content = message.content.map(c => {
          if (typeof c === 'string') return { type: 'text', text: c || '...' };
          if (c.type === 'text') return { ...c, text: c.text || '...' };
          // Handle image_url for vision
          if (c.type === 'image_url') {
            const imageUrl = c.image_url.url;

            // Check if it's a base64 data URL
            if (imageUrl.startsWith('data:')) {
              // Parse data URL: data:image/jpeg;base64,/9j/4AAQ...
              const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: matches[1],
                    data: matches[2]
                  }
                };
              }
            }

            // Regular URL
            return {
              type: 'image',
              source: {
                type: 'url',
                url: imageUrl
              }
            };
          }
          return c;
        });
        // Ensure at least one block
        if (content.length === 0) {
          content = [{ type: 'text', text: '...' }];
        }
      } else {
        content = [{ type: 'text', text: String(message.content || '...') }];
      }

      anthropicMessages.push({
        role: 'user',
        content
      });
    } else {
      // Fallback for unknown roles
      anthropicMessages.push({
        role: message.role,
        content: typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : message.content
      });
    }
  }

  // Build Anthropic request
  const anthropicRequest = {
    model,
    max_tokens: max_tokens || 4096,
    messages: anthropicMessages,
    stream: stream || false
  };

  // Add cache_control to last user message for prompt caching
  if (anthropicMessages.length > 0) {
    for (let i = anthropicMessages.length - 1; i >= 0; i--) {
      if (anthropicMessages[i].role === 'user' && Array.isArray(anthropicMessages[i].content)) {
        const blocks = anthropicMessages[i].content;
        if (blocks.length > 0) {
          blocks[blocks.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
        }
        break;
      }
    }
  }

  // Adaptive thinking for non-Haiku models (Haiku doesn't support it)
  const isHaiku = model && model.toLowerCase().includes('haiku');
  if (!isHaiku) {
    anthropicRequest.thinking = { type: 'adaptive' };
  }

  // Effort level for Opus models (low | medium | high | max).
  // Defaults to medium. 'max' is Opus 4.8 only - clamp to high otherwise.
  if (model && model.toLowerCase().includes('opus')) {
    const requested = typeof effort === 'string' ? effort.toLowerCase() : 'medium';
    let level = ['low', 'medium', 'high', 'max'].includes(requested) ? requested : 'medium';
    if (level === 'max' && !model.toLowerCase().includes('opus-4-8')) {
      level = 'high';
    }
    anthropicRequest.output_config = { effort: level };
  }

  // Transform tools: OpenAI uses 'parameters', Anthropic uses 'input_schema'
  if (tools?.length > 0) {
    anthropicRequest.tools = tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }));
  }

  if (temperature !== undefined) {
    anthropicRequest.temperature = temperature;
  }

  return anthropicRequest;
}
