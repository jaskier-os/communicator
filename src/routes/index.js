import Router from '@koa/router';
import promptRoutes from './promptRoutes.js';
import healthRoutes from './healthRoutes.js';
import vmRoutes from './vmRoutes.js';
import chatRoutes from './chatRoutes.js';
import credentialRoutes from './credentialRoutes.js';

const router = new Router();

// API prefix
router.prefix('/api');

// Health check routes
router.use(healthRoutes.routes());

// OpenAI-compatible chat completions endpoint
router.use('/chat', chatRoutes.routes());

// Prompt routes
router.use('/prompts', promptRoutes.routes());

// VM management routes
router.use('/vm', vmRoutes.routes());

// Credential push route
router.use('/credentials', credentialRoutes.routes());

// Welcome route
router.get('/', (ctx) => {
  ctx.body = {
    message: 'LLM Communicator API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      healthDetailed: '/api/health/detailed',
      models: '/api/health/models',
      prompt: '/api/prompts',
      chat: '/api/prompts/chat',
      chatCompletions: '/api/chat/completions',
      vmStatus: '/api/vm/status',
      vmStart: '/api/vm/start',
      vmStop: '/api/vm/stop',
      credentialsPush: '/api/credentials/push',
    },
  };
});

export default router;
