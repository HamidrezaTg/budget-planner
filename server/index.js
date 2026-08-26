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
import { requireAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 2026;

const app = express();
app.use(express.json());
app.use(cookieParser());

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

app.listen(PORT, () => {
  console.log(`Budget planner running at http://localhost:${PORT}`);
});
