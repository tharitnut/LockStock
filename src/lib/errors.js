export class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badReference = (message = 'Referenced resource does not exist or is inactive', details) =>
  new AppError('BAD_REFERENCE', message, 400, details);

export const unauthorized = (message = 'Unauthorized') =>
  new AppError('UNAUTHORIZED', message, 401);

export const forbidden = (message = 'Forbidden') =>
  new AppError('FORBIDDEN', message, 403);

export const notFound = (message = 'Not found') =>
  new AppError('NOT_FOUND', message, 404);

export const emailTaken = (message = 'Email already registered') =>
  new AppError('EMAIL_TAKEN', message, 409);

export const skuTaken = (message = 'SKU already exists') =>
  new AppError('SKU_TAKEN', message, 409);

export const insufficientStock = (details, message = 'Insufficient stock for one or more items') =>
  new AppError('INSUFFICIENT_STOCK', message, 409, details);

export const orderNotCancellable = (message = 'Order is not in a cancellable status') =>
  new AppError('ORDER_NOT_CANCELLABLE', message, 409);

export const validationError = (details, message = 'Validation error') =>
  new AppError('VALIDATION_ERROR', message, 422, details);

export const rateLimited = (message = 'Too many requests, please try again later') =>
  new AppError('RATE_LIMITED', message, 429);
