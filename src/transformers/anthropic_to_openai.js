/**
 * Transform Anthropic format response to OpenAI format
 */
export function transformAnthropicToOpenAIResponse(anthropicResponse) {
  const { id, model, content, usage, stop_reason } = anthropicResponse;

  // Extract text content, tool_use blocks, and thinking blocks
  let textContent = '';
  const toolCalls = [];
  const thinkingBlocks = [];

  for (const block of content || []) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input)
        }
      });
    } else if (block.type === 'thinking') {
      // Preserve thinking blocks with signatures for conversation continuity
      thinkingBlocks.push({
        type: 'thinking',
        thinking: block.thinking || '',
        signature: block.signature || ''
      });
    }
  }

  // Build OpenAI-compatible response
  const message = {
    role: 'assistant',
    content: textContent || null
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  // Attach thinking blocks so the client can send them back in history
  if (thinkingBlocks.length > 0) {
    message.thinking_blocks = thinkingBlocks;
  }

  // Map stop_reason to finish_reason
  const finishReasonMap = {
    'end_turn': 'stop',
    'tool_use': 'tool_calls',
    'max_tokens': 'length',
    'stop_sequence': 'stop',
    'refusal': 'content_filter'
  };

  return {
    id: id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: finishReasonMap[stop_reason] || 'stop'
    }],
    usage: {
      prompt_tokens: usage?.input_tokens || 0,
      completion_tokens: usage?.output_tokens || 0,
      total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
      cache_creation_input_tokens: usage?.cache_creation_input_tokens || 0,
      cache_read_input_tokens: usage?.cache_read_input_tokens || 0,
      service_tier: usage?.service_tier || null
    }
  };
}
