import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import db, { insertAndGetId } from '../db.js';
import config from '../config.js';
import { validateBody } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { emailTaken, unauthorized } from '../lib/errors.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().refine((val) => {
    const len = Buffer.byteLength(val, 'utf8');
    return len >= 8 && len <= 72;
  }, {
    message: 'Password must be between 8 and 72 bytes',
  }),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
});

// POST /auth/register (public)
router.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const { password } = req.body;

    const existingUser = await db('users').where({ email }).first();
    if (existingUser) {
      throw emailTaken(`Email '${email}' is already registered`);
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Role is ALWAYS 'customer', never read from body
    const id = await insertAndGetId(db, 'users', {
      email,
      password_hash: passwordHash,
      role: 'customer',
    });

    res.status(201).json({
      id,
      email,
      role: 'customer',
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login (public)
router.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const { password } = req.body;

    const user = await db('users').where({ email }).first();
    if (!user) {
      throw unauthorized('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw unauthorized('Invalid email or password');
    }

    const accessToken = jwt.sign(
      { sub: user.id },
      config.jwtSecret,
      { expiresIn: '24h' }
    );

    res.json({
      access_token: accessToken,
      token_type: 'bearer',
    });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me (authenticated)
router.get('/me', authenticate, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    created_at: req.user.created_at,
  });
});

export default router;
