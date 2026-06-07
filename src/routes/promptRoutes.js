import Router from '@koa/router';
import Joi from 'joi';
import llmProvider from '../providers/providerFactory.js';
import logger from '../utils/logger.js';

const router = new Router();

// Validation schemas
const promptSchema = Joi.object({
  prompt: Joi.string().required().min(1).max(10000),
  model: Joi.string().optional(),
  maxTokens: Joi.number().optional().min(1).max(4000),
  temperature: Joi.number().optional().min(0).max(2),
  stream: Joi.boolean().optional(),
  additionalParams: Joi.object().optional(),
});

const chatSchema = Joi.object({
  messages: Joi.array().items(
    Joi.object({
      role: Joi.string().valid('system', 'user', 'assistant', 'tool').required(),
      // Support both string and array format (OpenAI multi-modal API)
      // Content is optional for assistant messages with tool_calls and required for tool messages
      content: Joi.alternatives().try(
        Joi.string(),
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
      // Tool calls for assistant messages
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
      // Tool call ID for tool role messages
      tool_call_id: Joi.string().when('role', {
        is: 'tool',
        then: Joi.required(),
        otherwise: Joi.optional()
      }),
    })
  ).required().min(1),
  model: Joi.string().optional(),
  maxTokens: Joi.number().optional().min(1).max(4000),
  temperature: Joi.number().optional().min(0).max(2),
  stream: Joi.boolean().optional(),
  tools: Joi.array().items(Joi.object().unknown(true)).optional(),
  tool_choice: Joi.alternatives().try(
    Joi.string(),
    Joi.object().unknown(true)
  ).optional(),
  additionalParams: Joi.object().optional(),
});

/**
 * POST /api/prompts
 * Send a simple prompt to the LLM
 */
router.post('/', async (ctx) => {
  const { error, value } = promptSchema.validate(ctx.request.body);

  if (error) {
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
    logger.info('Processing prompt request', {
      model: value.model,
      promptLength: value.prompt.length,
      stream: value.stream,
    });

    if (value.stream) {
      // Handle streaming response
      ctx.response.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      });

      // Set status before streaming
      ctx.status = 200;

      // Important: Tell Koa not to handle the response BEFORE setting body
      ctx.respond = false;

      const stream = await llmProvider.sendPrompt({
        ...value,
        signal: controller.signal,
      });

      // Pipe the stream directly to the raw response
      stream.pipe(ctx.res);

      // Handle stream errors
      stream.on('error', (err) => {
        if (!err.cancelled) {
          logger.error('Stream error:', err);
        }
        if (!ctx.res.headersSent) {
          ctx.res.writeHead(500);
        }
        ctx.res.end();
      });

      // Handle stream end
      stream.on('end', () => {
        ctx.res.end();
      });
    } else {
      // Regular response
      const result = await llmProvider.sendPrompt({
        ...value,
        signal: controller.signal,
      });

      ctx.body = {
        success: true,
        data: result,
      };
    }
  } catch (error) {
    if (error.cancelled) {
      logger.info('Prompt request was cancelled');
      ctx.status = 499;
      ctx.body = {
        error: {
          message: 'Request was cancelled',
        },
      };
    } else {
      logger.error('Error processing prompt:', error);
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

/**
 * POST /api/prompts/chat
 * Send a chat completion request to the LLM
 */
router.post('/chat', async (ctx) => {
  const { error, value } = chatSchema.validate(ctx.request.body);

  if (error) {
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
    logger.info('Processing chat completion request', {
      model: value.model,
      messageCount: value.messages.length,
      stream: value.stream,
    });

    if (value.stream) {
      // Handle streaming response
      ctx.response.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      });

      // Set status before streaming
      ctx.status = 200;

      // Important: Tell Koa not to handle the response BEFORE setting body
      ctx.respond = false;

      const stream = await llmProvider.sendChatCompletion({
        ...value,
        signal: controller.signal,
      });

      // Pipe the stream directly to the raw response
      stream.pipe(ctx.res);

      // Handle stream errors
      stream.on('error', (err) => {
        if (!err.cancelled) {
          logger.error('Stream error:', err);
        }
        if (!ctx.res.headersSent) {
          ctx.res.writeHead(500);
        }
        ctx.res.end();
      });

      // Handle stream end
      stream.on('end', () => {
        ctx.res.end();
      });
    } else {
      // Regular response
      const result = await llmProvider.sendChatCompletion({
        ...value,
        stream: false,
        signal: controller.signal,
      });

      ctx.body = {
        success: true,
        data: result,
      };
    }
  } catch (error) {
    if (error.cancelled) {
      logger.info('Chat completion request was cancelled');
      ctx.status = 499;
      ctx.body = {
        error: {
          message: 'Request was cancelled',
        },
      };
    } else {
      logger.error('Error processing chat completion:', error);
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

/**
 * POST /api/prompts/batch
 * Send multiple prompts at once
 */
router.post('/batch', async (ctx) => {
  const batchSchema = Joi.object({
    prompts: Joi.array().items(promptSchema).required().min(1).max(10),
  });

  const { error, value } = batchSchema.validate(ctx.request.body);

  if (error) {
    ctx.status = 400;
    ctx.body = {
      error: {
        message: 'Validation error',
        details: error.details.map(d => d.message),
      },
    };
    return;
  }

  try {
    logger.info('Processing batch prompt request', {
      count: value.prompts.length,
    });

    const results = await Promise.allSettled(
      value.prompts.map(prompt => llmProvider.sendPrompt(prompt))
    );

    const responses = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return {
          index,
          success: true,
          data: result.value,
        };
      } else {
        return {
          index,
          success: false,
          error: {
            message: result.reason.message,
          },
        };
      }
    });

    ctx.body = {
      success: true,
      data: {
        total: value.prompts.length,
        successful: responses.filter(r => r.success).length,
        failed: responses.filter(r => !r.success).length,
        responses,
      },
    };
  } catch (error) {
    logger.error('Error processing batch prompts:', error);
    ctx.status = error.status || 500;
    ctx.body = {
      error: {
        message: error.message,
      },
    };
  }
});

export default router;