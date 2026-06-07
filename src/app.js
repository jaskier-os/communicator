import Koa from 'koa';
import cors from '@koa/cors';
import bodyParser from 'koa-bodyparser';
import helmet from 'koa-helmet';

import config from './config/index.js';
import logger from './utils/logger.js';
import errorHandler from './middleware/errorHandler.js';
import apiKeyAuth from './middleware/apiKeyAuth.js';
import vmMiddleware from './middleware/vmMiddleware.js';
import router from './routes/index.js';

const app = new Koa();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: (ctx) => {
    const origin = ctx.get('Origin');
    if (config.cors.origins.includes('*') || config.cors.origins.includes(origin)) {
      return origin;
    }
    return config.cors.origins[0];
  },
  credentials: true,
}));

// Compression disabled to avoid circular reference errors with streaming

// Request logging (only in development)
if (config.server.nodeEnv === 'development') {
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    // Skip logging for streaming responses (ctx.respond = false) to avoid circular reference errors
    if (ctx.respond !== false) {
      const ms = Date.now() - start;
      console.log(`  ${ctx.method} ${ctx.url} - ${ctx.status} - ${ms}ms`);
    }
  });
}

// Body parser
app.use(bodyParser({
  jsonLimit: '10mb',
  textLimit: '10mb',
}));

// Custom middleware
app.use(errorHandler);
app.use(apiKeyAuth);
app.use(vmMiddleware);

// Routes
app.use(router.routes());
app.use(router.allowedMethods());

// Global error listener
app.on('error', (error, ctx) => {
  if (ctx.status !== 404) {
    logger.error('Application error:', {
      error: error.message,
      stack: error.stack,
      url: ctx.url,
      method: ctx.method,
      ip: ctx.ip,
    });
  }
});

export default app;