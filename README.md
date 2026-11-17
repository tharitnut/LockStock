# LockStock API

> **Inventory & Order REST API with Transactional Concurrency Control**  
> Built with Node.js, Express 5, Knex, PostgreSQL (Neon), and Vitest. Designed to demonstrate correct transactional behavior under high concurrency—preventing overselling, eliminating deadlocks, and maintaining strict ledger invariants.

---

## 📌 Overview

LockStock is a backend portfolio project demonstrating production-grade relational database transactions and concurrency patterns. When multiple customers purchase the same high-demand product simultaneously, standard read-check-write patterns fail due to race conditions (overselling). LockStock solves this through:

- **Pessimistic Row Locking (`SELECT ... FOR UPDATE`)**: Locks rows in ascending primary key order to eliminate deadlocks.
- **Single-Transaction Atomicity**: Product validation, stock deduction, order snapshotting, and ledger creation occur within a single database transaction.
- **Append-Only Ledger**: Every stock change (order, cancel, restock, adjustment) is recorded in `stock_movements`.
- **Strict Invariant Verification**: `stock_quantity = SUM(stock_movements.delta) >= 0` tested under heavy parallel load.
- **Safe Integer Arithmetic**: All monetary calculations use integer satang (cents) to avoid IEEE-754 floating-point inaccuracies.

---

## 🛠️ Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| **Runtime** | Node.js (>= 20.6 LTS) | Modern ES Modules (`"type": "module"`) |
| **Framework** | Express 5 (`^5.0.0`) | Built-in async error delegation without wrappers |
| **Database** | PostgreSQL (Neon Serverless) | ACID compliance, row-level locks, transactional DDL |
| **Query Builder** | Knex.js (`^3.1.0`) | Programmatic queries, migrations, dialect-agnostic |
| **Validation** | Zod (`^3.23.0`) | Schema-first request parsing and sanitization |
| **Auth & Security** | JWT + bcryptjs + Helmet + CORS | Stateless tokens, salt rounds = 10, OWASP headers |
| **Testing** | Vitest + Supertest | Integration tests directly hitting PostgreSQL instance |

---

## 🗄️ Database Architecture

The relational schema consists of 5 core tables designed with strict referential integrity (`ON DELETE RESTRICT`):

```mermaid
erDiagram
    USERS ||--o{ ORDERS : places
    USERS ||--o{ STOCK_MOVEMENTS : logs
    PRODUCTS ||--o{ ORDER_ITEMS : contains
    ORDERS ||--|{ ORDER_ITEMS : includes
    PRODUCTS ||--o{ STOCK_MOVEMENTS : tracks

    USERS {
        int id PK
        string email UK
        string password_hash
        string role "admin | customer"
        timestamp created_at
    }

    PRODUCTS {
        int id PK
        string sku UK
        string name
        decimal price "CHECK >= 0"
        int stock_quantity "CHECK >= 0"
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }

    ORDERS {
        int id PK
        int user_id FK
        string status "placed | cancelled"
        decimal total
        timestamp created_at
        timestamp cancelled_at
    }

    ORDER_ITEMS {
        int id PK
        int order_id FK
        int product_id FK
        int quantity "CHECK > 0"
        decimal unit_price "Snapshot price"
    }

    STOCK_MOVEMENTS {
        int id PK
        int product_id FK
        int delta "CHECK != 0"
        string reason "restock | adjustment | order | cancel"
        int order_id FK "nullable"
        int user_id FK
        timestamp created_at
    }
```

---

## 🔒 Concurrency Design & Transaction Flow

### The Overselling Problem
When two concurrent requests read `stock = 1`, both see sufficient stock, both decrement, and the final stock becomes `-1` (oversold).

### The Solution: Ascending Row Locks
```mermaid
sequenceDiagram
    autonumber
    actor Client A as Client A
    actor Client B as Client B
    participant API as Express API
    participant DB as PostgreSQL (Neon)

    Client A->>API: POST /orders (Product #1, Qty 1)
    Client B->>API: POST /orders (Product #1, Qty 1)
    
    rect rgb(240, 248, 255)
        Note over API,DB: BEGIN TRANSACTION (Client A)
        API->>DB: SELECT * FROM products WHERE id = 1 FOR UPDATE
        DB-->>API: Row locked (Stock: 1)
    end

    rect rgb(255, 240, 240)
        Note over API,DB: BEGIN TRANSACTION (Client B)
        API->>DB: SELECT * FROM products WHERE id = 1 FOR UPDATE
        Note over DB: Client B BLOCKED waiting for Client A's lock
    end

    rect rgb(240, 248, 255)
        API->>DB: UPDATE products SET stock_quantity = 0
        API->>DB: INSERT INTO orders & order_items
        API->>DB: INSERT INTO stock_movements (delta = -1, reason = 'order')
        API->>DB: COMMIT TRANSACTION
    end

    API-->>Client A: 201 Created (Order confirmed)

    rect rgb(255, 240, 240)
        Note over DB: Lock released -> Client B acquires row
        DB-->>API: Row data returned (Stock: 0)
        Note over API: Validation fails (Stock < Requested)
        API->>DB: ROLLBACK
    end

    API-->>Client B: 409 INSUFFICIENT_STOCK
```

### Why Sort Locked Product IDs in Ascending Order?
If Transaction 1 requests Products `[A, B]` and Transaction 2 requests Products `[B, A]`, they can lock rows in opposite order, creating a **Deadlock cycle**:
- Tx 1 holds lock on A, waits for B
- Tx 2 holds lock on B, waits for A

By **always sorting product IDs ascending (`ORDER BY id ASC FOR UPDATE`)**, every transaction acquires locks in the identical order, mathematically eliminating the cyclic lock dependency.

---

## 🚀 Getting Started

### Prerequisites
- Node.js `>= 20.6.0`
- A PostgreSQL database (e.g. [Neon](https://neon.tech) free tier). **Two databases or branches are needed**: one for dev, one for testing.

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/tharitnut/LockStock.git
cd LockStock
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://user:password@host/neondb?sslmode=require
TEST_DATABASE_URL=postgresql://user:password@host/neondb_test?sslmode=require
JWT_SECRET=your_secure_random_jwt_secret_at_least_32_characters
CORS_ORIGINS=http://localhost:3000
DB_POOL_MAX=10
ADMIN_EMAIL=admin@lockstock.com
ADMIN_PASSWORD=AdminPassword123!
```

> **Security Note:** `TEST_DATABASE_URL` must point to an isolated test database. Tests automatically wipe and rebuild the schema and will refuse to execute if `TEST_DATABASE_URL === DATABASE_URL`.

### 3. Run Migrations & Seed Admin
```bash
# Run migrations on development database
npm run migrate

# Seed initial admin user
npm run seed:admin
```

### 4. Start Server
```bash
# Development mode (with file watcher)
npm run dev

# Production mode
npm start
```

### 5. Run Test Suite
```bash
npm test
```

---

## 📡 API Reference

Base URL: `http://localhost:3000`

### Public Endpoints

#### Health Check
```bash
curl -X GET http://localhost:3000/health
```
Response:
```json
{
  "status": "OK",
  "timestamp": "2026-11-15T03:40:00.000Z"
}
```

#### Register Customer
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@example.com","password":"password123"}'
```
Response `201 Created`:
```json
{
  "id": 1,
  "email": "customer@example.com",
  "role": "customer"
}
```

#### Login
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@example.com","password":"password123"}'
```
Response `200 OK`:
```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer"
}
```

#### Browse Products
```bash
curl -X GET "http://localhost:3000/products?q=keyboard&min_price=10&in_stock=true&limit=20&offset=0"
```
Response `200 OK`:
```json
{
  "items": [
    {
      "id": 1,
      "sku": "KEY-001",
      "name": "Mechanical Keyboard",
      "price": 99.99,
      "stock_quantity": 25,
      "is_active": true,
      "created_at": "2026-11-15T03:30:00.000Z",
      "updated_at": "2026-11-15T03:30:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### Authenticated Endpoints (`Authorization: Bearer <token>`)

#### Get Current Profile
```bash
curl -X GET http://localhost:3000/auth/me \
  -H "Authorization: Bearer <token>"
```

---

### Admin Endpoints (`Role: admin`)

#### Create Product
```bash
curl -X POST http://localhost:3000/products \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "MOUSE-01",
    "name": "Wireless Mouse",
    "price": 49.50,
    "initial_stock": 50
  }'
```

#### Update Product (Metadata only, never stock)
```bash
curl -X PATCH http://localhost:3000/products/1 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"price": 45.00}'
```

#### Adjust Stock (Audited Transaction)
```bash
curl -X POST http://localhost:3000/products/1/stock \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "delta": -5,
    "reason": "adjustment"
  }'
```

#### View Stock Movement Ledger
```bash
curl -X GET "http://localhost:3000/products/1/movements?limit=10&offset=0" \
  -H "Authorization: Bearer <admin_token>"
```

#### Soft Delete Product
```bash
curl -X DELETE http://localhost:3000/products/1 \
  -H "Authorization: Bearer <admin_token>"
```

#### Low-Stock Alert Report
```bash
curl -X GET "http://localhost:3000/reports/low-stock?threshold=5" \
  -H "Authorization: Bearer <admin_token>"
```

#### Sales Performance Report (Excluding Cancelled Orders)
```bash
curl -X GET "http://localhost:3000/reports/sales?from=2026-11-01&to=2026-11-30" \
  -H "Authorization: Bearer <admin_token>"
```
Response:
```json
{
  "order_count": 15,
  "revenue": 1499.50,
  "top_products": [
    {
      "product_id": 1,
      "sku": "KEY-001",
      "name": "Mechanical Keyboard",
      "units": 10,
      "revenue": 999.90
    }
  ]
}
```

---

### Customer Endpoints (`Role: customer | admin`)

#### Place Order (1-50 items, ACID Transaction)
```bash
curl -X POST http://localhost:3000/orders \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "product_id": 1, "quantity": 2 },
      { "product_id": 2, "quantity": 1 }
    ]
  }'
```

#### List Orders (Own orders; Admin lists all)
```bash
curl -X GET "http://localhost:3000/orders?limit=20&offset=0" \
  -H "Authorization: Bearer <token>"
```

#### Get Order Details
```bash
curl -X GET http://localhost:3000/orders/1 \
  -H "Authorization: Bearer <token>"
```

#### Cancel Order (Restores Stock Exactly Once)
```bash
curl -X POST http://localhost:3000/orders/1/cancel \
  -H "Authorization: Bearer <token>"
```

---

## 🚢 Deployment

For complete production deployment instructions to **Render + Neon PostgreSQL**, see [docs/DEPLOY.md](docs/DEPLOY.md). Includes environment variable tables, migration commands, and post-deployment smoke tests.

---

## 🎯 Design Decisions

1. **Pessimistic Locking vs. Optimistic Locking:**
   - Under heavy contention (flash sales), optimistic locking leads to frequent write conflicts and rollback overhead. Pessimistic row locking (`FOR UPDATE`) serializes access cleanly, ensuring predictable completion times and zero overselling.
2. **Integer Money Representation (`src/lib/money.js`):**
   - JavaScript `Number` uses 64-bit binary floating-point (`0.1 + 0.2 === 0.30000000000000004`). All calculations convert decimals into integer satang (1 THB = 100 satang) before summation and multiplication.
3. **Price Snapshotting in Orders:**
   - Products can change prices anytime. `order_items.unit_price` stores a historical snapshot locked at checkout time so past orders remain immutable.
4. **Soft Delete (`is_active: false`):**
   - Products with historical orders or stock movements cannot be hard-deleted without violating foreign key constraints. Soft delete preserves ledger integrity while hiding products from public listings.
5. **Always Reload User from DB on Request:**
   - Rather than trusting claims inside the JWT indefinitely, `authenticate` loads the user record on each request. Revoked permissions or deleted accounts take effect immediately.

---

## ⚠️ Known Limitations
- **Distributed Locks**: Relies on PostgreSQL's internal lock manager. In a multi-database or sharded topology, a distributed coordinator (e.g., Redis Redlock) would be required.
- **Queueing vs. Immediate Rejection**: Under extreme spikes, requests queue behind row locks until connection pool exhaustion. A message queue (e.g., RabbitMQ, BullMQ) or rate limiter is recommended as first line of defense.
