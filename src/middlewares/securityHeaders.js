// src/middlewares/securityHeaders.js
const helmet = require('helmet');

module.exports = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.cloudinary.com", "https://*.imagekit.io"],
      connectSrc: ["'self'", "ws:", "http://localhost:*", "https://localhost:*"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    },
  },
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
});
