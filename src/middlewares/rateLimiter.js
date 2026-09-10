// src/middlewares/rateLimiter.js
// Global request rate limiting using express-rate-limit

const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isDev ? 10000 : 1200, // Generous limit in dev to support multi-provider loads; 1200 in prod matching settings default
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    const p = req.path || '';
    // Never rate limit health checks or base settings endpoints needed on app boot
    if (
      p === '/health' ||
      p === '/api/health' ||
      p === '/api/settings' ||
      p === '/settings' ||
      p === '/api/settings/master-currency' ||
      p === '/settings/master-currency'
    ) {
      return true;
    }
    // In development mode, allow localhost requests without throttling
    if (isDev && (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1' || req.hostname === 'localhost')) {
      return true;
    }
    return false;
  },
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' }
  }
});

module.exports = limiter;

