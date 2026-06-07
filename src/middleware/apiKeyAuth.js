import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * API Key Authentication Middleware
 * Validates API key from Authorization header or x-api-key header
 */
export default async function apiKeyAuth(ctx, next) {
  // Skip auth for health check endpoints
  if (ctx.path === '/api/health' || ctx.path === '/api/health/detailed') {
    return await next();
  }

  // Get API key from Authorization header (Bearer token) or x-api-key header
  const authHeader = ctx.get('Authorization');
  const apiKeyHeader = ctx.get('x-api-key');

  let providedKey = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7);
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader;
  }

  // Check if API key is provided
  if (!providedKey) {
    ctx.status = 401;
    ctx.body = {
      error: {
        message: 'Missing API key',
        status: 401
      }
    };
    logger.warn('API request rejected: Missing API key', {
      ip: ctx.ip,
      path: ctx.path,
      method: ctx.method
    });
    return;
  }

  // Validate API key
  const validKeys = config.auth.apiKeys;

  if (!validKeys.includes(providedKey)) {
    ctx.status = 403;
    ctx.body = {
      error: {
        message: 'Invalid API key',
        status: 403
      }
    };
    logger.warn('API request rejected: Invalid API key', {
      ip: ctx.ip,
      path: ctx.path,
      method: ctx.method
    });
    return;
  }

  // API key is valid, proceed
  logger.debug('API key validated successfully', {
    ip: ctx.ip,
    path: ctx.path
  });

  await next();
}
