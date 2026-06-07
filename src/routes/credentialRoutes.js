import Router from '@koa/router';
import { ClaudeCredentials } from '../lib/claude_credentials.js';
import logger from '../utils/logger.js';

const router = new Router();

/**
 * POST /api/credentials/push
 * Push fresh OAuth credentials from an external source.
 * Protected by the same API key auth as all other endpoints.
 */
router.post('/push', async (ctx) => {
  const { accessToken, refreshToken, expiresAt, scopes } = ctx.request.body || {};

  if (!accessToken || !refreshToken || !expiresAt) {
    ctx.status = 400;
    ctx.body = { error: 'Missing required fields: accessToken, refreshToken, expiresAt' };
    return;
  }

  if (typeof expiresAt !== 'number') {
    ctx.status = 400;
    ctx.body = { error: 'expiresAt must be a Unix timestamp in milliseconds' };
    return;
  }

  try {
    await ClaudeCredentials.save({ accessToken, refreshToken, expiresAt, scopes: scopes || [] });
  } catch (error) {
    logger.error('Failed to save pushed credentials:', { error: error.message });
    ctx.status = 500;
    ctx.body = { error: 'Failed to write credentials to disk' };
    return;
  }

  logger.info('OAuth credentials pushed via API', {
    expiresAt: new Date(expiresAt).toISOString(),
  });

  ctx.body = { success: true, expiresAt: new Date(expiresAt).toISOString() };
});

export default router;
