import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import { createTestUser, createTestProduct } from './helpers.js';

describe('Role Matrix RBAC Verification (Anonymous vs Customer vs Admin)', () => {
  let admin;
  let customer;
  let testProduct;

  beforeEach(async () => {
    admin = await createTestUser(db, { email: 'matrix_admin@test.com', role: 'admin' });
    customer = await createTestUser(db, { email: 'matrix_customer@test.com', role: 'customer' });
    testProduct = await createTestProduct(db, { sku: 'MAT-01', price: 10, stock_quantity: 20, userId: admin.id });
  });

  const routes = [
    {
      name: 'GET /health',
      execute: (token) =>
        request(app)
          .get('/health')
          .set(token ? { Authorization: `Bearer ${token}` } : {}),
      expected: { anon: 200, customer: 200, admin: 200 },
    },
    {
      name: 'GET /auth/me',
      execute: (token) =>
        request(app)
          .get('/auth/me')
          .set(token ? { Authorization: `Bearer ${token}` } : {}),
      expected: { anon: 401, customer: 200, admin: 200 },
    },
    {
      name: 'GET /products',
      execute: (token) =>
        request(app)
          .get('/products')
          .set(token ? { Authorization: `Bearer ${token}` } : {}),
      expected: { anon: 200, customer: 200, admin: 200 },
    },
    {
      name: 'POST /products',
      execute: (token) =>
        request(app)
          .post('/products')
          .set(token ? { Authorization: `Bearer ${token}` } : {})
          .send({ sku: `MAT-P-${Date.now()}`, name: 'New P', price: 10 }),
      expected: { anon: 401, customer: 403, admin: 201 },
    },
    {
      name: 'PATCH /products/:id',
      execute: (token) =>
        request(app)
          .patch(`/products/${testProduct.id}`)
          .set(token ? { Authorization: `Bearer ${token}` } : {})
          .send({ name: 'Patched Name' }),
      expected: { anon: 401, customer: 403, admin: 200 },
    },
    {
      name: 'POST /products/:id/stock',
      execute: (token) =>
        request(app)
          .post(`/products/${testProduct.id}/stock`)
          .set(token ? { Authorization: `Bearer ${token}` } : {})
          .send({ delta: 5, reason: 'restock' }),
      expected: { anon: 401, customer: 403, admin: 200 },
    },
    {
      name: 'GET /products/:id/movements',
      execute: (token) =>
        request(app)
          .get(`/products/${testProduct.id}/movements`)
          .set(token ? { Authorization: `Bearer ${token}` } : {}),
      expected: { anon: 401, customer: 403, admin: 200 },
    },
    {
      name: 'GET /reports/low-stock',
      execute: (token) =>
        request(app)
          .get('/reports/low-stock')
          .set(token ? { Authorization: `Bearer ${token}` } : {}),
      expected: { anon: 401, customer: 403, admin: 200 },
    },
    {
      name: 'GET /reports/sales',
      execute: (token) =>
        request(app)
          .get('/reports/sales?from=2026-01-01&to=2026-12-31')
          .set(token ? { Authorization: `Bearer ${token}` } : {}),
      expected: { anon: 401, customer: 403, admin: 200 },
    },
    {
      name: 'GET /orders',
      execute: (token) =>
        request(app)
          .get('/orders')
          .set(token ? { Authorization: `Bearer ${token}` } : {}),
      expected: { anon: 401, customer: 200, admin: 200 },
    },
  ];

  for (const route of routes) {
    it(`enforces correct access matrix for ${route.name}`, async () => {
      // 1. Anonymous
      const anonRes = await route.execute(null);
      expect(anonRes.status).toBe(route.expected.anon);

      // 2. Customer
      const custRes = await route.execute(customer.token);
      expect(custRes.status).toBe(route.expected.customer);

      // 3. Admin
      const adminRes = await route.execute(admin.token);
      expect(adminRes.status).toBe(route.expected.admin);
    });
  }
});
