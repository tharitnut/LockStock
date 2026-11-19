import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validateBody } from '../middleware/validate.js';
import { runOversellDemo } from '../services/demo/oversell.js';

const router = Router();

const demoRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
        details: null,
      },
    });
  },
  skip: (req) => req.headers['x-bypass-rate-limit'] === 'true',
});

const oversellBodySchema = z.object({
  stock: z
    .preprocess(
      (val) => (val !== undefined && val !== '' ? Number(val) : 5),
      z.number().int().min(1).max(100).default(5)
    ),
  buyers: z
    .preprocess(
      (val) => (val !== undefined && val !== '' ? Number(val) : 20),
      z.number().int().min(1).max(50).default(20)
    ),
  mode: z
    .preprocess(
      (val) => (val !== undefined && val !== '' ? val : 'safe'),
      z.enum(['safe', 'unsafe']).default('safe')
    ),
});

// POST /demo/api/oversell
router.post(
  '/api/oversell',
  demoRateLimiter,
  validateBody(oversellBodySchema),
  async (req, res, next) => {
    try {
      const result = await runOversellDemo(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
