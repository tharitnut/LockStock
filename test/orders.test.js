import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import { createTestUser, createTestProduct, assertStockInvariant } from './helpers.js';

describe('Orders Service & Routes (Core Logic)', () => {
  let admin;
  let customer1;
  let customer2;

  beforeEach(async () => {
    admin = await createTestUser(db, { email: 'admin_ord@test.com', role: 'admin' });
    customer1 = await createTestUser(db, { email: 'cust1_ord@test.com', role: 'customer' });
    customer2 = await createTestUser(db, { email: 'cust2_ord@test.com', role: 'customer' });
  });

  it('places an order with exact integer satang calculation (3 x 19.99 = 59.97)', async () => {
    const p = await createTestProduct(db, {
      sku: 'BOOK-01',
      name: 'Algorithm Book',
      price: 19.99,
      stock_quantity: 10,
      userId: admin.id,
    });

    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customer1.token}`)
      .send({
        items: [{ product_id: p.id, quantity: 3 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('placed');
    expect(res.body.total).toBe(59.97);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].product_id).toBe(p.id);
    expect(res.body.items[0].unit_price).toBe(19.99);
    expect(res.body.items[0].line_total).toBe(59.97);

    // Verify product stock decremented
    const updatedProd = await db('products').where({ id: p.id }).first();
    expect(updatedProd.stock_quantity).toBe(7);

    // Verify stock movement
    const movements = await db('stock_movements').where({ product_id: p.id }).orderBy('id', 'desc');
    expect(movements[0].delta).toBe(-3);
    expect(movements[0].reason).toBe('order');
    expect(movements[0].order_id).toBe(res.body.id);

    await expect(assertStockInvariant(db, p.id)).resolves.toBe(true);
  });

  it('merges duplicate product_ids in the request payload', async () => {
    const p = await createTestProduct(db, {
      sku: 'MERGE-01',
      name: 'Merge Item',
      price: 10.00,
      stock_quantity: 10,
      userId: admin.id,
    });

    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customer1.token}`)
      .send({
        items: [
          { product_id: p.id, quantity: 2 },
          { product_id: p.id, quantity: 3 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(50.00);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].quantity).toBe(5);

    const updatedProd = await db('products').where({ id: p.id }).first();
    expect(updatedProd.stock_quantity).toBe(5);

    await expect(assertStockInvariant(db, p.id)).resolves.toBe(true);
  });

  it('rejects order with 400 BAD_REFERENCE when a product is inactive or unknown', async () => {
    const inactive = await createTestProduct(db, {
      sku: 'INACT-01',
      name: 'Inactive',
      price: 20.00,
      stock_quantity: 5,
      is_active: false,
    });

    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customer1.token}`)
      .send({
        items: [
          { product_id: inactive.id, quantity: 1 },
          { product_id: 999999, quantity: 1 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REFERENCE');
  });

  it('fails with 409 INSUFFICIENT_STOCK on partial shortage; no partial order written (item d)', async () => {
    const p1 = await createTestProduct(db, { sku: 'P1-MULTI', price: 10, stock_quantity: 5, userId: admin.id });
    const p2 = await createTestProduct(db, { sku: 'P2-MULTI', price: 20, stock_quantity: 1, userId: admin.id });

    // Request 2 of P1 (has 5) and 3 of P2 (only has 1)
    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customer1.token}`)
      .send({
        items: [
          { product_id: p1.id, quantity: 2 },
          { product_id: p2.id, quantity: 3 },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual([
      { product_id: p2.id, requested: 3, available: 1 },
    ]);

    // Ensure neither product's stock changed
    const dbP1 = await db('products').where({ id: p1.id }).first();
    const dbP2 = await db('products').where({ id: p2.id }).first();
    expect(dbP1.stock_quantity).toBe(5);
    expect(dbP2.stock_quantity).toBe(1);

    // Ensure no order was created
    const ordersCount = await db('orders').count('* as count').first();
    expect(Number(ordersCount.count)).toBe(0);

    await expect(assertStockInvariant(db, p1.id)).resolves.toBe(true);
    await expect(assertStockInvariant(db, p2.id)).resolves.toBe(true);
  });

  it('changing a product price after ordering does not change the order unit_price/total (item e)', async () => {
    const p = await createTestProduct(db, { sku: 'PRICE-SNAP', price: 25.00, stock_quantity: 10, userId: admin.id });

    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customer1.token}`)
      .send({
        items: [{ product_id: p.id, quantity: 2 }],
      });

    expect(orderRes.status).toBe(201);
    expect(orderRes.body.total).toBe(50.00);

    // Admin changes product price to 999.00
    await request(app)
      .patch(`/products/${p.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ price: 999.00 });

    // Fetch the order again
    const getRes = await request(app)
      .get(`/orders/${orderRes.body.id}`)
      .set('Authorization', `Bearer ${customer1.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.total).toBe(50.00);
    expect(getRes.body.items[0].unit_price).toBe(25.00);
    expect(getRes.body.items[0].line_total).toBe(50.00);
  });

  it('customer cannot read/cancel another customer order (404); admin can (item f)', async () => {
    const p = await createTestProduct(db, { sku: 'ACCESS-01', price: 15.00, stock_quantity: 10, userId: admin.id });

    // Customer 1 places order
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customer1.token}`)
      .send({
        items: [{ product_id: p.id, quantity: 2 }],
      });

    const orderId = orderRes.body.id;

    // Customer 2 tries to GET order -> 404 (not 403!)
    const getRes = await request(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${customer2.token}`);
    expect(getRes.status).toBe(404);

    // Customer 2 tries to CANCEL order -> 404 (not 403!)
    const cancelRes = await request(app)
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customer2.token}`);
    expect(cancelRes.status).toBe(404);

    // Admin CAN read order
    const adminGet = await request(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(adminGet.status).toBe(200);
    expect(adminGet.body.id).toBe(orderId);

    // Admin CAN cancel order
    const adminCancel = await request(app)
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(adminCancel.status).toBe(200);
    expect(adminCancel.body.status).toBe('cancelled');

    // Cancelling again returns 409 ORDER_NOT_CANCELLABLE
    const secondCancel = await request(app)
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(secondCancel.status).toBe(409);
    expect(secondCancel.body.error.code).toBe('ORDER_NOT_CANCELLABLE');

    // Stock must be restored back to 10
    const finalProd = await db('products').where({ id: p.id }).first();
    expect(finalProd.stock_quantity).toBe(10);
    await expect(assertStockInvariant(db, p.id)).resolves.toBe(true);
  });
});
