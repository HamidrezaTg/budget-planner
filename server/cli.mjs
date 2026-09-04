#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'package.json'), 'utf8'));
const DEFAULTS_FILE = process.env.BP_DEFAULTS_FILE || '/etc/default/gulden';
const DEFAULT_DATA_DIR = '/var/lib/gulden';
const DEFAULT_BACKUP_DIR = '/var/backups/gulden';

function usage() {
  console.log(`Usage: gulden <command> [options]

Read-only:
  status                         Show service, version, URL, and data directory
  doctor                         Check runtime, service, permissions, and databases
  logs [--follow] [--lines N]   Show systemd logs
  config show                    Show non-secret server configuration

Administration:
  config set-port PORT           Change the service port and restart it
  config set-bind ADDRESS        Change listen address and restart it
  users list                     List accounts and roles
  users add NAME [--role ROLE]   Add an account; password is prompted securely
  users reset-password NAME      Replace a password and revoke sessions
  users disable NAME             Disable login without deleting data
  users enable NAME              Re-enable login

Backups:
  backup create [DIRECTORY]      Snapshot complete server data
  backup list [DIRECTORY]        List complete server-data snapshots
  backup restore DIRECTORY       Replace data after validation and confirmation

Global options:
  --json                         Print machine-readable JSON where supported
  --yes                          Confirm a destructive restore operation`);
}

function requireRoot(action) {
  if (typeof process.getuid === 'function' && process.getuid() !== 0)
    throw new Error(`${action} requires root; run it with sudo`);
}

function parseDefaults() {
  const values = {};
  if (!fs.existsSync(DEFAULTS_FILE)) return values;
  for (const line of fs.readFileSync(DEFAULTS_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function serverConfig() {
  const values = { ...parseDefaults() };
  for (const key of ['PORT', 'DATA_DIR', 'BIND_IP']) {
    if (process.env[key] !== undefined) values[key] = process.env[key];
  }
  return {
    ...values,
    PORT: values.PORT && /^\d+$/.test(values.PORT) ? values.PORT : '2026',
    DATA_DIR: values.DATA_DIR?.startsWith('/') ? values.DATA_DIR : DEFAULT_DATA_DIR,
    // Match the server default: loopback unless explicitly configured.
    BIND_IP: values.BIND_IP || '127.0.0.1',
  };
}

function print(value, asJson) {
  if (asJson) return console.log(JSON.stringify(value, null, 2));
  if (typeof value === 'string') return console.log(value);
  for (const [key, item] of Object.entries(value)) console.log(`${key}: ${item}`);
}

function publicConfig() {
  const config = serverConfig();
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !/(KEY|TOKEN|PASSWORD|SECRET)/i.test(key)),
  );
}

function serviceActive() {
  return spawnSync('systemctl', ['is-active', '--quiet', 'gulden']).status === 0;
}

function service(action) {
  const result = spawnSync('systemctl', ['--quiet', action, 'gulden']);
  if (result.error || result.status !== 0) throw new Error(`systemctl ${action} gulden failed`);
}

function status(asJson) {
  const cfg = serverConfig();
  print(
    {
      service: serviceActive() ? 'running' : 'stopped',
      version: PACKAGE.version,
      bind: cfg.BIND_IP,
      port: Number(cfg.PORT),
      data_dir: cfg.DATA_DIR,
      url: `http://${cfg.BIND_IP === '0.0.0.0' ? '<this-machine>' : cfg.BIND_IP}:${cfg.PORT}`,
    },
    asJson,
  );
}

function databaseFiles(dataDir) {
  const files = [];
  const master = path.join(dataDir, 'master.db');
  if (fs.existsSync(master)) files.push(master);
  const users = path.join(dataDir, 'users');
  if (fs.existsSync(users)) {
    for (const entry of fs.readdirSync(users, { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith('.db')) files.push(path.join(users, entry.name));
  }
  return files;
}

function validateServerData(dataDir) {
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory())
    throw new Error(`data directory does not exist: ${dataDir}`);
  const master = path.join(dataDir, 'master.db');
  const users = path.join(dataDir, 'users');
  if (!fs.existsSync(master)) throw new Error(`missing ${master}`);
  if (!fs.existsSync(users) || !fs.statSync(users).isDirectory())
    throw new Error(`missing ${users}/`);
  if (fs.lstatSync(master).isSymbolicLink() || fs.lstatSync(users).isSymbolicLink())
    throw new Error('master.db and users/ cannot be symlinks');
  const files = databaseFiles(dataDir);
  for (const file of files) {
    if (fs.lstatSync(file).isSymbolicLink())
      throw new Error(`database cannot be a symlink: ${file}`);
    const database = new DatabaseSync(file, { readOnly: true });
    const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    database.close();
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${file}`);
    if (foreignKeys.length) throw new Error(`foreign-key check failed: ${file}`);
  }
  return files.length;
}

function doctor(asJson) {
  const cfg = serverConfig();
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'node', ok: nodeMajor >= 22, detail: process.version });
  checks.push({ name: 'data directory', ok: fs.existsSync(cfg.DATA_DIR), detail: cfg.DATA_DIR });
  try {
    checks.push({
      name: 'sqlite databases',
      ok: true,
      detail: `${validateServerData(cfg.DATA_DIR)} checked`,
    });
  } catch (error) {
    checks.push({ name: 'sqlite databases', ok: false, detail: error.message });
  }
  const running = serviceActive();
  checks.push({ name: 'service', ok: running, detail: running ? 'running' : 'stopped' });
  const result = { ok: checks.every((check) => check.ok), checks };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    for (const check of checks)
      console.log(`${check.ok ? 'OK ' : 'BAD'} ${check.name}: ${check.detail}`);
    console.log(result.ok ? 'Doctor: healthy' : 'Doctor: issues found');
  }
  if (!result.ok) process.exitCode = 1;
}

function positivePort(value, label) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535)
    throw new Error(`${label} must be an integer from 1 to 65535`);
  return String(Number(value));
}

function writeDefault(key, value) {
  requireRoot('changing configuration');
  const current = fs.existsSync(DEFAULTS_FILE) ? fs.readFileSync(DEFAULTS_FILE, 'utf8') : '';
  const lines = current.split(/\r?\n/).filter((line) => !line.startsWith(`${key}=`));
  while (lines.length && lines.at(-1) === '') lines.pop();
  lines.push(`${key}=${value}`, '');
  fs.mkdirSync(path.dirname(DEFAULTS_FILE), { recursive: true });
  fs.writeFileSync(DEFAULTS_FILE, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(DEFAULTS_FILE, 0o600);
}

function configCommand(args, asJson) {
  const action = args[0] || 'show';
  if (action === 'show') return print(publicConfig(), asJson);
  if (action === 'set-port') {
    const port = positivePort(args[1], 'port');
    writeDefault('PORT', port);
    if (serviceActive()) service('restart');
    return console.log(`Port set to ${port}`);
  }
  if (action === 'set-bind') {
    const raw = String(args[1] || '')
      .trim()
      .toLowerCase();
    const bind = raw === 'all' ? '0.0.0.0' : raw === 'localhost' ? '127.0.0.1' : args[1];
    if (!bind || net.isIP(bind) === 0)
      throw new Error('bind address must be all, localhost, or an IP address');
    writeDefault('BIND_IP', bind);
    if (serviceActive()) service('restart');
    return console.log(`Listen address set to ${bind}`);
  }
  throw new Error(`unknown config command: ${action}`);
}

async function dbModules() {
  process.env.DATA_DIR = serverConfig().DATA_DIR;
  return { db: await import('./db.js'), auth: await import('./auth.js') };
}

async function promptSecret(label) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode)
    throw new Error('interactive password input requires a terminal');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('cancelled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stderr.write('\n');
          resolve(value);
        } else if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
    };
    process.stderr.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
  });
}

async function usersCommand(args, asJson) {
  const action = args[0] || 'list';
  requireRoot(`users ${action}`);
  const { db, auth } = await dbModules();
  if (action === 'list') {
    const users = db.listUsers();
    if (asJson) console.log(JSON.stringify(users, null, 2));
    else
      for (const user of users)
        console.log(
          `${user.username}\t${user.role}\t${user.disabled ? 'disabled' : 'enabled'}\t${user.created_at}`,
        );
    return;
  }
  const username = args[1];
  if (!username) throw new Error(`users ${action} requires a username`);
  if (action === 'add') {
    const roleIndex = args.indexOf('--role');
    const role = roleIndex >= 0 ? args[roleIndex + 1] : db.hasAnyUser() ? 'user' : 'admin';
    if (!['user', 'admin'].includes(role)) throw new Error('--role must be user or admin');
    const password = await promptSecret('Password: ');
    const confirmation = await promptSecret('Confirm password: ');
    if (password !== confirmation) throw new Error('passwords do not match');
    await auth.createUser(username, password, role);
    console.log(`User "${String(username).toLowerCase()}" created.`);
    return;
  }
  if (action === 'reset-password') {
    const password = await promptSecret('New password: ');
    const confirmation = await promptSecret('Confirm password: ');
    if (password !== confirmation) throw new Error('passwords do not match');
    await auth.adminResetPassword(username, password);
    console.log(
      `Password reset for "${String(username).toLowerCase()}"; existing sessions revoked.`,
    );
    return;
  }
  if (action === 'disable' || action === 'enable') {
    await auth.setUserDisabled(username, action === 'disable');
    console.log(`User "${String(username).toLowerCase()}" ${action}d.`);
    return;
  }
  throw new Error(`unknown users command: ${action}`);
}

function logsCommand(args) {
  const follow = args.includes('--follow');
  const index = args.indexOf('--lines');
  const lines = index >= 0 ? positivePort(args[index + 1], 'lines') : '100';
  const command = follow
    ? ['-fu', 'gulden', '-n', lines, '--no-pager']
    : ['-u', 'gulden', '-n', lines, '--no-pager'];
  const result = spawnSync('journalctl', command, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('journalctl failed');
}

function assertDifferent(source, target) {
  const sourceReal = fs.realpathSync(source);
  const targetReal = fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
  if (sourceReal === targetReal || targetReal.startsWith(`${sourceReal}${path.sep}`))
    throw new Error('backup source and target must be different directories');
}

function ownBudgetFiles(target) {
  if (spawnSync('id', ['-u', 'budget']).status === 0)
    execFileSync('chown', ['-R', 'budget:budget', target], { stdio: 'ignore' });
}

function withServiceStopped(callback) {
  const wasActive = serviceActive();
  if (wasActive) service('stop');
  try {
    return callback();
  } finally {
    if (wasActive) service('start');
  }
}

function backupCreate(args) {
  requireRoot('backup create');
  const source = serverConfig().DATA_DIR;
  validateServerData(source);
  const target = path.resolve(
    args[0] ||
      path.join(
        DEFAULT_BACKUP_DIR,
        `server-data-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      ),
  );
  assertDifferent(source, fs.existsSync(target) ? target : path.dirname(target));
  if (fs.existsSync(target)) throw new Error(`backup target already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    withServiceStopped(() => {
      fs.cpSync(source, target, { recursive: true, errorOnExist: true });
      ownBudgetFiles(target);
      validateServerData(target);
    });
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  console.log(`Backup created: ${target}`);
}

function backupList(args, asJson) {
  const directory = path.resolve(args[0] || DEFAULT_BACKUP_DIR);
  if (!fs.existsSync(directory)) return asJson ? console.log('[]') : undefined;
  const backups = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, 'master.db')),
    )
    .map((entry) => {
      const target = path.join(directory, entry.name);
      return { name: entry.name, path: target, modified: fs.statSync(target).mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
  if (asJson) console.log(JSON.stringify(backups, null, 2));
  else for (const backup of backups) console.log(`${backup.modified}\t${backup.path}`);
}

async function backupRestore(args) {
  requireRoot('backup restore');
  if (!args[0]) throw new Error('backup restore requires a server-data directory');
  const source = path.resolve(args[0]);
  const target = serverConfig().DATA_DIR;
  const targetExisted = fs.existsSync(target);
  validateServerData(source);
  assertDifferent(source, target);
  if (!args.includes('--yes')) {
    const answer = await new Promise((resolve) => {
      const input = readline.createInterface({ input: process.stdin, output: process.stderr });
      input.question(`Type RESTORE to replace ${target} with ${source}: `, (value) => {
        input.close();
        resolve(value);
      });
    });
    if (answer !== 'RESTORE') throw new Error('restore cancelled');
  }
  const temporary = `${target}.restore-${process.pid}-${Date.now()}`;
  const previous = `${target}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  withServiceStopped(() => {
    try {
      fs.cpSync(source, temporary, { recursive: true, errorOnExist: true });
      ownBudgetFiles(temporary);
      validateServerData(temporary);
      if (fs.existsSync(target)) fs.renameSync(target, previous);
      fs.renameSync(temporary, target);
      if (targetExisted) console.log(`Existing data retained at: ${previous}`);
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      if (!fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(previous, target);
      throw error;
    }
  });
  console.log(`Database restored from: ${source}`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const asJson = rawArgs.includes('--json');
  const args = rawArgs.filter((arg) => arg !== '--json');
  const command = args.shift();
  if (!command || command === '--help' || command === '-h') return usage();
  try {
    if (command === 'status') return status(asJson);
    if (command === 'doctor') return doctor(asJson);
    if (command === 'logs') return logsCommand(args);
    if (command === 'config') return configCommand(args, asJson);
    if (command === 'users') return usersCommand(args, asJson);
    if (command === 'backup') {
      const action = args.shift() || 'list';
      if (action === 'create') return backupCreate(args);
      if (action === 'list') return backupList(args, asJson);
      if (action === 'restore') return backupRestore(args);
      throw new Error(`unknown backup command: ${action}`);
    }
    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
