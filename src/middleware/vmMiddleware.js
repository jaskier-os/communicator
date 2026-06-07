import config from '../config/index.js';
import logger from '../utils/logger.js';
import vmManager from '../services/vmManager.js';

/**
 * VM Middleware
 * Ensures VM is ready before processing requests
 * Queues requests if VM is not ready
 */
export default async (ctx, next) => {
  // Skip if VM management is not enabled
  if (!config.yandexCloud.enabled) {
    return next();
  }

  // Skip for health check endpoints
  if (ctx.path === '/health' || ctx.path === '/api/health') {
    return next();
  }

  // Skip for VM management endpoints (status, start, stop)
  if (ctx.path.startsWith('/api/vm')) {
    return next();
  }

  try {
    logger.debug('VM middleware: ensuring VM is ready', { path: ctx.path });

    // Queue the request and ensure VM is ready
    await vmManager.queueRequest(async () => {
      // Execute the next middleware/route handler
      await next();
    });
  } catch (error) {
    logger.error('VM middleware error:', error);

    // If VM failed to start or become ready, return an error
    ctx.status = 503;
    ctx.body = {
      error: {
        message: 'Service temporarily unavailable - VM startup failed',
        details: error.message,
      },
    };
  }
};
