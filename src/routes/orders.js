import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  placeOrder,
  cancelOrder,
  getOrderById,
  listOrders,
} from '../services/orders.js';

const router = Router();

const idParamSchema = z.object({
  id: z.preprocess((val) => Number(val), z.number().int().positive()),
});

const placeOrderSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().min(1).max(1000),
      })
    )
    .min(1)
    .max(50),
});

const listOrdersQuerySchema = z.object({
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
  offset: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 0), z.number().int().min(0).default(0)),
  user_id: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : undefined), z.number().int().positive().optional()),
});

// POST /orders (authenticated)
router.post(
  '/',
  authenticate,
  validateBody(placeOrderSchema),
  async (req, res, next) => {
    try {
      const order = await placeOrder(req.user, req.body.items);
      res.status(201).json(order);
    } catch (err) {
      next(err);
    }
  }
);

// GET /orders (authenticated: own orders; admin: all or filtered by ?user_id)
router.get(
  '/',
  authenticate,
  validateQuery(listOrdersQuerySchema),
  async (req, res, next) => {
    try {
      const qParams = req.validatedQuery || req.query;
      const { limit, offset, user_id } = qParams;

      const result = await listOrders(req.user, { limit, offset, user_id });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /orders/:id (authenticated: owner or admin, else 404)
router.get(
  '/:id',
  authenticate,
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const params = req.validatedParams || req.params;
      const order = await getOrderById(req.user, params.id);
      res.json(order);
    } catch (err) {
      next(err);
    }
  }
);

// POST /orders/:id/cancel (authenticated: owner or admin, else 404; if not 'placed' -> 409)
router.post(
  '/:id/cancel',
  authenticate,
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const params = req.validatedParams || req.params;
      const cancelled = await cancelOrder(req.user, params.id);
      res.json(cancelled);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
