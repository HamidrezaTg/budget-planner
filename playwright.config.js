import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const dataDir = process.env.PW_DATA_DIR || mkdtempSync(path.join(tmpdir(), 'budget-planner-e2e-'));

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node server/index.js',
    url: 'http://127.0.0.1:4173/healthz',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATA_DIR: dataDir,
      PORT: '4173',
      NODE_ENV: 'test',
    },
  },
});
