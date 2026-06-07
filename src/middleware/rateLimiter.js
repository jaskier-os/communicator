import config from '../config/index.js';

const requestCounts = new Map();

export default function rateLimiter() {
  if (!config.rateLimit.enabled) {
    return async (ctx, next) => await next();
  }

  return async (ctx, next) => {
    const identifier = ctx.ip;
    const now = Date.now();
    const windowStart = now - config.rateLimit.windowMs;

    // Get or create request history for this IP
    let requestHistory = requestCounts.get(identifier) || [];

    // Filter out old requests
    requestHistory = requestHistory.filter(timestamp => timestamp > windowStart);

    if (requestHistory.length >= config.rateLimit.maxRequests) {
      ctx.status = 429;
      ctx.body = {
        error: {
          message: 'Too many requests',
          retryAfter: Math.ceil(config.rateLimit.windowMs / 1000)
        }
      };
      return;
    }

    requestHistory.push(now);
    requestCounts.set(identifier, requestHistory);

    // Clean up old entries periodically
    if (Math.random() < 0.01) {
      for (const [key, history] of requestCounts.entries()) {
        const filtered = history.filter(timestamp => timestamp > windowStart);
        if (filtered.length === 0) {
          requestCounts.delete(key);
        } else {
          requestCounts.set(key, filtered);
        }
      }
    }

    await next();
  };
}