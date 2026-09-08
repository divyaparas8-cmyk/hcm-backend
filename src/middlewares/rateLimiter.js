// src/middlewares/rateLimiter.js
// Global request rate limiting using express-rate-limit
// Limits each IP to 100 requests per minute (configurable)

const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isDev ? 2000 : 300, // higher limit in development to support multi-provider initial loads
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' }
  }
});

module.exports = limiter;
