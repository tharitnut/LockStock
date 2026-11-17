import rateLimit from 'express-rate-limit';

const rateLimitHandler = (req, res) => {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later',
      details: null,
    },
  });
};

/**
 * Rate limiter for /auth/login: 10 requests per minute per IP
 */
export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: (req) => req.headers['x-bypass-rate-limit'] === 'true',
});

/**
 * Rate limiter for POST /orders: 30 requests per minute per user or IP
 */
export const orderRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `user_${req.user.id}` : req.ip),
  handler: rateLimitHandler,
  skip: (req) => req.headers['x-bypass-rate-limit'] === 'true',
});
