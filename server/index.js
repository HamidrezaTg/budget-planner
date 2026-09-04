import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import personRoutes from './routes/persons.js';
import categoryRoutes from './routes/categories.js';
import transactionRoutes from './routes/transactions.js';
import importRoutes from './routes/import.js';
import dashboardRoutes from './routes/dashboard.js';
import budgetRoutes from './routes/budgets.js';
import commitmentRoutes from './routes/commitments.js';
import fundRoutes from './routes/funds.js';
import incomeRoutes from './routes/income.js';
import balanceRoutes from './routes/balances.js';
import projectionRoutes from './routes/projection.js';
import recurrenceRoutes from './routes/recurrences.js';
import attachmentRoutes from './routes/attachments.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import shareRoutes from './routes/shares.js';
import sharedRoutes from './routes/shared.js';
import aiRoutes from './routes/ai.js';
import { requireAuth, sweepExpiredSessions } from './auth.js';
import { gate } from './request-gate.js';
import { runNotificationSweep } from './services/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 2026;
// Loopback by default: the planner holds financial data. Exposing it to the
// LAN (or beyond) is an explicit opt-in via BIND_IP (0.0.0.0 or an interface
// IP). Remote access is expected to run through Tailscale Serve or an HTTPS
// reverse proxy — set TRUST_PROXY=1 there so session cookies get the Secure
// flag automatically (SECURE_COOKIE=1 forces it as well).
const BIND_IP = process.env.BIND_IP || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Cookie authentication makes browser-originated state changes vulnerable to
// cross-site forms unless the request origin is checked. Native HTTP clients
// commonly omit these headers, so absent Origin/Referer remains allowed; any
// header that is present must identify this server.
// Short per-request id: echoed to the client and attached to error logs, so a
// user can report an id and the matching journalctl line can be found.
app.use((req, res, next) => {
  req.id = crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.get('sec-fetch-site')?.toLowerCase() === 'cross-site')
    return res.status(403).json({ error: 'Cross-origin request rejected' });

  const expected = `${req.protocol}://${req.get('host')}`;
  for (const header of ['origin', 'referer']) {
    const value = req.get(header);
    if (!value) continue;
    try {
      if (new URL(value).origin !== new URL(expected).origin)
        return res.status(403).json({ error: 'Cross-origin request rejected' });
    } catch {
      return res.status(403).json({ error: 'Cross-origin request rejected' });
    }
  }
  next();
});

// Security headers. CSP is scoped to the built client's needs: React inline
// styles are allowed, but scripts must come from the same origin.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'sha256-rBN/v916LrsvlEADLbAag4oxTka3H2ltz3J6Mjfhif8='; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data:; font-src 'self' data: https://fonts.gstatic.com; " +
      "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  );
  next();
});

const responseCounts = new Map();
let requestCount = 0;
app.use((req, res, next) => {
  if (req.path !== '/metrics') {
    requestCount++;
    res.on('finish', () => {
      responseCounts.set(res.statusCode, (responseCounts.get(res.statusCode) ?? 0) + 1);
    });
  }
  next();
});

app.get('/metrics', (_req, res) => {
  if (process.env.METRICS_ENABLED !== '1') return res.status(404).end();
  const lines = [
    '# HELP budget_planner_requests_total Total HTTP requests handled by Gulden.',
    '# TYPE budget_planner_requests_total counter',
    `budget_planner_requests_total ${requestCount}`,
  ];
  for (const [status, count] of responseCounts) {
    lines.push(`budget_planner_responses_total{status="${status}"} ${count}`);
  }
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(`${lines.join('\n')}\n`);
});

// Unauthenticated health probe for systemd/uptime monitors. No data, no auth
// side effects — just liveness.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Cross-platform server discovery: the Android client (and other future
// clients) probe this URL first to validate that they reached a real
// planner server. Replies with the API base path, the build version, and
// the documented feature set so the client can adapt.
const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
).version;
app.get('/.well-known/budget-planner', (_req, res) => {
  // The Android shell is a separate origin and needs to inspect this small,
  // non-sensitive discovery document before navigating to the planner.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    api: '/api',
    name: 'Gulden',
    version: PKG_VERSION,
    features: ['accounts', 'transfers', 'funds', 'recurrences', 'multi-currency', 'import', 'ai'],
  });
});

// Count/queue API requests so administrative database swaps (backup restore)
// can drain in-flight work before touching the file on disk.
app.use('/api', gate);

app.use('/api/auth', authRoutes);
app.use('/api/accounts', requireAuth, accountRoutes);
app.use('/api/persons', requireAuth, personRoutes);
app.use('/api/categories', requireAuth, categoryRoutes);
app.use('/api/transactions', requireAuth, transactionRoutes);
app.use('/api/import', requireAuth, importRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/budgets', requireAuth, budgetRoutes);
app.use('/api/commitments', requireAuth, commitmentRoutes);
app.use('/api/funds', requireAuth, fundRoutes);
app.use('/api/income', requireAuth, incomeRoutes);
app.use('/api/balances', requireAuth, balanceRoutes);
app.use('/api/projection', requireAuth, projectionRoutes);
app.use('/api/recurrences', requireAuth, recurrenceRoutes);
app.use('/api/attachments', requireAuth, attachmentRoutes);
app.use('/api/reports', requireAuth, reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/shares', requireAuth, shareRoutes);
app.use('/api/share', sharedRoutes);
app.use('/api/ai', aiRoutes);

// serve built client.
// index.html must NEVER be cached (a rebuild changes asset hashes; stale HTML
// pointing at old chunks is what made the app white-screen between tabs).
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(
    express.static(dist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (/[/\\]assets[/\\]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// Unknown API routes get a clean JSON 404 (never the SPA fallback).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler: no stack traces or internal paths leak to clients.
app.use((err, _req, res, next) => {
  const status = err.status || err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(`[error] [req:${_req.id ?? '-'}]`, err);
  if (res.headersSent) return next(err);
  const message =
    process.env.NODE_ENV === 'production'
      ? status >= 500
        ? 'Internal server error'
        : err.message
      : err.message;
  res.status(status).json({ error: message });
});

// Remove expired sessions once at startup (and periodically after that).
sweepExpiredSessions();
setInterval(sweepExpiredSessions, 3600 * 1000).unref();
runNotificationSweep().catch((error) =>
  console.error(`[notifications] sweep failed: ${error.message}`),
);
setInterval(runNotificationSweep, 24 * 3600 * 1000).unref();

app.listen(PORT, BIND_IP, () => {
  const shown = BIND_IP === '0.0.0.0' ? '<this-machine>' : BIND_IP;
  console.log(
    `Gulden running at http://${shown}:${PORT}` +
      (BIND_IP === '127.0.0.1' ? ' (loopback only — set BIND_IP to expose it, see README)' : ''),
  );
});
