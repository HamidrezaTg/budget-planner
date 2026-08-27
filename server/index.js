import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
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
import aiRoutes from './routes/ai.js';
import { requireAuth, sweepExpiredSessions } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 2026;
// Optional interface binding: e.g. 127.0.0.1 (localhost only) or a Tailscale IP.
// Unset = all interfaces (LAN).
const BIND_IP = process.env.BIND_IP || '';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

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
      "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
  );
  next();
});

// Unauthenticated health probe for systemd/uptime monitors. No data, no auth
// side effects — just liveness.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use('/api/auth', authRoutes);
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
    })
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
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, next) => {
  const status = err.status || err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error('[error]', err);
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

app.listen(PORT, BIND_IP || undefined, () => {
  const shown = BIND_IP || '0.0.0.0';
  console.log(`Budget planner running at http://${shown === '0.0.0.0' ? '<this-machine>' : shown}:${PORT}`);
});
