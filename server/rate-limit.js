// Lightweight in-memory sliding-window rate limiter. No external dependency —
// the app is a small self-hosted server, so a per-process Map is sufficient.
// Restarting the server resets counters, which is acceptable here.

const buckets = new Map();

function now() {
  return Date.now();
}

// consume(key, windowMs, max) -> true if the request is OVER the limit.
export function consume(key, windowMs, max) {
  const t = now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= t) {
    buckets.set(key, { count: 1, resetAt: t + windowMs });
    return false;
  }
  b.count++;
  if (b.count > max) return true;
  return false;
}

export function clear(key) {
  buckets.delete(key);
}

// Express middleware factory.
export function rateLimit({ windowMs = 60 * 1000, max = 20, key = (req) => req.ip }) {
  return (req, res, next) => {
    if (consume(key(req), windowMs, max)) {
      return res.status(429).json({ error: 'Too many attempts — try again in a minute' });
    }
    next();
  };
}

// Prevent unbounded growth from long-lived processes / many distinct keys.
export function trimBuckets() {
  const t = now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= t) buckets.delete(k);
  }
}
setInterval(trimBuckets, 60 * 1000).unref();
