import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import config from '../src/config.js';

describe('Live Demo Concurrency Simulation (/demo)', () => {
  beforeEach(() => {
    config.demoNaiveDelayMs = 30; // Sufficient delay for consistent race condition in test
  });

  afterAll(() => {
    config.demoEnabled = false;
  });

  describe('When DEMO_ENABLED is false (Default)', () => {
    it('returns 404 for both static demo page and demo API endpoint', async () => {
      config.demoEnabled = false;

      const pageRes = await request(app).get('/demo');
      expect(pageRes.status).toBe(404);
      expect(pageRes.body.error.code).toBe('NOT_FOUND');

      const apiRes = await request(app).post('/demo/api/oversell').send({});
      expect(apiRes.status).toBe(404);
      expect(apiRes.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('When DEMO_ENABLED is true', () => {
    beforeEach(() => {
      config.demoEnabled = true;
    });

    it('serves static demo page and rejects out-of-range inputs with 422', async () => {
      const pageRes = await request(app).get('/demo/index.html');
      expect(pageRes.status).toBe(200);
      expect(pageRes.text).toContain('LockStock Concurrency Demo');

      // Invalid stock (> 100)
      const resBadStock = await request(app)
        .post('/demo/api/oversell')
        .set('x-bypass-rate-limit', 'true')
        .send({ stock: 101, buyers: 20 });
      expect(resBadStock.status).toBe(422);
      expect(resBadStock.body.error.code).toBe('VALIDATION_ERROR');

      // Invalid buyers (> 50)
      const resBadBuyers = await request(app)
        .post('/demo/api/oversell')
        .set('x-bypass-rate-limit', 'true')
        .send({ stock: 5, buyers: 51 });
      expect(resBadBuyers.status).toBe(422);
      expect(resBadBuyers.body.error.code).toBe('VALIDATION_ERROR');

      // Invalid mode
      const resBadMode = await request(app)
        .post('/demo/api/oversell')
        .set('x-bypass-rate-limit', 'true')
        .send({ mode: 'super-unsafe' });
      expect(resBadMode.status).toBe(422);
    });

    it('executes safe mode: exactly 5 succeed, 15 rejected, invariant holds, and cleans up throwaway data', async () => {
      const res = await request(app)
        .post('/demo/api/oversell')
        .set('x-bypass-rate-limit', 'true')
        .send({
          stock: 5,
          buyers: 20,
          mode: 'safe',
        });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('safe');
      expect(res.body.stock).toBe(5);
      expect(res.body.buyers).toBe(20);
      expect(res.body.succeeded).toBe(5);
      expect(res.body.rejected).toBe(15);
      expect(res.body.errors).toBe(0);
      expect(res.body.final_stock).toBe(0);
      expect(res.body.invariant_ok).toBe(true);
      expect(res.body.results.length).toBe(20);

      // Verify complete database cleanup: no DEMO- products remain
      const demoProducts = await db('products').where('sku', 'like', 'DEMO-%');
      expect(demoProducts.length).toBe(0);
    });

    it('executes unsafe mode: overselling occurs (succeeded > 5), invariant fails, and cleans up throwaway data', async () => {
      const res = await request(app)
        .post('/demo/api/oversell')
        .set('x-bypass-rate-limit', 'true')
        .send({
          stock: 5,
          buyers: 20,
          mode: 'unsafe',
        });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('unsafe');
      expect(res.body.stock).toBe(5);
      expect(res.body.buyers).toBe(20);

      // Overselling occurred due to uncoordinated read-check-write:
      expect(res.body.succeeded).toBeGreaterThan(5);
      expect(res.body.invariant_ok).toBe(false);

      // Verify complete database cleanup: no DEMO- products remain
      const demoProducts = await db('products').where('sku', 'like', 'DEMO-%');
      expect(demoProducts.length).toBe(0);
    });

    it('returns 409 DEMO_BUSY if two simulations are triggered concurrently', async () => {
      // Fire two simulations concurrently
      const call1 = request(app)
        .post('/demo/api/oversell')
        .set('x-bypass-rate-limit', 'true')
        .send({ stock: 5, buyers: 10, mode: 'safe' });

      const call2 = request(app)
        .post('/demo/api/oversell')
        .set('x-bypass-rate-limit', 'true')
        .send({ stock: 5, buyers: 10, mode: 'safe' });

      const [res1, res2] = await Promise.all([call1, call2]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const busyRes = res1.status === 409 ? res1 : res2;
      expect(busyRes.body.error.code).toBe('DEMO_BUSY');
    });
  });
});
