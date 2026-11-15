# lockstock-api - project context

Inventory & order REST API (products, stock, orders) written to demonstrate correct
transactional behaviour under concurrency (no overselling) with Node.js + Express + SQL
(PostgreSQL primary, MySQL-compatible). Junior backend portfolio project.
Timebox: 3 days core + optional extras. Code, commits, identifiers: English.
README: Thai or English. API only - the only UI is the optional static demo page (see Demo section).

## Stack
- Node.js LTS (>= 20.6), ES modules ("type": "module"), Express (target Express 5 - check `npm ls express`)
- Knex (query builder, migrations, transactions), pg (PostgreSQL); mysql2 only for the optional MySQL extra
- zod (validation), jsonwebtoken, bcryptjs, helmet, cors, express-rate-limit, dotenv
- Tests: Vitest + supertest. No Docker anywhere: run locally with npm; hosted Postgres (Neon).
- Deploy: Render (Node runtime) + Neon Postgres.

## Layout
lockstock-api/
  package.json  knexfile.js  .env.example  .gitignore  README.md
  migrations/          (knex migrations)
  seeds/ or scripts/   (seed-admin script, demo data)
  src/
    app.js             (builds and exports the Express app; no listen - used by tests)
    server.js          (loads env, listens)
    config.js  db.js
    middleware/        auth.js  requireRole.js  error.js  validate.js  rateLimit.js
    routes/            auth.js  products.js  orders.js  reports.js  demo.js (optional)
    services/          orders.js  stock.js     (all transactional logic lives here)
    services/demo/     (optional: oversell.js, naivePlaceOrder.js - see Demo section)
    lib/               money.js  errors.js  withRetry.js
  test/                *.test.js  helpers.js (assertStockInvariant, factories)
  public/              (optional demo page: index.html, demo.js, demo.css)

## Data model (Knex migrations; must work on PostgreSQL and MySQL)
users(id, email unique lowercase, password_hash, role 'admin'|'customer', created_at)
products(id, sku unique, name, price decimal(12,2) >= 0,
         stock_quantity int not null default 0 CHECK (stock_quantity >= 0),
         is_active boolean default true, created_at, updated_at)
orders(id, user_id, status 'placed'|'cancelled', total decimal(12,2), created_at, cancelled_at NULL)
order_items(id, order_id, product_id, quantity int > 0, unit_price decimal(12,2))
         unique(order_id, product_id)              (unit_price = price snapshot at order time)
stock_movements(id, product_id, delta int != 0, reason 'restock'|'adjustment'|'order'|'cancel',
         order_id NULL, user_id, created_at)       (append-only ledger)
Indexes: orders(user_id, created_at), order_items(order_id), stock_movements(product_id, created_at).
Foreign keys use ON DELETE RESTRICT. Products are never hard-deleted (soft delete: is_active=false).
Timestamps are stored in UTC and returned as ISO-8601 with "Z".

## Roles & access
- POST /auth/register always creates role 'customer'. NEVER read role from the request body.
- Admin is created only by `npm run seed:admin` (ADMIN_EMAIL / ADMIN_PASSWORD from env).
- Auth middleware loads the user from the DB on every request (so role changes and deleted users
  take effect immediately). Missing/invalid token: 401. Wrong role: 403.
- A customer touching another user's order gets 404 (not 403). Admin can see all orders.

## API contract
Auth: Authorization: Bearer <jwt> unless marked public.
POST /auth/register {email,password(8-72 bytes)} -> 201 {id,email,role}          (public)
POST /auth/login    JSON {email,password} -> {access_token, token_type:"bearer"}   (public)
GET  /auth/me
GET  /products?q&min_price&max_price&in_stock&limit(1-100, default 20)&offset -> {items,total,limit,offset} (public)
GET  /products/{id}                                                              (public)
POST /products {sku,name,price,initial_stock>=0}                       admin  -> 201 product
PATCH /products/{id} {name?,price?,is_active?}                          admin  (never changes stock)
DELETE /products/{id}                                                   admin  -> 204 (soft delete)
POST /products/{id}/stock {delta(non-zero int), reason:'restock'|'adjustment'} admin
     -> product; 409 INSUFFICIENT_STOCK if the result would be negative
GET  /products/{id}/movements?limit&offset                              admin
POST /orders {items:[{product_id, quantity}]}  (1-50 items; duplicate product_id are merged)
     -> 201 {id,status,total,items:[{product_id,sku,name,quantity,unit_price,line_total}],created_at,cancelled_at}
GET  /orders (own; admin: all, optional ?user_id)   GET /orders/{id}
POST /orders/{id}/cancel -> 200 order; 409 ORDER_NOT_CANCELLABLE if not 'placed'
GET  /reports/low-stock?threshold=5                                     admin
GET  /reports/sales?from&to                                             admin
     -> {order_count, revenue, top_products:[{product_id,sku,name,units,revenue}]} (cancelled orders excluded)
GET  /health                                                                      (public)
Money in JSON is a number with at most 2 decimals. Errors are always
{"error":{"code":"...","message":"...","details":...}} with codes:
VALIDATION_ERROR 422, BAD_REFERENCE 400 (unknown/inactive product), UNAUTHORIZED 401,
FORBIDDEN 403, NOT_FOUND 404, EMAIL_TAKEN 409, SKU_TAKEN 409, INSUFFICIENT_STOCK 409
(details lists product_id, requested, available), ORDER_NOT_CANCELLABLE 409, RATE_LIMITED 429.

## Concurrency rules (the heart of the project - do not weaken)
- Placing an order is ONE database transaction:
  1. SELECT id, price, stock_quantity, is_active FROM products WHERE id IN (...) ORDER BY id FOR UPDATE
     (always lock in ascending id order to avoid deadlocks)
  2. validate: every product exists and is active, stock >= quantity (else ROLLBACK, 409 INSUFFICIENT_STOCK;
     never create partial orders)
  3. insert order + order_items (unit_price = locked price), decrement stock,
     insert stock_movements (negative delta, reason 'order', order_id), compute total, COMMIT.
- Cancel: lock the order row FOR UPDATE; only status 'placed' may be cancelled (else 409);
  lock the products in ascending id order; restore stock; insert movements (positive delta,
  reason 'cancel'); set status 'cancelled' + cancelled_at. Concurrent cancels restore stock exactly once.
- Stock adjustment (admin): one transaction, lock the product row, new stock must be >= 0, write a movement.
  Creating a product with initial_stock > 0 also writes a 'restock' movement.
- INVARIANT that must hold after any sequence of operations: for every product,
  stock_quantity = SUM(stock_movements.delta) and stock_quantity >= 0.
  Provide test helper assertStockInvariant() and call it in the concurrency tests.
- Wrap transactions in withRetry (max 3 attempts, small backoff) ONLY for deadlock/serialization
  errors: Postgres 40P01/40001, MySQL errno 1213. Never retry business errors (409/400/422).
- Totals are computed on the server from the locked unit prices with INTEGER arithmetic
  (satang) in lib/money.js - never float math. Client-supplied prices are ignored.
- The CHECK (stock_quantity >= 0) is defence in depth only (MySQL < 8.0.16 ignores CHECK);
  the application guard is the primary protection.

## Gotchas that MUST be handled (see PDF section 10)
- pg returns NUMERIC, SUM() and COUNT() as strings; mysql2 returns DECIMAL/SUM as strings.
  Convert at the API edge (lib/money.js, Number()).
- MySQL returns booleans as 0/1: convert is_active to a real boolean in the serializer.
- insert id: pg needs .returning('id'); MySQL returns [insertId]. Use one helper.
- Postgres default isolation is READ COMMITTED, MySQL/InnoDB REPEATABLE READ; locking reads
  (FOR UPDATE) see the latest committed data in both, which is why the design relies on them.
- Express 5: async handler errors reach the error middleware automatically (verify the version).

## Demo page (optional, day 4 - build ONLY when the task asks for it)
- Purpose: show visually that the row lock prevents overselling. Mounted ONLY when DEMO_ENABLED=true;
  otherwise the demo API and page return 404.
- POST /demo/api/oversell {stock 1-100 (default 5), buyers 1-50 (default 20), mode 'safe'|'unsafe'}
  (public, 5 req/min/IP, one run at a time -> 409 DEMO_BUSY). It creates a throwaway product
  (sku DEMO-<random>) and a non-loginable demo user, fires `buyers` concurrent order attempts, returns
  {mode, stock, buyers, succeeded, rejected, errors, final_stock, invariant_ok, elapsed_ms,
  results:[{i, outcome, code?, ms}]}, then deletes everything it created (also when it fails).
- 'safe' calls the real placeOrder. 'unsafe' calls a DELIBERATELY WRONG naive implementation
  (unlocked read, short delay, absolute write) that lives only in src/services/demo/ and must NEVER
  be imported by routes/orders or any production path.
- The page is static (public/index.html, demo.js, demo.css), served at /demo with express.static.
  No inline scripts or inline event handlers: helmet's default CSP blocks them. UI text in Thai.
- Never change placeOrder/cancelOrder or the concurrency rules above for the sake of the demo.

## Conventions
- Routes stay thin; transactional logic in services/ so it can be tested directly.
- Config only from environment (.env locally, never committed). In production refuse to start
  if JWT_SECRET is missing or the dev default.
- DB pool: DB_POOL_MAX (default 10; tests use 20 so parallel requests really run concurrently).
- New behaviour needs tests. Work on a branch, open a PR, describe what/why, self-review.
- Never log passwords, tokens or full DB URLs.
- Before finishing any task run `npm test`. Do not change existing endpoint behaviour unless
  the task says so.

## Commands
npm install    npm run dev (node --watch src/server.js)    npm test
npm run migrate (knex migrate:latest)    npm run seed:admin    http://localhost:3000/health
Env: DATABASE_URL, TEST_DATABASE_URL (throwaway DB only: tests reset the schema),
     JWT_SECRET, CORS_ORIGINS, PORT, NODE_ENV, DB_POOL_MAX, ADMIN_EMAIL, ADMIN_PASSWORD,
     DEMO_ENABLED (default false), DEMO_NAIVE_DELAY_MS (default 25)
