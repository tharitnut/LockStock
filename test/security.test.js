import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import { assertValidProductionConfig } from '../src/config.js';
import { createTestUser, createTestProduct } from './helpers.js';

describe('Security & Rate Limiting', () => {
  describe('Production JWT_SECRET Guard', () => {
    it('throws error when NODE_ENV=production and JWT_SECRET is missing', () => {
      expect(() => {
        assertValidProductionConfig({ NODE_ENV: 'production', JWT_SECRET: '' });
      }).toThrow(/JWT_SECRET must be securely set in production/);
    });

    it('throws error when NODE_ENV=production and JWT_SECRET is dev default', () => {
      expect(() => {
        assertValidProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'your_super_secret_jwt_key_at_least_32_chars',
        });
      }).toThrow(/JWT_SECRET must be securely set in production/);
    });

    it('does not throw in production with a strong custom secret', () => {
      expect(() => {
        assertValidProductionConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'strong_prod_secret_that_is_unique_and_long_1234567890',
        });
      }).not.toThrow();
    });

    it('does not throw in development even if secret is dev default', () => {
      expect(() => {
        assertValidProductionConfig({
          NODE_ENV: 'development',
          JWT_SECRET: 'your_super_secret_jwt_key_at_least_32_chars',
        });
      }).not.toThrow();
    });
  });

  describe('Standard 404 Error Format', () => {
    it('returns 404 with standard error envelope for non-existent routes', async () => {
      const res = await request(app).get('/non-existent-api-path');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: expect.stringContaining('/non-existent-api-path'),
          details: null,
        },
      });
    });
  });

  describe('Rate Limiting', () => {
    it('enforces 10 req/min limit on /auth/login returning 429 RATE_LIMITED', async () => {
      // Create user to authenticate against
      await createTestUser(db, { email: 'ratelimit_user@test.com', password: 'password123' });

      // Send 10 login requests
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/auth/login')
          .send({ email: 'ratelimit_user@test.com', password: 'password123' });
        expect(res.status).toBe(200);
      }

      // 11th request must receive 429 RATE_LIMITED
      const limitedRes = await request(app)
        .post('/auth/login')
        .send({ email: 'ratelimit_user@test.com', password: 'password123' });

      expect(limitedRes.status).toBe(429);
      expect(limitedRes.body).toEqual({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please try again later',
          details: null,
        },
      });
    });

    it('enforces 30 req/min limit on POST /orders per user returning 429 RATE_LIMITED', async () => {
      const user = await createTestUser(db, { email: 'order_ratelimit@test.com' });
      const product = await createTestProduct(db, { sku: 'RL-PROD', stock_quantity: 100 });

      // Send 30 order requests
      for (let i = 0; i < 30; i++) {
        const res = await request(app)
          .post('/orders')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ items: [{ product_id: product.id, quantity: 1 }] });
        expect(res.status).toBe(201);
      }

      // 31st request must receive 429
      const limitedRes = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ items: [{ product_id: product.id, quantity: 1 }] });

      expect(limitedRes.status).toBe(429);
      expect(limitedRes.body.error.code).toBe('RATE_LIMITED');
    });
  });
});
