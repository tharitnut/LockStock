import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError } from '../src/lib/withRetry.js';
import { insufficientStock, badReference } from '../src/lib/errors.js';

describe('lib/withRetry.js', () => {
  it('correctly identifies retryable deadlock and serialization error codes', () => {
    expect(isRetryableError({ code: '40P01' })).toBe(true);
    expect(isRetryableError({ code: '40001' })).toBe(true);
    expect(isRetryableError({ errno: 1213 })).toBe(true);
    expect(isRetryableError({ code: 'ER_LOCK_DEADLOCK' })).toBe(true);

    // Business errors & other DB errors must NOT be retryable
    expect(isRetryableError(insufficientStock())).toBe(false);
    expect(isRetryableError(badReference())).toBe(false);
    expect(isRetryableError({ code: '23505' })).toBe(false); // unique violation
    expect(isRetryableError(new Error('general error'))).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it('executes successfully on first attempt when no error occurs', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on deadlock (40P01) and succeeds on subsequent attempt', async () => {
    const deadlockError = new Error('deadlock detected');
    deadlockError.code = '40P01';

    const fn = vi.fn()
      .mockRejectedValueOnce(deadlockError)
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, { initialDelayMs: 5 });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on MySQL 1213 and succeeds on 3rd attempt', async () => {
    const mysqlDeadlock = new Error('Lock deadlock');
    mysqlDeadlock.errno = 1213;

    const fn = vi.fn()
      .mockRejectedValueOnce(mysqlDeadlock)
      .mockRejectedValueOnce(mysqlDeadlock)
      .mockResolvedValueOnce('third time lucky');

    const result = await withRetry(fn, { initialDelayMs: 5 });

    expect(result).toBe('third time lucky');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws error after maxAttempts (3) if retryable error persists', async () => {
    const deadlockError = new Error('persistent deadlock');
    deadlockError.code = '40P01';

    const fn = vi.fn().mockRejectedValue(deadlockError);

    await expect(withRetry(fn, { maxAttempts: 3, initialDelayMs: 5 }))
      .rejects.toThrow('persistent deadlock');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries business errors (such as 409 INSUFFICIENT_STOCK)', async () => {
    const businessError = insufficientStock([{ product_id: 1, requested: 5, available: 0 }]);
    const fn = vi.fn().mockRejectedValue(businessError);

    await expect(withRetry(fn, { maxAttempts: 3, initialDelayMs: 5 }))
      .rejects.toThrow(businessError);

    expect(fn).toHaveBeenCalledTimes(1); // Fails immediately on 1st attempt!
  });
});
