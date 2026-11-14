import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../src/config.js';
import { insertAndGetId } from '../src/db.js';
import { parseMoney } from '../src/lib/money.js';

/**
 * Asserts the core stock invariant:
 * For every product, stock_quantity = SUM(stock_movements.delta) AND stock_quantity >= 0.
 */
export async function assertStockInvariant(db, productId = null) {
  const query = db('products');
  if (productId) {
    query.where({ id: productId });
  }

  const products = await query;

  for (const product of products) {
    const currentStock = Number(product.stock_quantity);

    if (currentStock < 0) {
      throw new Error(
        `Invariant violation: product ${product.id} (${product.sku}) has negative stock_quantity: ${currentStock}`
      );
    }

    const sumResult = await db('stock_movements')
      .where({ product_id: product.id })
      .sum('delta as total_delta')
      .first();

    const totalDelta = sumResult?.total_delta !== null && sumResult?.total_delta !== undefined
      ? Number(sumResult.total_delta)
      : 0;

    if (currentStock !== totalDelta) {
      throw new Error(
        `Invariant violation: product ${product.id} (${product.sku}) stock_quantity (${currentStock}) !== SUM(stock_movements.delta) (${totalDelta})`
      );
    }
  }

  return true;
}

/**
 * Creates a test user directly in the database.
 */
export async function createTestUser(db, {
  email = `user_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
  password = 'password123',
  role = 'customer',
} = {}) {
  const passwordHash = await bcrypt.hash(password, 8);
  const id = await insertAndGetId(db, 'users', {
    email: email.toLowerCase(),
    password_hash: passwordHash,
    role,
  });

  const token = jwt.sign({ sub: id }, config.jwtSecret, { expiresIn: '1h' });

  return {
    id,
    email: email.toLowerCase(),
    password,
    role,
    token,
  };
}

/**
 * Creates a test product directly in the database, with corresponding stock movement if initial stock > 0.
 */
export async function createTestProduct(db, {
  sku = `SKU-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  name = 'Test Product',
  price = 100.00,
  stock_quantity = 0,
  is_active = true,
  userId = null,
} = {}) {
  const now = new Date();
  const id = await insertAndGetId(db, 'products', {
    sku,
    name,
    price: parseMoney(price),
    stock_quantity,
    is_active,
    created_at: now,
    updated_at: now,
  });

  if (stock_quantity > 0 && userId) {
    await insertAndGetId(db, 'stock_movements', {
      product_id: id,
      delta: stock_quantity,
      reason: 'restock',
      order_id: null,
      user_id: userId,
      created_at: now,
    });
  }

  return {
    id,
    sku,
    name,
    price: parseMoney(price),
    stock_quantity,
    is_active,
  };
}
