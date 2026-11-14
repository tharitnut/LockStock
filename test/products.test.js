import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import { createTestUser, createTestProduct, assertStockInvariant } from './helpers.js';

describe('Products Endpoints', () => {
  let admin;
  let customer;

  beforeEach(async () => {
    admin = await createTestUser(db, { email: 'admin_prod@test.com', role: 'admin' });
    customer = await createTestUser(db, { email: 'cust_prod@test.com', role: 'customer' });
  });

  describe('POST /products', () => {
    it('admin can create a product with initial stock and movement', async () => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          sku: 'KEY-001',
          name: 'Mechanical Keyboard',
          price: 99.99,
          initial_stock: 10,
        });

      expect(res.status).toBe(201);
      expect(res.body.sku).toBe('KEY-001');
      expect(res.body.name).toBe('Mechanical Keyboard');
      expect(res.body.price).toBe(99.99);
      expect(typeof res.body.price).toBe('number'); // must be number, not string!
      expect(res.body.stock_quantity).toBe(10);
      expect(res.body.is_active).toBe(true);
      expect(typeof res.body.is_active).toBe('boolean');
      expect(res.body.created_at).toMatch(/Z$/);

      // Verify stock movement
      const movements = await db('stock_movements').where({ product_id: res.body.id });
      expect(movements.length).toBe(1);
      expect(movements[0].delta).toBe(10);
      expect(movements[0].reason).toBe('restock');

      // Verify invariant
      await expect(assertStockInvariant(db, res.body.id)).resolves.toBe(true);
    });

    it('customer receives 403 FORBIDDEN when attempting to create product', async () => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          sku: 'FORBIDDEN-01',
          name: 'Forbidden Item',
          price: 50.00,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects duplicate SKU with 409 SKU_TAKEN', async () => {
      await createTestProduct(db, { sku: 'DUP-SKU-1', name: 'Original', price: 10 });

      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          sku: 'DUP-SKU-1',
          name: 'Duplicate',
          price: 20,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SKU_TAKEN');
    });
  });

  describe('GET /products and GET /products/:id', () => {
    beforeEach(async () => {
      await createTestProduct(db, { sku: 'A1', name: 'Apple iPhone', price: 999.00, stock_quantity: 5, is_active: true });
      await createTestProduct(db, { sku: 'A2', name: 'Apple iPad', price: 499.50, stock_quantity: 0, is_active: true });
      await createTestProduct(db, { sku: 'S1', name: 'Samsung Galaxy', price: 799.00, stock_quantity: 2, is_active: true });
      await createTestProduct(db, { sku: 'OLD', name: 'Old Discontinued Item', price: 10.00, stock_quantity: 1, is_active: false });
    });

    it('lists active products with pagination and numeric price', async () => {
      const res = await request(app).get('/products?limit=10&offset=0');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3); // excludes inactive
      expect(res.body.items.length).toBe(3);
      expect(typeof res.body.items[0].price).toBe('number');
      expect(typeof res.body.items[0].is_active).toBe('boolean');
    });

    it('filters products by q search string', async () => {
      const res = await request(app).get('/products?q=apple');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items.map(i => i.sku).sort()).toEqual(['A1', 'A2']);
    });

    it('filters products by in_stock', async () => {
      const res = await request(app).get('/products?in_stock=true');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items.every(i => i.stock_quantity > 0)).toBe(true);
    });

    it('filters products by price range', async () => {
      const res = await request(app).get('/products?min_price=500&max_price=800');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].sku).toBe('S1');
    });

    it('gets a single product by id', async () => {
      const p = await createTestProduct(db, { sku: 'SINGLE', name: 'Single Item', price: 25.50 });
      const res = await request(app).get(`/products/${p.id}`);

      expect(res.status).toBe(200);
      expect(res.body.sku).toBe('SINGLE');
      expect(res.body.price).toBe(25.5);
    });

    it('returns 404 for non-existent or inactive product', async () => {
      const resNonExistent = await request(app).get('/products/999999');
      expect(resNonExistent.status).toBe(404);

      const inactive = await createTestProduct(db, { sku: 'INACTIVE', name: 'Inactive', is_active: false });
      const resInactive = await request(app).get(`/products/${inactive.id}`);
      expect(resInactive.status).toBe(404);
    });
  });

  describe('PATCH /products/:id and DELETE /products/:id', () => {
    it('admin can update name and price but stock remains untouched', async () => {
      const p = await createTestProduct(db, { sku: 'UPD-1', name: 'Original Name', price: 10.00, stock_quantity: 5 });

      const res = await request(app)
        .patch(`/products/${p.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          name: 'Updated Name',
          price: 15.50,
          stock_quantity: 999, // should be ignored!
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
      expect(res.body.price).toBe(15.5);
      expect(res.body.stock_quantity).toBe(5); // unchanged!
    });

    it('admin can soft-delete a product', async () => {
      const p = await createTestProduct(db, { sku: 'DEL-1', name: 'To Delete', price: 10.00 });

      const res = await request(app)
        .delete(`/products/${p.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(204);

      // Verify soft delete in DB
      const inDb = await db('products').where({ id: p.id }).first();
      expect(inDb).toBeDefined();
      expect(Boolean(inDb.is_active)).toBe(false);

      // Should not be visible publicly
      const getRes = await request(app).get(`/products/${p.id}`);
      expect(getRes.status).toBe(404);
    });
  });
});
