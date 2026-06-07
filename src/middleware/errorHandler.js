import logger from '../utils/logger.js';

export default async function errorHandler(ctx, next) {
  try {
    await next();
  } catch (error) {
    logger.error('Error caught in middleware:', error);

    const isDev = process.env.NODE_ENV === 'development';

    ctx.status = error.status || 500;
    ctx.body = {
      error: {
        message: error.message,
        status: ctx.status,
        ...(isDev && { stack: error.stack })
      }
    };

    ctx.app.emit('error', error, ctx);
  }
}