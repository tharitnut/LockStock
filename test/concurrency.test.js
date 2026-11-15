import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import { createTestUser, createTestProduct, assertStockInvariant } from './helpers.js';

describe('Concurrency & Transaction Integrity (Core Project Tests)', () => {
  let admin;

  beforeEach(async () => {
    admin = await createTestUser(db, { email: 'admin_concur@test.com', role: 'admin' });
  });

  /**
   * Concurrency Test a:
   * Stock 5, fire 20 parallel POST /orders of quantity 1 ->
   * exactly 5 succeed (201), 15 get 409, final stock 0, exactly 5 orders, and assertStockInvariant() passes.
   */
  it('prevents overselling under 20 parallel requests with stock = 5 (item a)', async () => {
    const product = await createTestProduct(db, {
      sku: 'FLASH-01',
      name: 'Limited Edition Phone',
      price: 500.00,
      stock_quantity: 5,
      userId: admin.id,
    });

    // Create 20 distinct users so each has a valid JWT
    const users = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        createTestUser(db, { email: `buyer_${i}_${Date.now()}@test.com` })
      )
    );

    // Fire 20 parallel order requests simultaneously
    const orderPromises = users.map((user) =>
      request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          items: [{ product_id: product.id, quantity: 1 }],
        })
    );

    const responses = await Promise.all(orderPromises);

    const successCount = responses.filter((r) => r.status === 201).length;
    const rejectedCount = responses.filter((r) => r.status === 409).length;

    // Verify exact distribution
    expect(successCount).toBe(5);
    expect(rejectedCount).toBe(15);

    // Verify all 15 rejections had code INSUFFICIENT_STOCK
    for (const res of responses.filter((r) => r.status === 409)) {
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    }

    // Verify database state: stock must be exactly 0
    const finalProduct = await db('products').where({ id: product.id }).first();
    expect(finalProduct.stock_quantity).toBe(0);

    // Exactly 5 orders recorded
    const totalOrders = await db('orders').count('* as count').first();
    expect(Number(totalOrders.count)).toBe(5);

    // Strict stock invariant holds
    await expect(assertStockInvariant(db, product.id)).resolves.toBe(true);
  });

  /**
   * Concurrency Test b:
   * Two products A and B; fire parallel orders that list them in opposite order
   * ([A,B] and [B,A]) -> no 500s/deadlock errors, all results are 201 or 409, invariant holds.
   */
  it('eliminates deadlocks when parallel requests list products in opposite order (item b)', async () => {
    const prodA = await createTestProduct(db, { sku: 'PROD-A', price: 10, stock_quantity: 10, userId: admin.id });
    const prodB = await createTestProduct(db, { sku: 'PROD-B', price: 20, stock_quantity: 10, userId: admin.id });

    const totalRequests = 16;
    const users = await Promise.all(
      Array.from({ length: totalRequests }, (_, i) =>
        createTestUser(db, { email: `deadlock_user_${i}_${Date.now()}@test.com` })
      )
    );

    // Half request [A, B] and half request [B, A]
    const orderPromises = users.map((user, index) => {
      const items =
        index % 2 === 0
          ? [
              { product_id: prodA.id, quantity: 1 },
              { product_id: prodB.id, quantity: 1 },
            ]
          : [
              { product_id: prodB.id, quantity: 1 },
              { product_id: prodA.id, quantity: 1 },
            ];

      return request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ items });
    });

    const responses = await Promise.all(orderPromises);

    // No internal server errors (500) or deadlock failures
    for (const res of responses) {
      expect([201, 409]).toContain(res.status);
    }

    const successResponses = responses.filter((r) => r.status === 201);
    expect(successResponses.length).toBe(10); // Stock was 10 for both

    // Verify invariants for both products
    await expect(assertStockInvariant(db, prodA.id)).resolves.toBe(true);
    await expect(assertStockInvariant(db, prodB.id)).resolves.toBe(true);
  });

  /**
   * Concurrency Test c:
   * Fire 10 parallel cancels of the same order -> exactly one 200, nine 409, stock restored exactly once.
   */
  it('restores stock exactly once under 10 parallel cancels of the same order (item c)', async () => {
    const product = await createTestProduct(db, {
      sku: 'CANCEL-CONCUR',
      price: 30.00,
      stock_quantity: 10,
      userId: admin.id,
    });

    const buyer = await createTestUser(db, { email: 'buyer_cancel@test.com' });

    // Buyer places order for 3 items
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        items: [{ product_id: product.id, quantity: 3 }],
      });

    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.id;

    // Stock immediately after ordering is 7
    const midProd = await db('products').where({ id: product.id }).first();
    expect(midProd.stock_quantity).toBe(7);

    // Fire 10 parallel cancel requests for the same order
    const cancelPromises = Array.from({ length: 10 }, () =>
      request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${buyer.token}`)
    );

    const cancelResponses = await Promise.all(cancelPromises);

    const successCount = cancelResponses.filter((r) => r.status === 200).length;
    const conflictCount = cancelResponses.filter((r) => r.status === 409).length;

    // Exactly one cancel succeeds; nine fail with 409 ORDER_NOT_CANCELLABLE
    expect(successCount).toBe(1);
    expect(conflictCount).toBe(9);

    for (const r of cancelResponses.filter((res) => res.status === 409)) {
      expect(r.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    }

    // Stock must be restored to 10 (not 10 + 3*10)
    const finalProduct = await db('products').where({ id: product.id }).first();
    expect(finalProduct.stock_quantity).toBe(10);

    // Invariant holds
    await expect(assertStockInvariant(db, product.id)).resolves.toBe(true);
  });
});
