import { AppError } from '../lib/errors.js';
import config from '../config.js';

export function errorHandler(err, req, res, next) {
  // If already sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  // Handle known AppError
  if (err instanceof AppError) {
    const response = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details !== undefined ? err.details : null,
      },
    };
    return res.status(err.status).json(response);
  }

  // Handle database unique constraint errors if not caught in service
  if (err.code === '23505') {
    if (err.detail?.includes('email') || err.constraint?.includes('users_email')) {
      return res.status(409).json({
        error: {
          code: 'EMAIL_TAKEN',
          message: 'Email already registered',
          details: null,
        },
      });
    }
    if (err.detail?.includes('sku') || err.constraint?.includes('products_sku')) {
      return res.status(409).json({
        error: {
          code: 'SKU_TAKEN',
          message: 'SKU already exists',
          details: null,
        },
      });
    }
  }

  // Handle JSON parse errors from body-parser
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON payload',
        details: null,
      },
    });
  }

  // Fallback for unexpected errors
  const status = err.status || 500;
  const isProduction = config.isProd;

  if (status >= 500) {
    console.error('Unhandled server error:', err);
  }

  const errorResponse = {
    error: {
      code: err.code && typeof err.code === 'string' && !/^\d+$/.test(err.code) ? err.code : 'INTERNAL_ERROR',
      message: status === 500 && isProduction ? 'Internal server error' : (err.message || 'Internal server error'),
      details: !isProduction && err.stack ? { stack: err.stack } : null,
    },
  };

  return res.status(status).json(errorResponse);
}
