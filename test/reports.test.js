import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import { createTestUser, createTestProduct } from './helpers.js';

describe('Admin Reports Endpoints', () => {
  let admin;
  let customer;

  beforeEach(async () => {
    admin = await createTestUser(db, { email: 'admin_rep@test.com', role: 'admin' });
    customer = await createTestUser(db, { email: 'cust_rep@test.com', role: 'customer' });
  });

  describe('GET /reports/low-stock', () => {
    it('returns active products with stock <= threshold, sorted by stock ascending', async () => {
      // Create products with various stock levels
      const p1 = await createTestProduct(db, { sku: 'LS-01', stock_quantity: 2, userId: admin.id });
      const p2 = await createTestProduct(db, { sku: 'LS-02', stock_quantity: 5, userId: admin.id });
      await createTestProduct(db, { sku: 'LS-03', stock_quantity: 6, userId: admin.id });
      await createTestProduct(db, { sku: 'LS-04', stock_quantity: 20, userId: admin.id });
      // Inactive product with low stock (must NOT be included)
      await createTestProduct(db, { sku: 'LS-05', stock_quantity: 1, is_active: false, userId: admin.id });

      const res = await request(app)
        .get('/reports/low-stock?threshold=5')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.threshold).toBe(5);
      expect(res.body.total).toBe(2);
      expect(res.body.items.length).toBe(2);
      expect(res.body.items[0].sku).toBe('LS-01');
      expect(res.body.items[0].stock_quantity).toBe(2);
      expect(res.body.items[1].sku).toBe('LS-02');
      expect(res.body.items[1].stock_quantity).toBe(5);
    });

    it('denies access to customers with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/reports/low-stock')
        .set('Authorization', `Bearer ${customer.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /reports/sales', () => {
    it('accurately computes sales aggregates and excludes cancelled orders in SQL', async () => {
      const prodA = await createTestProduct(db, { sku: 'REP-A', name: 'Product A', price: 10.00, stock_quantity: 50, userId: admin.id });
      const prodB = await createTestProduct(db, { sku: 'REP-B', name: 'Product B', price: 25.00, stock_quantity: 50, userId: admin.id });

      const targetDate = new Date('2026-11-15T12:00:00Z');
      const outsideDate = new Date('2026-10-01T12:00:00Z');

      // Order 1: 2 x ProdA = 20.00 (Placed on targetDate)
      const order1 = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ items: [{ product_id: prodA.id, quantity: 2 }] });
      await db('orders').where({ id: order1.body.id }).update({ created_at: targetDate });

      // Order 2: 1 x ProdA (10.00) + 2 x ProdB (50.00) = 60.00 (Placed on targetDate)
      const order2 = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          items: [
            { product_id: prodA.id, quantity: 1 },
            { product_id: prodB.id, quantity: 2 },
          ],
        });
      await db('orders').where({ id: order2.body.id }).update({ created_at: targetDate });

      // Order 3: Cancelled order on targetDate (1 x ProdB = 25.00) -> Must be excluded!
      const order3 = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ items: [{ product_id: prodB.id, quantity: 1 }] });
      await db('orders').where({ id: order3.body.id }).update({ created_at: targetDate });
      await request(app)
        .post(`/orders/${order3.body.id}/cancel`)
        .set('Authorization', `Bearer ${customer.token}`);

      // Order 4: Placed on outsideDate -> Must be excluded by date range!
      const order4 = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ items: [{ product_id: prodA.id, quantity: 5 }] });
      await db('orders').where({ id: order4.body.id }).update({ created_at: outsideDate });

      // Query sales for 2026-11-01 to 2026-11-30
      const res = await request(app)
        .get('/reports/sales?from=2026-11-01&to=2026-11-30')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);

      // Total orders in range: exactly 2 non-cancelled orders (Order 1 + Order 2)
      expect(res.body.order_count).toBe(2);
      expect(typeof res.body.order_count).toBe('number');

      // Total revenue: 20.00 + 60.00 = 80.00
      expect(res.body.revenue).toBe(80.00);
      expect(typeof res.body.revenue).toBe('number');

      // Top products:
      // ProdA: 2 + 1 = 3 units, 30.00 revenue
      // ProdB: 2 units, 50.00 revenue
      expect(res.body.top_products.length).toBe(2);

      const topProdA = res.body.top_products.find((p) => p.product_id === prodA.id);
      expect(topProdA).toBeDefined();
      expect(topProdA.units).toBe(3);
      expect(topProdA.revenue).toBe(30.00);

      const topProdB = res.body.top_products.find((p) => p.product_id === prodB.id);
      expect(topProdB).toBeDefined();
      expect(topProdB.units).toBe(2);
      expect(topProdB.revenue).toBe(50.00);
    });

    it('rejects invalid date range (from > to) with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/reports/sales?from=2026-12-01&to=2026-11-01')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed date strings with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/reports/sales?from=not-a-date&to=invalid')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
