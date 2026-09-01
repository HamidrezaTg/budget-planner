import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
const dbm = await loadDb(dir);
const { currentMonth } = await import('../server/services/model.js');
const { publishNtfy, sendDailySummary, validateNtfyConfig } =
  await import('../server/services/notifications.js');
after(() => cleanup(dir));

test('ntfy config validation rejects unsafe endpoints and topics', () => {
  assert.deepEqual(validateNtfyConfig({ server: 'https://ntfy.sh/', topic: 'budget-alerts' }), {
    server: 'https://ntfy.sh',
    topic: 'budget-alerts',
  });
  assert.throws(() => validateNtfyConfig({ server: 'file:///tmp', topic: 'alerts' }));
  assert.throws(() => validateNtfyConfig({ server: 'https://ntfy.sh', topic: 'bad/topic' }));
});

test('daily ntfy summaries publish once and retry after failure', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const db = dbm.getUserDb('notify-user');
  dbm.als.run(db, () => {
    const month = currentMonth();
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('ntfy_enabled', '1') ON CONFLICT(key) DO UPDATE SET value='1'",
    ).run();
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('ntfy_server', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(`http://127.0.0.1:${port}`);
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('ntfy_topic', 'alerts') ON CONFLICT(key) DO UPDATE SET value='alerts'",
    ).run();
    const category = db
      .prepare("INSERT INTO categories (name, monthly_budget) VALUES ('Tight budget', 10)")
      .run().lastInsertRowid;
    const account = db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get().id;
    db.prepare(
      `INSERT INTO transactions (date, description, amount, currency, category_id, account_id, dedup_key)
       VALUES (?, 'Overspend', -20, 'EUR', ?, ?, 'notify-test')`,
    ).run(`${month}-15`, category, account);
  });
  const first = await dbm.als.run(db, () => sendDailySummary());
  const second = await dbm.als.run(db, () => sendDailySummary());
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(received.length, 1);
  assert.match(received[0].body, /Tight budget is over budget/);
  assert.equal(received[0].headers.title, `Budget Planner warnings for ${currentMonth()}`);
  server.close();
  dbm.closeUserDb('notify-user');
});

test('ntfy publisher sends bearer token and message', async () => {
  let request;
  const server = http.createServer((req, res) => {
    request = req;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await publishNtfy({
    server: `http://127.0.0.1:${port}`,
    topic: 'alerts',
    token: 'tk_test',
    title: 'Test',
    message: 'Hello',
  });
  assert.equal(request.headers.authorization, 'Bearer tk_test');
  server.close();
});
