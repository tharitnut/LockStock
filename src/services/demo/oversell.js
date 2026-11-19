import crypto from 'crypto';
import db, { insertAndGetId } from '../../db.js';
import config from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { placeOrder } from '../orders.js';
import { naivePlaceOrder } from './naivePlaceOrder.js';

let isDemoRunning = false;

/**
 * Gets or creates a throwaway non-loginable demo user
 */
async function getOrCreateDemoUser() {
  const email = 'demo_system_user@lockstock.internal';
  let user = await db('users').where({ email }).first();

  if (!user) {
    const randomHash = `$2a$04$${crypto.randomBytes(24).toString('base64url')}`;
    const id = await insertAndGetId(db, 'users', {
      email,
      password_hash: randomHash,
      role: 'customer',
      created_at: new Date(),
    });
    user = { id, email, role: 'customer' };
  }

  return user;
}

/**
 * Runs the oversell demo in 'safe' (row locks) or 'unsafe' (no locks) mode.
 */
export async function runOversellDemo({ stock = 5, buyers = 20, mode = 'safe' }) {
  if (isDemoRunning) {
    throw new AppError(
      'DEMO_BUSY',
      'Another demo simulation is currently running. Please try again in a few moments.',
      409
    );
  }

  isDemoRunning = true;

  let createdProductId = null;
  const startTime = Date.now();

  try {
    const demoUser = await getOrCreateDemoUser();
    const sku = `DEMO-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
    const initialStock = Number(stock);
    const now = new Date();

    // 1. Create throwaway demo product
    createdProductId = await insertAndGetId(db, 'products', {
      sku,
      name: `Flash Sale Demo Item (${sku})`,
      price: 99.00,
      stock_quantity: initialStock,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    // Write initial 'restock' movement
    if (initialStock > 0) {
      await insertAndGetId(db, 'stock_movements', {
        product_id: createdProductId,
        delta: initialStock,
        reason: 'restock',
        order_id: null,
        user_id: demoUser.id,
        created_at: now,
      });
    }

    // 2. Fire concurrent buyer attempts with 15s timeout
    const attempts = Array.from({ length: buyers }, async (_, idx) => {
      const attemptStart = Date.now();
      try {
        if (mode === 'safe') {
          await placeOrder(demoUser, [{ product_id: createdProductId, quantity: 1 }]);
        } else {
          await naivePlaceOrder(demoUser, createdProductId, config.demoNaiveDelayMs);
        }

        return {
          i: idx + 1,
          outcome: 'ok',
          ms: Date.now() - attemptStart,
        };
      } catch (err) {
        const isInsufficient =
          err.code === 'INSUFFICIENT_STOCK' ||
          err.status === 409 ||
          err.message?.includes('Insufficient stock');

        return {
          i: idx + 1,
          outcome: isInsufficient ? 'rejected' : 'error',
          code: err.code || 'ERROR',
          ms: Date.now() - attemptStart,
        };
      }
    });

    // Run all attempts with timeout protection
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Simulation timed out after 15 seconds')), 15000)
    );

    const settledResults = await Promise.race([
      Promise.allSettled(attempts),
      timeoutPromise,
    ]);

    const results = settledResults.map((r, idx) =>
      r.status === 'fulfilled'
        ? r.value
        : { i: idx + 1, outcome: 'error', code: 'TIMEOUT', ms: 15000 }
    );

    // 3. Inspect final state
    const finalProduct = await db('products').where({ id: createdProductId }).first();
    const final_stock = finalProduct ? Number(finalProduct.stock_quantity) : 0;

    const sumResult = await db('stock_movements')
      .where({ product_id: createdProductId })
      .sum('delta as total_delta')
      .first();

    const totalDelta = sumResult?.total_delta !== null && sumResult?.total_delta !== undefined
      ? Number(sumResult.total_delta)
      : 0;

    const invariant_ok = final_stock === totalDelta && final_stock >= 0;

    const succeeded = results.filter((r) => r.outcome === 'ok').length;
    const rejected = results.filter((r) => r.outcome === 'rejected').length;
    const errors = results.filter((r) => r.outcome === 'error').length;
    const elapsed_ms = Date.now() - startTime;

    return {
      mode,
      stock: initialStock,
      buyers: Number(buyers),
      succeeded,
      rejected,
      errors,
      final_stock,
      invariant_ok,
      elapsed_ms,
      results,
    };
  } finally {
    // 4. Guaranteed cleanup: delete all created rows in dependency order
    if (createdProductId) {
      try {
        // Delete movements
        await db('stock_movements').where({ product_id: createdProductId }).delete();

        // Find associated orders
        const orderItems = await db('order_items').where({ product_id: createdProductId });
        const orderIds = orderItems.map((oi) => oi.order_id);

        // Delete order items
        await db('order_items').where({ product_id: createdProductId }).delete();

        // Delete orders
        if (orderIds.length > 0) {
          await db('orders').whereIn('id', orderIds).delete();
        }

        // Delete product
        await db('products').where({ id: createdProductId }).delete();
      } catch (cleanupErr) {
        console.error('Error during demo cleanup:', cleanupErr);
      }
    }

    // Safety sweep: purge any lingering DEMO- products if any exist
    try {
      const lingeringProds = await db('products').where('sku', 'like', 'DEMO-%');
      if (lingeringProds.length > 0) {
        const pids = lingeringProds.map((p) => p.id);
        await db('stock_movements').whereIn('product_id', pids).delete();
        const ois = await db('order_items').whereIn('product_id', pids);
        const oids = ois.map((o) => o.order_id);
        await db('order_items').whereIn('product_id', pids).delete();
        if (oids.length > 0) {
          await db('orders').whereIn('id', oids).delete();
        }
        await db('products').whereIn('id', pids).delete();
      }
    } catch (sweepErr) {
      console.error('Error during DEMO safety sweep:', sweepErr);
    }

    isDemoRunning = false;
  }
}
