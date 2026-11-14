/**
 * Initial database migration creating 5 tables:
 * users, products, orders, order_items, stock_movements
 * Works on PostgreSQL and MySQL (no Postgres-only extensions or types).
 */

export async function up(knex) {
  // 1. users
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('role', 20).notNullable().defaultTo('customer');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.check("role IN ('admin', 'customer')");
  });

  // 2. products
  await knex.schema.createTable('products', (table) => {
    table.increments('id').primary();
    table.string('sku', 100).notNullable().unique();
    table.string('name', 255).notNullable();
    table.decimal('price', 12, 2).notNullable();
    table.integer('stock_quantity').notNullable().defaultTo(0);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.check('price >= 0');
    table.check('stock_quantity >= 0');
  });

  // 3. orders
  await knex.schema.createTable('orders', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('status', 20).notNullable().defaultTo('placed');
    table.decimal('total', 12, 2).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('cancelled_at').nullable();

    table.check("status IN ('placed', 'cancelled')");
    table.index(['user_id', 'created_at']);
  });

  // 4. order_items
  await knex.schema.createTable('order_items', (table) => {
    table.increments('id').primary();
    table.integer('order_id').notNullable().references('id').inTable('orders').onDelete('RESTRICT');
    table.integer('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
    table.integer('quantity').notNullable();
    table.decimal('unit_price', 12, 2).notNullable();

    table.check('quantity > 0');
    table.unique(['order_id', 'product_id']);
    table.index(['order_id']);
  });

  // 5. stock_movements
  await knex.schema.createTable('stock_movements', (table) => {
    table.increments('id').primary();
    table.integer('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
    table.integer('delta').notNullable();
    table.string('reason', 20).notNullable();
    table.integer('order_id').nullable().references('id').inTable('orders').onDelete('RESTRICT');
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.check('delta != 0');
    table.check("reason IN ('restock', 'adjustment', 'order', 'cancel')");
    table.index(['product_id', 'created_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('stock_movements');
  await knex.schema.dropTableIfExists('order_items');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('users');
}
