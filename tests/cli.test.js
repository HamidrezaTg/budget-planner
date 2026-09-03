import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

test('administrative CLI prints help without loading application data', () => {
  const result = spawnSync(process.execPath, ['server/cli.mjs', '--help'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /budget-planner <command>/);
  assert.match(result.stdout, /backup restore DIRECTORY/);
});

test('administrative CLI reports status as JSON', () => {
  const result = spawnSync(process.execPath, ['server/cli.mjs', 'status', '--json'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: '/tmp/budget-planner-cli-test-data' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.version, '3.20.5');
  assert.equal(status.data_dir, '/tmp/budget-planner-cli-test-data');
});

test('administrative CLI does not print secrets in configuration output', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bp-cli-config-'));
  const defaults = path.join(directory, 'defaults');
  try {
    writeFileSync(defaults, 'PORT=2345\nAI_API_KEY=do-not-print\nSETUP_TOKEN=also-secret\n');
    const result = spawnSync(process.execPath, ['server/cli.mjs', 'config', 'show', '--json'], {
      cwd: root,
      env: { ...process.env, BP_DEFAULTS_FILE: defaults },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).PORT, '2345');
    assert.doesNotMatch(result.stdout, /do-not-print|also-secret/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
