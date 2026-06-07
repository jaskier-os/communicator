import Router from '@koa/router';
import llmProvider from '../providers/providerFactory.js';
import config from '../config/index.js';
import { ClaudeCredentials } from '../lib/claude_credentials.js';

const router = new Router();

/**
 * GET /api/health
 * Basic health check
 */
router.get('/health', async (ctx) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.server.nodeEnv,
    service: 'llm-communicator',
  };

  ctx.body = health;
});

/**
 * GET /api/health/detailed
 * Detailed health check including LLM API status
 */
router.get('/health/detailed', async (ctx) => {
  const llmHealth = await llmProvider.healthCheck();

  const health = {
    status: llmHealth.status === 'healthy' || llmHealth.status === 'connected' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.server.nodeEnv,
    service: 'llm-communicator',
    dependencies: {
      llmApi: llmHealth,
    },
    oauth: await ClaudeCredentials.getStatus(),
    system: {
      memory: {
        used: process.memoryUsage(),
        free: process.memoryUsage().heapTotal - process.memoryUsage().heapUsed,
      },
      nodeVersion: process.version,
    },
  };

  ctx.body = health;
});

/**
 * GET /api/health/ready
 * Readiness probe for k8s
 */
router.get('/health/ready', async (ctx) => {
  try {
    const llmHealth = await llmProvider.healthCheck();

    if (llmHealth.status === 'healthy' || llmHealth.status === 'connected') {
      ctx.status = 200;
      ctx.body = { ready: true };
    } else {
      ctx.status = 503;
      ctx.body = { ready: false, reason: 'LLM API not available' };
    }
  } catch (error) {
    ctx.status = 503;
    ctx.body = { ready: false, reason: error.message };
  }
});

/**
 * GET /api/health/live
 * Liveness probe for k8s
 */
router.get('/health/live', (ctx) => {
  ctx.status = 200;
  ctx.body = { alive: true };
});

/**
 * GET /api/health/models
 * Get available models from vLLM
 */
router.get('/health/models', async (ctx) => {
  try {
    const models = await llmProvider.getAvailableModels();

    ctx.status = 200;
    ctx.body = {
      success: true,
      timestamp: new Date().toISOString(),
      llmUrl: config.llm.url,
      models: models,
    };
  } catch (error) {
    ctx.status = error.status || 500;
    ctx.body = {
      success: false,
      error: {
        message: error.message,
        details: 'Unable to fetch models from vLLM',
      },
    };
  }
});

export default router;