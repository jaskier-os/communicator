import Router from '@koa/router';
import Joi from 'joi';
import llmProvider from '../providers/providerFactory.js';
import logger from '../utils/logger.js';

const router = new Router();

const LANGUAGE_INSTRUCTION = 'Always reply in English. The only exception is tool call arguments where the task requires another language.';

function injectLanguageInstruction(messages) {
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg) {
    if (typeof systemMsg.content === 'string') {
      systemMsg.content = LANGUAGE_INSTRUCTION + '\n' + systemMsg.content;
    }
  } else {
    messages.unshift({ role: 'system', content: LANGUAGE_INSTRUCTION });
  }
  return messages;
}

// Validation schema for OpenAI-compatible chat completions
const chatCompletionsSchema = Joi.object({
  messages: Joi.array().items(
    Joi.object({
      role: Joi.string().valid('system', 'user', 'assistant', 'tool').required(),
      content: Joi.alternatives().try(
        Joi.string().allow(''),
        Joi.array().items(
          Joi.object({
            type: Joi.string().required(),
            text: Joi.string().when('type', {
              is: 'text',
              then: Joi.required(),
              otherwise: Joi.optional(),
            }),
          }).unknown(true)
        )
      ).when('role', {
        is: 'tool',
        then: Joi.required(),
        otherwise: Joi.optional()
      }),
      tool_calls: Joi.array().items(
        Joi.object({
          id: Joi.string().required(),
          type: Joi.string().valid('function').required(),
          function: Joi.object({
            name: Joi.string().required(),
            arguments: Joi.string().required(),
          }).required(),
        })
      ).optional(),
      tool_call_id: Joi.string().when('role', {
        is: 'tool',
        then: Joi.required(),
        otherwise: Joi.optional()
      }),
      thinking_blocks: Joi.array().items(Joi.object().unknown(true)).optional(),
    })
  ).required().min(1),
  model: Joi.string().optional(),
  max_tokens: Joi.number().optional().min(1).max(999999999),
  temperature: Joi.number().optional().min(0).max(2),
  stream: Joi.boolean().optional(),
  tools: Joi.array().items(Joi.object().unknown(true)).optional(),
  tool_choice: Joi.alternatives().try(
    Joi.string(),
    Joi.object().unknown(true)
  ).optional(),
  effort: Joi.string().valid('low', 'medium', 'high', 'max').optional(),
}).unknown(true);

/**
 * POST /api/chat/completions
 * OpenAI-compatible chat completions endpoint
 */
router.post('/completions', async (ctx) => {
  const { error, value } = chatCompletionsSchema.validate(ctx.request.body);

  if (error) {
    // Log the problematic message for debugging
    const problemIndex = error.details[0]?.path?.[1];
    logger.error('Chat validation error', {
      details: error.details.map(d => d.message),
      problemMessage: problemIndex !== undefined ? ctx.request.body.messages[problemIndex] : null,
      allMessages: ctx.request.body.messages?.map((m, i) => ({
        index: i,
        role: m.role,
        contentType: typeof m.content,
        contentLength: typeof m.content === 'string' ? m.content.length : (Array.isArray(m.content) ? m.content.length : 'N/A'),
        hasToolCalls: !!m.tool_calls
      }))
    });
    ctx.status = 400;
    ctx.body = {
      error: {
        message: 'Validation error',
        details: error.details.map(d => d.message),
      },
    };
    return;
  }

  // Create AbortController for request cancellation
  const controller = new AbortController();

  // Handle client disconnect
  ctx.req.on('close', () => {
    if (!ctx.req.complete) {
      logger.info('Client disconnected, aborting request');
      controller.abort();
    }
  });

  try {
    injectLanguageInstruction(value.messages);

    // Normalize field names (OpenAI uses max_tokens, internal uses maxTokens)
    const normalizedValue = {
      ...value,
      maxTokens: value.max_tokens || value.maxTokens,
    };

    logger.info('Processing chat completions request', {
      model: normalizedValue.model,
      messageCount: normalizedValue.messages.length,
      stream: normalizedValue.stream,
    });

    if (normalizedValue.stream) {
      // Handle streaming response
      ctx.response.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no',
      });

      ctx.status = 200;
      ctx.respond = false;

      const stream = await llmProvider.sendChatCompletion({
        ...normalizedValue,
        signal: controller.signal,
      });

      stream.pipe(ctx.res);

      stream.on('error', (err) => {
        if (!err.cancelled) {
          logger.error('Stream error:', err);
        }
        if (!ctx.res.headersSent) {
          ctx.res.writeHead(500);
        }
        ctx.res.end();
      });

      stream.on('end', () => {
        ctx.res.end();
      });
    } else {
      // Regular response
      const result = await llmProvider.sendChatCompletion({
        ...normalizedValue,
        stream: false,
        signal: controller.signal,
      });

      ctx.body = result;
    }
  } catch (error) {
    if (error.cancelled) {
      logger.info('Chat completions request was cancelled');
      ctx.status = 499;
      ctx.body = {
        error: {
          message: 'Request was cancelled',
        },
      };
    } else {
      logger.error('Error processing chat completions:', error);
      ctx.status = error.status || 500;
      ctx.body = {
        error: {
          message: error.message,
          ...(error.data && { details: error.data }),
        },
      };
    }
  }
});

export default router;
