import db, { insertAndGetId } from '../db.js';
import {
  badReference,
  insufficientStock,
  notFound,
  orderNotCancellable,
} from '../lib/errors.js';
import { parseMoney, toSatang, fromSatang, multiplyMoney } from '../lib/money.js';
import { withRetry } from '../lib/withRetry.js';

export function serializeOrder(orderRow, items = []) {
  if (!orderRow) return null;

  return {
    id: Number(orderRow.id),
    status: orderRow.status,
    total: parseMoney(orderRow.total),
    items: items.map((item) => ({
      product_id: Number(item.product_id),
      sku: item.sku,
      name: item.name,
      quantity: Number(item.quantity),
      unit_price: parseMoney(item.unit_price),
      line_total: multiplyMoney(item.unit_price, item.quantity),
    })),
    created_at: new Date(orderRow.created_at).toISOString(),
    cancelled_at: orderRow.cancelled_at ? new Date(orderRow.cancelled_at).toISOString() : null,
  };
}

/**
 * Places an order within a single transaction using pessimistic row locking.
 * Locks products in ascending id order to avoid deadlocks.
 */
export async function placeOrder(user, rawItems) {
  // 1. Merge duplicate product_id entries in rawItems
  const mergedMap = new Map();
  for (const item of rawItems) {
    const pid = Number(item.product_id);
    const qty = Number(item.quantity);
    mergedMap.set(pid, (mergedMap.get(pid) || 0) + qty);
  }

  const mergedItems = Array.from(mergedMap.entries()).map(([product_id, quantity]) => ({
    product_id,
    quantity,
  }));

  // Sort product IDs in strictly ascending numerical order for deadlock prevention
  const sortedProductIds = mergedItems.map((item) => item.product_id).sort((a, b) => a - b);

  return await withRetry(async () => {
    return await db.transaction(async (trx) => {
      // 2. Lock products ORDER BY id FOR UPDATE
      const lockedProducts = await trx('products')
        .whereIn('id', sortedProductIds)
        .orderBy('id', 'asc')
        .forUpdate();

      const productMap = new Map();
      for (const p of lockedProducts) {
        productMap.set(Number(p.id), p);
      }

      // 3. Validate every product exists and is active
      for (const item of mergedItems) {
        const product = productMap.get(item.product_id);
        if (!product || !product.is_active) {
          throw badReference(`Product ID ${item.product_id} does not exist or is inactive`);
        }
      }

      // 4. Validate stock availability (all-or-nothing, never partial orders)
      const insufficientDetails = [];
      for (const item of mergedItems) {
        const product = productMap.get(item.product_id);
        const available = Number(product.stock_quantity);
        if (available < item.quantity) {
          insufficientDetails.push({
            product_id: item.product_id,
            requested: item.quantity,
            available,
          });
        }
      }

      if (insufficientDetails.length > 0) {
        throw insufficientStock(
          insufficientDetails,
          'Insufficient stock for one or more requested products'
        );
      }

      // 5. Calculate total using satang integer arithmetic (never float math)
      let totalSatang = 0;
      const orderItemsToInsert = [];

      for (const item of mergedItems) {
        const product = productMap.get(item.product_id);
        const unitPrice = parseMoney(product.price);
        const lineSatang = toSatang(unitPrice) * item.quantity;
        totalSatang += lineSatang;

        orderItemsToInsert.push({
          product_id: item.product_id,
          sku: product.sku,
          name: product.name,
          quantity: item.quantity,
          unit_price: unitPrice,
        });
      }

      const totalAmount = fromSatang(totalSatang);
      const now = new Date();

      // 6. Insert order
      const orderId = await insertAndGetId(trx, 'orders', {
        user_id: user.id,
        status: 'placed',
        total: totalAmount,
        created_at: now,
        cancelled_at: null,
      });

      // 7. Insert order_items, decrement stock, and insert stock_movements
      // Iterate sorted by product_id
      for (const item of orderItemsToInsert) {
        const product = productMap.get(item.product_id);

        await insertAndGetId(trx, 'order_items', {
          order_id: orderId,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
        });

        const newStock = Number(product.stock_quantity) - item.quantity;
        await trx('products')
          .where({ id: item.product_id })
          .update({
            stock_quantity: newStock,
            updated_at: now,
          });

        await insertAndGetId(trx, 'stock_movements', {
          product_id: item.product_id,
          delta: -item.quantity,
          reason: 'order',
          order_id: orderId,
          user_id: user.id,
          created_at: now,
        });
      }

      return serializeOrder(
        {
          id: orderId,
          status: 'placed',
          total: totalAmount,
          created_at: now,
          cancelled_at: null,
        },
        orderItemsToInsert
      );
    });
  });
}

/**
 * Cancels an order within a single transaction.
 * Locks the order row FOR UPDATE, verifies eligibility, locks products in ascending id order,
 * restores stock, records 'cancel' movements, and marks order cancelled.
 */
export async function cancelOrder(user, orderId) {
  return await withRetry(async () => {
    return await db.transaction(async (trx) => {
      // 1. Lock the order row FOR UPDATE
      const order = await trx('orders')
        .where({ id: orderId })
        .forUpdate()
        .first();

      if (!order) {
        throw notFound(`Order #${orderId} not found`);
      }

      // Customer touching another user's order gets 404 (not 403)
      if (user.role !== 'admin' && Number(order.user_id) !== Number(user.id)) {
        throw notFound(`Order #${orderId} not found`);
      }

      // Only status 'placed' may be cancelled
      if (order.status !== 'placed') {
        throw orderNotCancellable(`Order #${orderId} cannot be cancelled (current status: '${order.status}')`);
      }

      // 2. Fetch order items
      const items = await trx('order_items')
        .join('products', 'order_items.product_id', 'products.id')
        .where({ 'order_items.order_id': orderId })
        .select(
          'order_items.product_id',
          'order_items.quantity',
          'order_items.unit_price',
          'products.sku',
          'products.name'
        );

      // Sort product IDs in ascending order for deadlock-free locking
      const sortedProductIds = items
        .map((i) => Number(i.product_id))
        .sort((a, b) => a - b);

      // 3. Lock products in ascending order FOR UPDATE
      const lockedProducts = await trx('products')
        .whereIn('id', sortedProductIds)
        .orderBy('id', 'asc')
        .forUpdate();

      const productMap = new Map();
      for (const p of lockedProducts) {
        productMap.set(Number(p.id), p);
      }

      const now = new Date();

      // 4. Restore stock and insert movements with positive delta
      for (const item of items) {
        const product = productMap.get(Number(item.product_id));
        const currentStock = Number(product.stock_quantity);
        const restoredStock = currentStock + Number(item.quantity);

        await trx('products')
          .where({ id: item.product_id })
          .update({
            stock_quantity: restoredStock,
            updated_at: now,
          });

        await insertAndGetId(trx, 'stock_movements', {
          product_id: item.product_id,
          delta: Number(item.quantity),
          reason: 'cancel',
          order_id: orderId,
          user_id: user.id,
          created_at: now,
        });
      }

      // 5. Update order status and cancelled_at
      await trx('orders')
        .where({ id: orderId })
        .update({
          status: 'cancelled',
          cancelled_at: now,
        });

      return serializeOrder(
        {
          ...order,
          status: 'cancelled',
          cancelled_at: now,
        },
        items
      );
    });
  });
}

/**
 * Fetch a single order with its items, respecting permissions.
 */
export async function getOrderById(user, orderId) {
  const order = await db('orders').where({ id: orderId }).first();

  if (!order) {
    throw notFound(`Order #${orderId} not found`);
  }

  // Customer touching another user's order gets 404 (not 403)
  if (user.role !== 'admin' && Number(order.user_id) !== Number(user.id)) {
    throw notFound(`Order #${orderId} not found`);
  }

  const items = await db('order_items')
    .join('products', 'order_items.product_id', 'products.id')
    .where({ 'order_items.order_id': orderId })
    .select(
      'order_items.product_id',
      'order_items.quantity',
      'order_items.unit_price',
      'products.sku',
      'products.name'
    );

  return serializeOrder(order, items);
}

/**
 * List orders with pagination and filtering.
 */
export async function listOrders(user, { limit = 20, offset = 0, user_id = null }) {
  const query = db('orders');

  if (user.role !== 'admin') {
    query.where({ user_id: user.id });
  } else if (user_id !== null && user_id !== undefined) {
    query.where({ user_id });
  }

  const countResult = await query.clone().count('* as count').first();
  const total = countResult ? Number(countResult.count) : 0;

  const orders = await query
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset);

  const orderIds = orders.map((o) => o.id);

  let itemsByOrder = new Map();
  if (orderIds.length > 0) {
    const allItems = await db('order_items')
      .join('products', 'order_items.product_id', 'products.id')
      .whereIn('order_items.order_id', orderIds)
      .select(
        'order_items.order_id',
        'order_items.product_id',
        'order_items.quantity',
        'order_items.unit_price',
        'products.sku',
        'products.name'
      );

    for (const item of allItems) {
      const oid = Number(item.order_id);
      if (!itemsByOrder.has(oid)) {
        itemsByOrder.set(oid, []);
      }
      itemsByOrder.get(oid).push(item);
    }
  }

  return {
    items: orders.map((order) => serializeOrder(order, itemsByOrder.get(Number(order.id)) || [])),
    total,
    limit,
    offset,
  };
}
