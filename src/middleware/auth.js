import jwt from 'jsonwebtoken';
import config from '../config.js';
import db from '../db.js';
import { unauthorized } from '../lib/errors.js';

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Missing or malformed Authorization header'));
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return next(unauthorized('Token is empty'));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return next(unauthorized('Invalid or expired token'));
  }

  const userId = decoded.sub;
  if (!userId) {
    return next(unauthorized('Token payload missing subject identifier'));
  }

  try {
    const user = await db('users').where({ id: userId }).first();
    if (!user) {
      return next(unauthorized('User not found or deleted'));
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      created_at: new Date(user.created_at).toISOString(),
    };
    next();
  } catch (err) {
    next(err);
  }
}
