import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import db from '../src/db.js';
import { createTestUser } from './helpers.js';

describe('Auth Endpoints & RBAC', () => {
  describe('POST /auth/register', () => {
    it('registers a customer successfully', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'Customer@example.com',
          password: 'securepassword123',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe('customer@example.com'); // converted to lowercase
      expect(res.body.role).toBe('customer');
    });

    it('always creates role customer even if role admin is supplied in body', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'hacker@example.com',
          password: 'securepassword123',
          role: 'admin',
        });

      expect(res.status).toBe(201);
      expect(res.body.role).toBe('customer');

      const userInDb = await db('users').where({ email: 'hacker@example.com' }).first();
      expect(userInDb.role).toBe('customer');
    });

    it('rejects duplicate email with 409 EMAIL_TAKEN', async () => {
      await request(app)
        .post('/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'password123',
        });

      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'anotherpassword',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('rejects passwords shorter than 8 bytes with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'short@example.com',
          password: 'short',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    it('returns access_token for valid credentials', async () => {
      await createTestUser(db, {
        email: 'login_test@example.com',
        password: 'password123',
      });

      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'login_test@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
      expect(res.body.token_type).toBe('bearer');
    });

    it('returns 401 UNAUTHORIZED for wrong password', async () => {
      await createTestUser(db, {
        email: 'wrong_pw@example.com',
        password: 'correctpassword',
      });

      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'wrong_pw@example.com',
          password: 'wrongpassword',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED for non-existent email', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'nobody@example.com',
          password: 'anypassword',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /auth/me', () => {
    it('returns current user profile with valid token', async () => {
      const user = await createTestUser(db, {
        email: 'me@example.com',
        role: 'customer',
      });

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.email).toBe(user.email);
      expect(res.body.role).toBe('customer');
      expect(res.body.created_at).toMatch(/Z$/);
    });

    it('returns 401 when token is missing or invalid', async () => {
      const resNoToken = await request(app).get('/auth/me');
      expect(resNoToken.status).toBe(401);
      expect(resNoToken.body.error.code).toBe('UNAUTHORIZED');

      const resBadToken = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token');
      expect(resBadToken.status).toBe(401);
      expect(resBadToken.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
