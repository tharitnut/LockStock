import { validationError } from '../lib/errors.js';

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      return next(validationError(details, 'Validation error'));
    }
    req.validatedBody = result.data;
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      return next(validationError(details, 'Validation error in query parameters'));
    }
    req.validatedQuery = result.data;
    try {
      req.query = result.data;
    } catch {
      Object.assign(req.query, result.data);
    }
    next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const details = result.error.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      return next(validationError(details, 'Validation error in path parameters'));
    }
    req.validatedParams = result.data;
    try {
      req.params = result.data;
    } catch {
      Object.assign(req.params, result.data);
    }
    next();
  };
}
