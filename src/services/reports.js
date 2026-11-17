import db from '../db.js';
import { parseMoney } from '../lib/money.js';
import { serializeProduct } from './stock.js';

/**
 * Returns active products with stock_quantity <= threshold, sorted by stock ascending.
 */
export async function getLowStockReport(threshold = 5) {
  const products = await db('products')
    .where('is_active', true)
    .where('stock_quantity', '<=', threshold)
    .orderBy('stock_quantity', 'asc')
    .orderBy('id', 'asc');

  return {
    items: products.map(serializeProduct),
    total: products.length,
    threshold: Number(threshold),
  };
}

/**
 * Returns sales summary within a date range:
 * - order_count (non-cancelled orders)
 * - revenue (total sum of non-cancelled orders)
 * - top_products: products aggregated by units sold and revenue
 */
export async function getSalesReport(fromDate, toDate) {
  // 1. Overall order aggregates in SQL (excluding cancelled orders)
  const orderAgg = await db('orders')
    .where('status', 'placed')
    .where('created_at', '>=', fromDate)
    .where('created_at', '<=', toDate)
    .count('* as order_count')
    .sum('total as revenue')
    .first();

  const order_count = orderAgg ? Number(orderAgg.order_count) : 0;
  const revenue = orderAgg && orderAgg.revenue !== null ? parseMoney(orderAgg.revenue) : 0;

  // 2. Top products aggregate in SQL
  const topProductsRaw = await db('order_items')
    .join('orders', 'order_items.order_id', 'orders.id')
    .join('products', 'order_items.product_id', 'products.id')
    .where('orders.status', 'placed')
    .where('orders.created_at', '>=', fromDate)
    .where('orders.created_at', '<=', toDate)
    .groupBy('order_items.product_id', 'products.sku', 'products.name')
    .select(
      'order_items.product_id',
      'products.sku',
      'products.name',
      db.raw('SUM(order_items.quantity) as units'),
      db.raw('SUM(order_items.quantity * order_items.unit_price) as revenue')
    )
    .orderBy('units', 'desc')
    .orderBy('revenue', 'desc')
    .orderBy('order_items.product_id', 'asc');

  const top_products = topProductsRaw.map((row) => ({
    product_id: Number(row.product_id),
    sku: row.sku,
    name: row.name,
    units: Number(row.units),
    revenue: parseMoney(row.revenue),
  }));

  return {
    order_count,
    revenue,
    top_products,
  };
}
