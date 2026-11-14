import dotenv from 'dotenv';
dotenv.config();

// Enforce NODE_ENV=test
process.env.NODE_ENV = 'test';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('FATAL: TEST_DATABASE_URL is not defined in environment variables.');
}

if (process.env.TEST_DATABASE_URL.trim() === process.env.DATABASE_URL?.trim()) {
  throw new Error(
    'FATAL SAFETY CHECK: TEST_DATABASE_URL equals DATABASE_URL! Refusing to run tests to prevent destroying non-test database.'
  );
}

import { beforeAll, beforeEach, afterAll } from 'vitest';
import db from '../src/db.js';

beforeAll(async () => {
  try {
    await db.migrate.latest({
      directory: './migrations',
    });
  } catch (err) {
    if (!err.message?.includes('already exists') && err.code !== '23505') {
      console.error('Failed to run migrations on TEST_DATABASE_URL:', err);
      throw err;
    }
  }
});

beforeEach(async () => {
  const isPg = db.client.dialect === 'postgresql' || db.client.config.client === 'pg';
  if (isPg) {
    await db.raw('TRUNCATE TABLE stock_movements, order_items, orders, products, users RESTART IDENTITY CASCADE');
  } else {
    await db.raw('SET FOREIGN_KEY_CHECKS = 0');
    await db('stock_movements').truncate();
    await db('order_items').truncate();
    await db('orders').truncate();
    await db('products').truncate();
    await db('users').truncate();
    await db.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
});

afterAll(async () => {
  await db.destroy();
});
