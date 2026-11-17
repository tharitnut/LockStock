# Deployment Guide: Render + Neon PostgreSQL

This guide covers deploying the **LockStock API** to [Render](https://render.com) using the native Node.js runtime and [Neon](https://neon.tech) serverless PostgreSQL.

---

## 1. Prerequisites
- A GitHub repository with the latest code pushed to `main`.
- A Neon PostgreSQL account with an active project database.
- A Render account.

---

## 2. Environment Variables Checklist

Configure the following environment variables in Render Dashboard under **Environment**:

| Variable | Value / Description | Required |
|---|---|---|
| `NODE_ENV` | `production` | Yes |
| `PORT` | `10000` (or leave default, Render sets `PORT` automatically) | Yes |
| `DATABASE_URL` | Neon pooled connection string: `postgresql://user:pass@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require` | Yes |
| `JWT_SECRET` | Secure random string (at least 32 characters, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`). Server will refuse to start if missing or dev default! | Yes |
| `CORS_ORIGINS` | Allowed frontend origin URLs (e.g. `https://your-frontend.onrender.com` or `*`) | Yes |
| `DB_POOL_MAX` | `5` or `10` (recommended for Render free/starter tier with Neon) | Yes |
| `ADMIN_EMAIL` | Administrator email address for initial seeding | Yes |
| `ADMIN_PASSWORD` | Strong administrator password | Yes |
| `DEMO_ENABLED` | `false` (set to `true` only if hosting live concurrency visualizer) | No |
| `DEMO_NAIVE_DELAY_MS`| `25` (only used when `DEMO_ENABLED=true`) | No |

---

## 3. Creating the Render Web Service

1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository (`LockStock`).
4. Set the service settings:
   - **Name**: `lockstock-api`
   - **Region**: `Singapore (Southeast Asia)` (must match your Neon region for low latency)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm ci`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` or `Starter`
5. Expand **Advanced**:
   - **Health Check Path**: `/health`
   - **Auto-Deploy**: `Yes`
6. Click **Create Web Service**.

---

## 4. Post-Deployment Database Initialization

Once the service is created, run migrations and initial admin seeding:

### Method A: Via Render Shell (Recommended)
1. In your Render Web Service dashboard, navigate to the **Shell** tab.
2. Run database migrations:
   ```bash
   npm run migrate
   ```
3. Seed the admin account:
   ```bash
   npm run seed:admin
   ```

### Method B: Via Local Terminal
Alternatively, you can run migrations and seed from your local machine pointing directly to the production Neon `DATABASE_URL`:
```bash
DATABASE_URL="<your_neon_production_url>" npm run migrate
DATABASE_URL="<your_neon_production_url>" npm run seed:admin
```

---

## 5. Smoke-Test Checklist

Verify that the deployed API is functioning properly:

- [ ] **1. Health Check**:
  ```bash
  curl -i https://<your-service>.onrender.com/health
  ```
  Expected: HTTP `200 OK` with `{"status":"OK","timestamp":"..."}`.

- [ ] **2. Customer Registration**:
  ```bash
  curl -i -X POST https://<your-service>.onrender.com/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email":"smoke_test@example.com","password":"Password123!"}'
  ```
  Expected: HTTP `201 Created` with `role: "customer"`.

- [ ] **3. Admin Login**:
  ```bash
  curl -i -X POST https://<your-service>.onrender.com/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}'
  ```
  Expected: HTTP `200 OK` with `access_token`.

- [ ] **4. Product Creation & Stock**:
  ```bash
  curl -i -X POST https://<your-service>.onrender.com/products \
    -H "Authorization: Bearer <admin_token>" \
    -H "Content-Type: application/json" \
    -d '{"sku":"SMOKE-01","name":"Smoke Test Product","price":99.00,"initial_stock":10}'
  ```
  Expected: HTTP `201 Created`.

- [ ] **5. Order Placement**:
  ```bash
  curl -i -X POST https://<your-service>.onrender.com/orders \
    -H "Authorization: Bearer <customer_token>" \
    -H "Content-Type: application/json" \
    -d '{"items":[{"product_id":1,"quantity":2}]}'
  ```
  Expected: HTTP `201 Created`, stock decremented to 8.

- [ ] **6. Reports Check**:
  ```bash
  curl -i -X GET https://<your-service>.onrender.com/reports/low-stock?threshold=10 \
    -H "Authorization: Bearer <admin_token>"
  ```
  Expected: HTTP `200 OK`.
