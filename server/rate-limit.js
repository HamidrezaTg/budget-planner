// Lightweight in-memory sliding-window rate limiter. No external dependency —
// the app is a small self-hosted server, so a per-process Map is sufficient.
// Restarting the server resets counters, which is acceptable here.

const buckets = new Map();
const loginFailures = new Map();
const LOGIN_COOLDOWN_THRESHOLD = 3;
const LOGIN_COOLDOWN_BASE_MS = 1_000;
const LOGIN_COOLDOWN_MAX_MS = 60_000;
const LOGIN_FAILURE_RESET_MS = 15 * 60_000;

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

export function loginCooldownMs(failures) {
  if (failures < LOGIN_COOLDOWN_THRESHOLD) return 0;
  return Math.min(
    LOGIN_COOLDOWN_MAX_MS,
    LOGIN_COOLDOWN_BASE_MS * 2 ** (failures - LOGIN_COOLDOWN_THRESHOLD),
  );
}

export function loginCooldownRemaining(key) {
  const entry = loginFailures.get(key);
  if (!entry) return 0;
  const t = now();
  if (t - entry.lastFailureAt > LOGIN_FAILURE_RESET_MS) {
    loginFailures.delete(key);
    return 0;
  }
  return Math.max(0, entry.blockedUntil - t);
}

export function recordLoginFailure(key) {
  const previous = loginFailures.get(key);
  const failures = previous ? previous.failures + 1 : 1;
  const cooldown = loginCooldownMs(failures);
  loginFailures.set(key, {
    failures,
    lastFailureAt: now(),
    blockedUntil: now() + cooldown,
  });
  return cooldown;
}

export function clearLoginFailures(key) {
  loginFailures.delete(key);
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
  for (const [k, entry] of loginFailures) {
    if (t - entry.lastFailureAt > LOGIN_FAILURE_RESET_MS) loginFailures.delete(k);
  }
}
setInterval(trimBuckets, 60 * 1000).unref();
