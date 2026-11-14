import { forbidden, unauthorized } from '../lib/errors.js';

export function requireRole(allowedRole) {
  return (req, res, next) => {
    if (!req.user) {
      return next(unauthorized('Authentication required'));
    }

    if (req.user.role !== allowedRole) {
      return next(forbidden(`Role '${allowedRole}' is required to access this resource`));
    }

    next();
  };
}
