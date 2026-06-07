import { Transform } from 'stream';

/**
 * Transform Anthropic SSE stream events to OpenAI SSE format
 */
function transformAnthropicEventToOpenAI(event, messageId, currentToolUse, usageTracker) {
  const chunks = [];

  switch (event.type) {
    case 'message_start':
      // Track input tokens from message_start
      if (event.message?.usage) {
        usageTracker.input_tokens = event.message.usage.input_tokens || 0;
        usageTracker.cache_creation_input_tokens = event.message.usage.cache_creation_input_tokens || 0;
        usageTracker.cache_read_input_tokens = event.message.usage.cache_read_input_tokens || 0;
      }
      chunks.push({
        id: messageId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: event.message?.model || 'unknown',
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null
        }]
      });
      break;

    case 'content_block_delta':
      if (event.delta?.type === 'text_delta') {
        chunks.push({
          id: messageId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'unknown',
          choices: [{
            index: 0,
            delta: { content: event.delta.text },
            finish_reason: null
          }]
        });
      } else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
        // Tool argument streaming
        chunks.push({
          id: messageId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'unknown',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: currentToolUse.index,
                function: { arguments: event.delta.partial_json }
              }]
            },
            finish_reason: null
          }]
        });
      }
      break;

    case 'content_block_start':
      if (event.content_block?.type === 'tool_use') {
        chunks.push({
          id: messageId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'unknown',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: event.index,
                id: event.content_block.id,
                type: 'function',
                function: {
                  name: event.content_block.name,
                  arguments: ''
                }
              }]
            },
            finish_reason: null
          }]
        });
      }
      break;

    case 'message_stop': {
      // Map stop_reason to finish_reason
      const finishReasonMap = {
        'end_turn': 'stop',
        'tool_use': 'tool_calls',
        'max_tokens': 'length',
        'stop_sequence': 'stop'
      };
      chunks.push({
        id: messageId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'unknown',
        choices: [{
          index: 0,
          delta: {},
          finish_reason: finishReasonMap[event.message?.stop_reason] || 'stop'
        }]
      });
      break;
    }

    case 'message_delta':
      // Track output tokens from message_delta
      if (event.usage) {
        usageTracker.output_tokens = event.usage.output_tokens || 0;
      }
      // Handle message_delta which may contain stop_reason
      if (event.delta?.stop_reason) {
        const finishReasonMap = {
          'end_turn': 'stop',
          'tool_use': 'tool_calls',
          'max_tokens': 'length',
          'stop_sequence': 'stop'
        };
        chunks.push({
          id: messageId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'unknown',
          choices: [{
            index: 0,
            delta: {},
            finish_reason: finishReasonMap[event.delta.stop_reason] || 'stop'
          }]
        });
      }
      break;
  }

  return chunks;
}

/**
 * Create a Transform stream that converts Anthropic SSE to OpenAI SSE format
 */
export function createAnthropicToOpenAIStreamTransformer() {
  let currentToolUse = null;
  let currentThinking = null;
  const thinkingBlocks = [];
  const messageId = `chatcmpl-${Date.now()}`;
  let buffer = '';
  const usageTracker = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  };

  return new Transform({
    objectMode: false,

    transform(chunk, encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('event:')) continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const openaiChunks = transformAnthropicEventToOpenAI(data, messageId, currentToolUse, usageTracker);

            for (const openaiChunk of openaiChunks) {
              this.push(`data: ${JSON.stringify(openaiChunk)}\n\n`);
            }

            // Track tool_use state
            if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
              currentToolUse = {
                id: data.content_block.id,
                name: data.content_block.name,
                index: data.index
              };
            } else if (data.type === 'content_block_start' && data.content_block?.type === 'thinking') {
              currentThinking = { thinking: '', signature: '' };
            } else if (data.type === 'content_block_delta' && data.delta?.type === 'thinking_delta' && currentThinking) {
              currentThinking.thinking += data.delta.thinking || '';
            } else if (data.type === 'content_block_delta' && data.delta?.type === 'signature_delta' && currentThinking) {
              currentThinking.signature += data.delta.signature || '';
            } else if (data.type === 'content_block_stop') {
              if (currentThinking) {
                thinkingBlocks.push({ type: 'thinking', ...currentThinking });
                currentThinking = null;
              }
              currentToolUse = null;
            }
          } catch (e) {
            // Skip malformed JSON - don't break the stream
          }
        }
      }
      callback();
    },

    flush(callback) {
      // Process any remaining buffer content
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const openaiChunks = transformAnthropicEventToOpenAI(data, messageId, currentToolUse, usageTracker);
            for (const openaiChunk of openaiChunks) {
              this.push(`data: ${JSON.stringify(openaiChunk)}\n\n`);
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
      // Emit final chunk with accumulated usage and thinking blocks before [DONE]
      const usageChunk = {
        id: messageId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'unknown',
        choices: [],
        usage: {
          prompt_tokens: usageTracker.input_tokens,
          completion_tokens: usageTracker.output_tokens,
          total_tokens: usageTracker.input_tokens + usageTracker.output_tokens,
          cache_creation_input_tokens: usageTracker.cache_creation_input_tokens,
          cache_read_input_tokens: usageTracker.cache_read_input_tokens
        }
      };
      if (thinkingBlocks.length > 0) {
        usageChunk.thinking_blocks = thinkingBlocks;
      }
      this.push(`data: ${JSON.stringify(usageChunk)}\n\n`);
      this.push('data: [DONE]\n\n');
      callback();
    }
  });
}
