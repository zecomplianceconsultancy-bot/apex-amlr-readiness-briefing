/**
 * Fixed-window in-memory limiter for login attempts. Adequate for a single instance;
 * replace with a Redis/Postgres-backed limiter when running more than one app instance.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function hitRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  bucket.count++;
  if (bucket.count > limit) return { allowed: false, retryAfterMs: bucket.resetAt - now };
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
