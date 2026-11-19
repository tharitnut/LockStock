/**
 * ⚠️ DELIBERATELY UNSAFE IMPLEMENTATION FOR DEMONSTRATION PURPOSES ONLY ⚠️
 *
 * This function intentionally implements a broken, uncoordinated read-check-write pattern:
 * 1. Reads stock WITHOUT row locking (no FOR UPDATE).
 * 2. Checks if stock >= 1 in memory.
 * 3. Deliberately sleeps for DEMO_NAIVE_DELAY_MS to widen the concurrency race window.
 * 4. Overwrites stock with an absolute value (readStock - 1).
 * 5. Writes order, order_item, and stock_movement.
 *
 * CONSEQUENCE: Concurrent executions read the same stale stock value, resulting in
 * severe OVERSELLING (stock drops below 0) and breaking the core stock invariant.
 *
 * ⛔ NEVER IMPORT OR USE THIS FUNCTION IN PRODUCTION ROUTES OR REAL ORDER LOGIC!
 */

import db, { insertAndGetId } from '../../db.js';
import { insufficientStock, notFound } from '../../lib/errors.js';
import { parseMoney } from '../../lib/money.js';

export async function naivePlaceOrder(user, productId, delayMs = 25) {
  // 1. Read product stock WITHOUT locking (No FOR UPDATE)
  const product = await db('products').where({ id: productId }).first();
  if (!product) {
    throw notFound(`Product #${productId} not found`);
  }

  const readStock = Number(product.stock_quantity);

  // 2. Naive in-memory check
  if (readStock < 1) {
    throw insufficientStock(
      [{ product_id: productId, requested: 1, available: readStock }],
      'Insufficient stock (naive check)'
    );
  }

  // 3. Deliberate artificial delay to widen the race condition window
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const now = new Date();
  const unitPrice = parseMoney(product.price);

  // 4. Insecure absolute write: overwrites stock with (readStock - 1)
  await db('products')
    .where({ id: productId })
    .update({
      stock_quantity: readStock - 1,
      updated_at: now,
    });

  // 5. Insert order
  const orderId = await insertAndGetId(db, 'orders', {
    user_id: user.id,
    status: 'placed',
    total: unitPrice,
    created_at: now,
    cancelled_at: null,
  });

  // 6. Insert order item
  await insertAndGetId(db, 'order_items', {
    order_id: orderId,
    product_id: productId,
    quantity: 1,
    unit_price: unitPrice,
  });

  // 7. Insert movement
  await insertAndGetId(db, 'stock_movements', {
    product_id: productId,
    delta: -1,
    reason: 'order',
    order_id: orderId,
    user_id: user.id,
    created_at: now,
  });

  return {
    orderId,
    productId,
    stockBeforeWrite: readStock,
    stockWritten: readStock - 1,
  };
}
