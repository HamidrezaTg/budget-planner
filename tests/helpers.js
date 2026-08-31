// Shared helpers for the test suite.
// node --test runs each test file in its own process, so setting DATA_DIR
// before dynamically importing the server modules is safe and isolated.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function freshDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'bp-test-'));
}

export function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// Load the server's db module against an isolated temp data directory.
// Returns the module namespace.
export async function loadDb(dataDir) {
  process.env.DATA_DIR = dataDir;
  return await import('../server/db.js');
}

export async function loadAuth(dataDir) {
  process.env.DATA_DIR = dataDir;
  return await import('../server/auth.js');
}

// Start a real server on an ephemeral-ish port with an isolated data dir.
// Returns { url, stop }.
export async function startServer(dataDir, port = 0) {
  const usedPort = port || 21300 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(import.meta.dirname, '..'),
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(usedPort), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d;
  });

  const url = `http://127.0.0.1:${usedPort}`;
  // wait until /api/auth/status responds
  const deadline = Date.now() + 15000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${stderr}`);
    try {
      const r = await fetch(`${url}/api/auth/status`);
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`server did not start in time: ${stderr}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  return {
    url,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    },
    logs: () => stderr,
  };
}
