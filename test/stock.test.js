import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import { createTestUser, createTestProduct, assertStockInvariant } from './helpers.js';

describe('Stock Management & Invariants', () => {
  let admin;
  let customer;

  beforeEach(async () => {
    admin = await createTestUser(db, { email: 'admin_stock@test.com', role: 'admin' });
    customer = await createTestUser(db, { email: 'cust_stock@test.com', role: 'customer' });
  });

  describe('POST /products/:id/stock', () => {
    it('admin can restock a product and writes a movement', async () => {
      const p = await createTestProduct(db, { sku: 'STK-01', name: 'Item 1', stock_quantity: 5, userId: admin.id });

      const res = await request(app)
        .post(`/products/${p.id}/stock`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          delta: 15,
          reason: 'restock',
        });

      expect(res.status).toBe(200);
      expect(res.body.stock_quantity).toBe(20);

      const movements = await db('stock_movements').where({ product_id: p.id }).orderBy('id', 'asc');
      expect(movements.length).toBe(2);
      expect(movements[1].delta).toBe(15);
      expect(movements[1].reason).toBe('restock');

      await expect(assertStockInvariant(db, p.id)).resolves.toBe(true);
    });

    it('admin can adjust stock downwards successfully if sufficient stock', async () => {
      const p = await createTestProduct(db, { sku: 'STK-02', name: 'Item 2', stock_quantity: 10, userId: admin.id });

      const res = await request(app)
        .post(`/products/${p.id}/stock`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          delta: -4,
          reason: 'adjustment',
        });

      expect(res.status).toBe(200);
      expect(res.body.stock_quantity).toBe(6);

      await expect(assertStockInvariant(db, p.id)).resolves.toBe(true);
    });

    it('rejects downward adjustment when resulting stock would be negative', async () => {
      const p = await createTestProduct(db, { sku: 'STK-03', name: 'Item 3', stock_quantity: 3, userId: admin.id });

      const res = await request(app)
        .post(`/products/${p.id}/stock`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          delta: -5,
          reason: 'adjustment',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.error.details).toEqual([
        {
          product_id: p.id,
          requested: 5,
          available: 3,
        },
      ]);

      // Stock in database must NOT change
      const after = await db('products').where({ id: p.id }).first();
      expect(after.stock_quantity).toBe(3);

      await expect(assertStockInvariant(db, p.id)).resolves.toBe(true);
    });

    it('customer cannot adjust stock (403 FORBIDDEN)', async () => {
      const p = await createTestProduct(db, { sku: 'STK-04', name: 'Item 4', stock_quantity: 10 });

      const res = await request(app)
        .post(`/products/${p.id}/stock`)
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          delta: 5,
          reason: 'restock',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /products/:id/movements', () => {
    it('returns paginated ledger of stock movements for admin', async () => {
      const p = await createTestProduct(db, { sku: 'STK-05', name: 'Item 5', stock_quantity: 2, userId: admin.id });

      // Add 2 more movements
      await request(app)
        .post(`/products/${p.id}/stock`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ delta: 5, reason: 'restock' });

      await request(app)
        .post(`/products/${p.id}/stock`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ delta: -1, reason: 'adjustment' });

      const res = await request(app)
        .get(`/products/${p.id}/movements?limit=10&offset=0`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.items.length).toBe(3);
      expect(res.body.items[0].created_at).toMatch(/Z$/);
    });

    it('customer receives 403 on GET movements', async () => {
      const p = await createTestProduct(db, { sku: 'STK-06', name: 'Item 6' });

      const res = await request(app)
        .get(`/products/${p.id}/movements`)
        .set('Authorization', `Bearer ${customer.token}`);

      expect(res.status).toBe(403);
    });
  });
});
