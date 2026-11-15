/**
 * Utility to retry database transactions ONLY on transient concurrency failures
 * (deadlocks, serialization failures). Business errors (409, 400, 422, etc.) are never retried.
 */

export function isRetryableError(err) {
  if (!err) return false;

  // PostgreSQL: 40P01 (deadlock_detected), 40001 (serialization_failure)
  if (err.code === '40P01' || err.code === '40001') {
    return true;
  }

  // MySQL: 1213 (ER_LOCK_DEADLOCK)
  if (err.errno === 1213 || err.code === 'ER_LOCK_DEADLOCK') {
    return true;
  }

  return false;
}

export async function withRetry(
  fn,
  {
    maxAttempts = 3,
    initialDelayMs = 25,
    maxDelayMs = 200,
  } = {}
) {
  let attempt = 0;

  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxAttempts && isRetryableError(err)) {
        // Small exponential backoff with random jitter to avoid lock convoying
        const backoff = initialDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 15;
        const delay = Math.min(backoff + jitter, maxDelayMs);

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw err;
    }
  }
}
