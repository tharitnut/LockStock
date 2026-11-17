import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validateQuery } from '../middleware/validate.js';
import { getLowStockReport, getSalesReport } from '../services/reports.js';

const router = Router();

// Both report endpoints require admin authentication
router.use(authenticate, requireRole('admin'));

const lowStockQuerySchema = z.object({
  threshold: z.preprocess(
    (val) => (val !== undefined && val !== '' ? Number(val) : 5),
    z.number().int().min(0).default(5)
  ),
});

const salesQuerySchema = z
  .object({
    from: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: 'from must be a valid ISO date string',
    }),
    to: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: 'to must be a valid ISO date string',
    }),
  })
  .refine(
    (data) => new Date(data.from) <= new Date(data.to),
    {
      message: 'from date must be less than or equal to to date',
      path: ['from'],
    }
  );

// GET /reports/low-stock?threshold=5 (admin)
router.get(
  '/low-stock',
  validateQuery(lowStockQuerySchema),
  async (req, res, next) => {
    try {
      const qParams = req.validatedQuery || req.query;
      const report = await getLowStockReport(qParams.threshold);
      res.json(report);
    } catch (err) {
      next(err);
    }
  }
);

// GET /reports/sales?from&to (admin)
router.get(
  '/sales',
  validateQuery(salesQuerySchema),
  async (req, res, next) => {
    try {
      const qParams = req.validatedQuery || req.query;
      const fromDate = new Date(qParams.from);
      let toDate = new Date(qParams.to);

      // If toDate is provided as date-only (e.g. YYYY-MM-DD), extend to end of day
      if (qParams.to.length === 10) {
        toDate = new Date(`${qParams.to}T23:59:59.999Z`);
      }

      const report = await getSalesReport(fromDate, toDate);
      res.json(report);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
