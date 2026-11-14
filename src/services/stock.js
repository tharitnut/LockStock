import db, { insertAndGetId } from '../db.js';
import { notFound, skuTaken, insufficientStock } from '../lib/errors.js';
import { parseMoney } from '../lib/money.js';

export function serializeProduct(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sku: row.sku,
    name: row.name,
    price: parseMoney(row.price),
    stock_quantity: Number(row.stock_quantity),
    is_active: Boolean(row.is_active),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export function serializeMovement(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    product_id: Number(row.product_id),
    delta: Number(row.delta),
    reason: row.reason,
    order_id: row.order_id !== null ? Number(row.order_id) : null,
    user_id: Number(row.user_id),
    created_at: new Date(row.created_at).toISOString(),
  };
}

/**
 * Create a new product. If initial_stock > 0, writes a 'restock' movement.
 */
export async function createProduct({ sku, name, price, initial_stock = 0, userId }) {
  return await db.transaction(async (trx) => {
    const existing = await trx('products').where({ sku }).first();
    if (existing) {
      throw skuTaken(`Product with SKU '${sku}' already exists`);
    }

    const initialStock = Number(initial_stock) || 0;
    const now = new Date();

    const productId = await insertAndGetId(trx, 'products', {
      sku,
      name,
      price: parseMoney(price),
      stock_quantity: initialStock,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    if (initialStock > 0) {
      await insertAndGetId(trx, 'stock_movements', {
        product_id: productId,
        delta: initialStock,
        reason: 'restock',
        order_id: null,
        user_id: userId,
        created_at: now,
      });
    }

    const created = await trx('products').where({ id: productId }).first();
    return serializeProduct(created);
  });
}

/**
 * Adjust stock for a product in a single transaction with row locking (FOR UPDATE).
 */
export async function adjustStock({ productId, delta, reason, userId }) {
  return await db.transaction(async (trx) => {
    // 1. Lock the product row FOR UPDATE
    const product = await trx('products')
      .where({ id: productId })
      .forUpdate()
      .first();

    if (!product) {
      throw notFound(`Product with ID ${productId} not found`);
    }

    const currentStock = Number(product.stock_quantity);
    const newStock = currentStock + delta;

    if (newStock < 0) {
      throw insufficientStock(
        [{
          product_id: productId,
          requested: Math.abs(delta),
          available: currentStock,
        }],
        'Insufficient stock: adjustment would result in negative stock'
      );
    }

    const now = new Date();

    // 2. Update product stock
    await trx('products')
      .where({ id: productId })
      .update({
        stock_quantity: newStock,
        updated_at: now,
      });

    // 3. Write movement
    await insertAndGetId(trx, 'stock_movements', {
      product_id: productId,
      delta,
      reason,
      order_id: null,
      user_id: userId,
      created_at: now,
    });

    const updated = await trx('products').where({ id: productId }).first();
    return serializeProduct(updated);
  });
}
