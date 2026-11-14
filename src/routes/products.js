import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { notFound } from '../lib/errors.js';
import { parseMoney } from '../lib/money.js';
import {
  createProduct,
  adjustStock,
  serializeProduct,
  serializeMovement,
} from '../services/stock.js';

const router = Router();

const idParamSchema = z.object({
  id: z.preprocess(val => Number(val), z.number().int().positive()),
});

const getProductsQuerySchema = z.object({
  q: z.string().optional(),
  min_price: z.preprocess(val => (val !== undefined && val !== '' ? Number(val) : undefined), z.number().nonnegative().optional()),
  max_price: z.preprocess(val => (val !== undefined && val !== '' ? Number(val) : undefined), z.number().nonnegative().optional()),
  in_stock: z.preprocess(val => (val === 'true' ? true : val === 'false' ? false : undefined), z.boolean().optional()),
  limit: z.preprocess(val => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
  offset: z.preprocess(val => (val !== undefined && val !== '' ? Number(val) : 0), z.number().int().min(0).default(0)),
});

const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  price: z.number().nonnegative(),
  initial_stock: z.number().int().nonnegative().optional().default(0),
});

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  price: z.number().nonnegative().optional(),
  is_active: z.boolean().optional(),
});

const adjustStockSchema = z.object({
  delta: z.number().int().refine(val => val !== 0, {
    message: 'delta must be a non-zero integer',
  }),
  reason: z.enum(['restock', 'adjustment']),
});

const movementsQuerySchema = z.object({
  limit: z.preprocess(val => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
  offset: z.preprocess(val => (val !== undefined && val !== '' ? Number(val) : 0), z.number().int().min(0).default(0)),
});

// GET /products (public)
router.get('/', validateQuery(getProductsQuerySchema), async (req, res, next) => {
  try {
    const qParams = req.validatedQuery || req.query;
    const { q, min_price, max_price, in_stock, limit, offset } = qParams;

    const query = db('products').where({ is_active: true });

    if (q) {
      const lowerQ = `%${q.toLowerCase()}%`;
      query.where((builder) => {
        builder
          .whereRaw('LOWER(name) LIKE ?', [lowerQ])
          .orWhereRaw('LOWER(sku) LIKE ?', [lowerQ]);
      });
    }

    if (min_price !== undefined) {
      query.where('price', '>=', min_price);
    }

    if (max_price !== undefined) {
      query.where('price', '<=', max_price);
    }

    if (in_stock !== undefined) {
      if (in_stock) {
        query.where('stock_quantity', '>', 0);
      } else {
        query.where('stock_quantity', '=', 0);
      }
    }

    // Clone query for counting total items
    const countResult = await query.clone().count('* as count').first();
    const total = countResult ? Number(countResult.count) : 0;

    const items = await query
      .orderBy('id', 'asc')
      .limit(limit)
      .offset(offset);

    res.json({
      items: items.map(serializeProduct),
      total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

// GET /products/:id (public)
router.get('/:id', validateParams(idParamSchema), async (req, res, next) => {
  try {
    const params = req.validatedParams || req.params;
    const { id } = params;
    const product = await db('products').where({ id, is_active: true }).first();

    if (!product) {
      throw notFound(`Product with ID ${id} not found`);
    }

    res.json(serializeProduct(product));
  } catch (err) {
    next(err);
  }
});

// POST /products (admin)
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  validateBody(createProductSchema),
  async (req, res, next) => {
    try {
      const product = await createProduct({
        ...req.body,
        userId: req.user.id,
      });
      res.status(201).json(product);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /products/:id (admin - never changes stock)
router.patch(
  '/:id',
  authenticate,
  requireRole('admin'),
  validateParams(idParamSchema),
  validateBody(updateProductSchema),
  async (req, res, next) => {
    try {
      const params = req.validatedParams || req.params;
      const { id } = params;
      const { name, price, is_active } = req.body;

      const existing = await db('products').where({ id }).first();
      if (!existing) {
        throw notFound(`Product with ID ${id} not found`);
      }

      const updates = {
        updated_at: new Date(),
      };

      if (name !== undefined) updates.name = name;
      if (price !== undefined) updates.price = parseMoney(price);
      if (is_active !== undefined) updates.is_active = is_active;

      await db('products').where({ id }).update(updates);

      const updated = await db('products').where({ id }).first();
      res.json(serializeProduct(updated));
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /products/:id (admin - soft delete)
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const params = req.validatedParams || req.params;
      const { id } = params;
      const existing = await db('products').where({ id }).first();
      if (!existing) {
        throw notFound(`Product with ID ${id} not found`);
      }

      await db('products').where({ id }).update({
        is_active: false,
        updated_at: new Date(),
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

// POST /products/:id/stock (admin)
router.post(
  '/:id/stock',
  authenticate,
  requireRole('admin'),
  validateParams(idParamSchema),
  validateBody(adjustStockSchema),
  async (req, res, next) => {
    try {
      const params = req.validatedParams || req.params;
      const { id } = params;
      const { delta, reason } = req.body;

      const product = await adjustStock({
        productId: id,
        delta,
        reason,
        userId: req.user.id,
      });

      res.json(product);
    } catch (err) {
      next(err);
    }
  }
);

// GET /products/:id/movements (admin, paginated)
router.get(
  '/:id/movements',
  authenticate,
  requireRole('admin'),
  validateParams(idParamSchema),
  validateQuery(movementsQuerySchema),
  async (req, res, next) => {
    try {
      const params = req.validatedParams || req.params;
      const qParams = req.validatedQuery || req.query;
      const { id } = params;
      const { limit, offset } = qParams;

      const product = await db('products').where({ id }).first();
      if (!product) {
        throw notFound(`Product with ID ${id} not found`);
      }

      const query = db('stock_movements').where({ product_id: id });
      const countResult = await query.clone().count('* as count').first();
      const total = countResult ? Number(countResult.count) : 0;

      const movements = await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .offset(offset);

      res.json({
        items: movements.map(serializeMovement),
        total,
        limit,
        offset,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
