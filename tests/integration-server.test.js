import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { freshDataDir, cleanup, startServer } from './helpers.js';

const dir = freshDataDir();
let srv;
let cookies = '';

before(async () => {
  srv = await startServer(dir, 0, { METRICS_ENABLED: '1' });
});
after(async () => {
  await srv?.stop();
  cleanup(dir);
});

test('security headers are present and X-Powered-By is gone', async () => {
  const r = await fetch(`${srv.url}/api/auth/status`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(r.headers.get('content-security-policy')?.includes("script-src 'self'"));
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('optional metrics expose request counters without budget data', async () => {
  const r = await fetch(`${srv.url}/metrics`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/plain;.*version=0\.0\.4/);
  assert.match(await r.text(), /budget_planner_requests_total \d+/);
});

test('setup rejects short passwords', async () => {
  const r = await fetch(`${srv.url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'short' }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /at least 8 characters/);
});

test('setup creates the admin account and logs in', async () => {
  const r = await fetch(`${srv.url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'correct-horse-battery' }),
  });
  assert.equal(r.status, 200);
  cookies =
    r.headers
      .getSetCookie?.()
      .map((c) => c.split(';')[0])
      .join('; ') ?? '';
  assert.ok(cookies.length > 0);

  const me = await fetch(`${srv.url}/api/auth/me`, { headers: { Cookie: cookies } });
  assert.equal(me.status, 200);
  const info = await me.json();
  assert.equal(info.username, 'alice');
  assert.equal(info.admin, true);
});

test('state-changing requests reject cross-origin browser headers but allow same-origin and native requests', async () => {
  const rejected = await fetch(`${srv.url}/api/accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies,
      Origin: 'https://attacker.example',
    },
    body: JSON.stringify({ name: 'Should not exist' }),
  });
  assert.equal(rejected.status, 403);

  const sameOrigin = await fetch(`${srv.url}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies, Origin: srv.url },
    body: JSON.stringify({ name: 'Same origin account' }),
  });
  assert.equal(sameOrigin.status, 200);

  const nativeStyle = await fetch(`${srv.url}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ name: 'Native client account' }),
  });
  assert.equal(nativeStyle.status, 200);
});

test('projection scenarios compare transient deltas without changing GET projection', async () => {
  const before = await api('/projection?months=2', 'GET', null, cookies);
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const next =
    now.getMonth() === 11
      ? `${now.getFullYear() + 1}-01`
      : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}`;

  const compared = await api(
    '/projection/scenarios',
    'POST',
    {
      horizon: 2,
      scenarios: [
        {
          name: 'Raise and repair',
          monthly_income_delta: 100,
          monthly_outgoings_delta: 25,
          one_offs: [{ month: next, amount: 200 }],
        },
      ],
    },
    cookies,
  );
  assert.deepEqual(compared.baseline, before);
  assert.equal(compared.scenarios.length, 1);
  assert.equal(compared.scenarios[0].projection.months[0].net, 75);
  assert.equal(compared.scenarios[0].projection.months[1].net, -125);
  assert.equal(compared.scenarios[0].projection.months[1].total_predicted, -50);
  assert.deepEqual(await api('/projection?months=2', 'GET', null, cookies), before);
  assert.equal(compared.baseline.from, from);
});

test('projection scenarios reject malformed payloads strictly', async () => {
  const invalid = async (body) => {
    const response = await fetch(`${srv.url}/api/projection/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookies },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    return response.json();
  };
  const scenario = {
    name: 'Valid',
    monthly_income_delta: 0,
    monthly_outgoings_delta: 0,
    one_offs: [],
  };

  await invalid({ horizon: 0, scenarios: [scenario] });
  await invalid({ horizon: 241, scenarios: [scenario] });
  await invalid({ horizon: '2', scenarios: [scenario] });
  await invalid({ horizon: 2, scenarios: [] });
  await invalid({ horizon: 2, scenarios: [scenario, scenario, scenario, scenario] });
  await invalid({
    horizon: 2,
    scenarios: [{ ...scenario, monthly_income_delta: '10' }],
  });
  await invalid({
    horizon: 2,
    scenarios: [{ ...scenario, one_offs: [{ month: '2026-13', amount: 10 }] }],
  });
  await invalid({ horizon: 2, scenarios: [{ ...scenario, extra: true }] });
});

test('read-only share links expose only planned categories and can be revoked', async () => {
  const share = await api('/shares', 'POST', { month: '2026-05', expires_in_days: 30 }, cookies);
  assert.ok(share.token);
  const publicResponse = await fetch(`${srv.url}/api/share/${share.token}`);
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
  const publicView = await publicResponse.json();
  assert.equal(publicView.month, '2026-05');
  assert.ok(Array.isArray(publicView.categories));
  assert.equal('transactions' in publicView, false);
  assert.equal('accounts' in publicView, false);
  await api(`/shares/${share.id}`, 'DELETE', null, cookies);
  const revoked = await fetch(`${srv.url}/api/share/${share.token}`);
  assert.equal(revoked.status, 404);
});

test('ntfy settings are authenticated and mask stored tokens', async () => {
  const saved = await api(
    '/settings/ntfy',
    'PUT',
    { enabled: false, server: 'https://ntfy.sh', topic: 'ci-alerts', token: 'tk_secret_value' },
    cookies,
  );
  assert.equal(saved.enabled, false);
  assert.equal(saved.has_token, true);
  assert.equal(saved.token_hint, 'tk_s…alue');
  const current = await api('/settings/ntfy', 'GET', null, cookies);
  assert.equal(current.token_hint, 'tk_s…alue');
  assert.equal('token' in current, false);
});

test('settings reports the installed server version', async () => {
  const version = await api('/settings/version', 'GET', null, cookies);
  assert.match(version.server_version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof version.update_available, 'boolean');
  assert.ok(version.checked_at);
});

test('setup refuses to run once an account exists', async () => {
  const r = await fetch(`${srv.url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'another-secure-pw' }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /already exists/);
});

test('staged imports cannot be confirmed by another user', async () => {
  await api('/auth/users', 'POST', { username: 'bob', password: 'another-secure-pw' }, cookies);

  const csv = 'Started Date,Description,Amount,Currency\n2026-05-02,Private,-12,EUR\n';
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'private.csv');
  const up = await fetch(`${srv.url}/api/import/upload`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: fd,
  });
  assert.equal(up.status, 200);
  const { token } = await up.json();

  const login = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'another-secure-pw' }),
  });
  assert.equal(login.status, 200);
  const bobCookies =
    login.headers
      .getSetCookie?.()
      .map((c) => c.split(';')[0])
      .join('; ') ?? '';

  const confirm = await fetch(`${srv.url}/api/import/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bobCookies },
    body: JSON.stringify({ token }),
  });
  assert.equal(confirm.status, 400);
  assert.match((await confirm.json()).error, /Unknown or expired/);
});

test('failed logins are rate-limited', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong-pass' }),
    });
    assert.equal(r.status, 401);
  }
  const r = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'wrong-pass' }),
  });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
});

test('GET reads do not post recurrences or capture snapshots', async () => {
  const rec = await api(
    '/recurrences',
    'POST',
    { name: 'Read-only recurrence', amount: -7, day_of_month: 1, auto_post: true },
    cookies,
  );
  const before = (await api('/transactions?limit=1000', 'GET', null, cookies)).rows.filter(
    (row) => row.description === 'Read-only recurrence',
  ).length;
  const listed = await api('/recurrences', 'GET', null, cookies);
  assert.equal(listed.autoPosted, 0);
  const after = (await api('/transactions?limit=1000', 'GET', null, cookies)).rows.filter(
    (row) => row.description === 'Read-only recurrence',
  ).length;
  assert.equal(after, before);
  const historyBefore = await api('/reports/history', 'GET', null, cookies);
  const dashboard = await api('/dashboard/2026-05', 'GET', null, cookies);
  assert.ok(dashboard);
  const historyAfter = await api('/reports/history', 'GET', null, cookies);
  assert.deepEqual(historyAfter.rows, historyBefore.rows);

  const posted = await api('/recurrences/auto-post', 'POST', null, cookies);
  assert.ok(posted.autoPosted >= 1);
  const postedRows = (await api('/transactions?limit=1000', 'GET', null, cookies)).rows.filter(
    (row) => row.description === 'Read-only recurrence',
  );
  for (const row of postedRows) await api(`/transactions/${row.id}`, 'DELETE', null, cookies);
  await api(`/recurrences/${rec.id}`, 'DELETE', null, cookies);
});

test('full import → split → delete-parent flow removes split children via the API', async () => {
  const cat = await api('/categories', 'POST', { name: 'FoodInt' }, cookies);
  const catId = cat.id;

  // Import one transaction from a CSV (the standard parser detects Revolut columns).
  const csv = 'Started Date,Description,Amount,Currency\n2026-05-01,Shop,-100,EUR\n';
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
  const up = await fetch(`${srv.url}/api/import/upload`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: fd,
  });
  assert.equal(up.status, 200);
  const { token, summary } = await up.json();
  assert.equal(summary.toImport, 1);

  const done = await api('/import/confirm', 'POST', { token, account_id: null }, cookies);
  assert.equal(done.inserted, 1);

  const listed = await api('/transactions', 'GET', null, cookies);
  const tx = listed.rows.find((r) => r.description === 'Shop');
  assert.ok(tx);

  const parts = await api(
    `/transactions/${tx.id}/split`,
    'POST',
    {
      parts: [
        { category_id: catId, amount: -60 },
        { category_id: catId, amount: -40 },
      ],
    },
    cookies,
  );
  assert.equal(parts.parts, 2);

  const listedSplit = await api('/transactions', 'GET', null, cookies);
  assert.equal(listedSplit.rows.filter((r) => r.split_of === tx.id).length, 2);

  const child = listedSplit.rows.find((r) => r.split_of === tx.id);
  const childDelete = await fetch(`${srv.url}/api/transactions/${child.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookies },
  });
  assert.equal(childDelete.status, 400);

  await api(`/transactions/${tx.id}`, 'DELETE', null, cookies);
  const listedAfter = await api('/transactions', 'GET', null, cookies);
  assert.equal(listedAfter.rows.filter((r) => r.split_of === tx.id).length, 0);
  assert.equal(listedAfter.rows.length, 0);
});

test('attachment validation rejects truncated files and accepts a structurally valid PDF', async () => {
  const created = await api(
    '/transactions',
    'POST',
    { date: '2026-07-01', description: 'Attachment validation', amount: -2 },
    cookies,
  );
  const txId = created.ids[0];

  const upload = (bytes, type, name) => {
    const fd = new FormData();
    fd.append('transaction_id', String(txId));
    fd.append('file', new Blob([bytes], { type }), name);
    return fetch(`${srv.url}/api/attachments`, {
      method: 'POST',
      headers: { Cookie: cookies },
      body: fd,
    });
  };

  const fakePdf = await upload(Buffer.from('%PDF-1.7\ntruncated'), 'application/pdf', 'fake.pdf');
  assert.equal(fakePdf.status, 400);
  assert.match((await fakePdf.json()).error, /does not look/);

  const fakePng = await upload(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/png',
    'fake.png',
  );
  assert.equal(fakePng.status, 400);

  const validPdf = await upload(
    Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
    'application/pdf',
    'receipt.pdf',
  );
  assert.equal(validPdf.status, 200);
  const attachment = await validPdf.json();
  assert.equal(attachment.mime, 'application/pdf');
  await api(`/attachments/${attachment.id}`, 'DELETE', null, cookies);

  const validPng = await upload(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
    'image/png',
    'pixel.png',
  );
  assert.equal(validPng.status, 200);
  const image = await validPng.json();
  assert.equal(image.mime, 'image/png');
  await api(`/attachments/${image.id}`, 'DELETE', null, cookies);
});

test('transaction links, transfer pairing, coverage, and paired deletion are enforced', async () => {
  const source = await api('/accounts', 'POST', { name: 'Workflow source' }, cookies);
  const target = await api('/accounts', 'POST', { name: 'Workflow target' }, cookies);
  const category = await api(
    '/categories',
    'POST',
    { name: 'Workflow category', account_id: source.id },
    cookies,
  );
  const fund = await api(
    '/funds',
    'POST',
    { name: 'Workflow fund', start_month: '2026-06' },
    cookies,
  );
  const commitment = await api(
    '/commitments',
    'POST',
    {
      name: 'Workflow commitment',
      start_month: '2026-06',
      monthly_amount: 30,
      account_id: source.id,
      category_id: category.id,
    },
    cookies,
  );

  const invalid = await fetch(`${srv.url}/api/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({
      date: '2026-06-20',
      description: 'Invalid link',
      amount: -1,
      account_id: 999999,
      commitment_id: 999999,
    }),
  });
  assert.equal(invalid.status, 400);

  const invalidSources = await api(
    '/transactions',
    'POST',
    {
      date: '2026-06-20',
      description: 'Two funding sources',
      amount: -1,
      fund_id: fund.id,
      commitment_id: commitment.id,
    },
    cookies,
  ).catch((error) => ({ error }));
  assert.match(invalidSources.error?.message ?? '', /fund or commitment/i);

  await api(
    '/transactions',
    'POST',
    {
      date: '2026-06-20',
      description: 'Fund-covered payment',
      amount: -20,
      account_id: source.id,
      category_id: category.id,
      fund_id: fund.id,
    },
    cookies,
  );
  await api(
    '/transactions',
    'POST',
    {
      date: '2026-06-20',
      description: 'Commitment-covered payment',
      amount: -30,
      account_id: source.id,
      category_id: category.id,
      commitment_id: commitment.id,
    },
    cookies,
  );
  const listed = await api('/transactions', 'GET', null, cookies);
  const covered = listed.rows.find((row) => row.description === 'Commitment-covered payment');
  assert.equal(covered.commitment_name, 'Workflow commitment');
  const commitments = await api('/commitments?month=2026-06', 'GET', null, cookies);
  const paidCommitment = commitments.find((row) => row.id === commitment.id);
  assert.equal(paidCommitment.paid_amount, 30);
  assert.equal(paidCommitment.payment_status, 'paid');

  const invalidPatch = await fetch(`${srv.url}/api/transactions/${covered.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ account_id: 999999 }),
  });
  assert.equal(invalidPatch.status, 400);

  const dashboard = await api('/dashboard/2026-06', 'GET', null, cookies);
  const coverage = dashboard.rows.find((row) => row.id === category.id);
  assert.equal(coverage.actual, 50);
  assert.equal(coverage.total_actual, 50);
  assert.equal(coverage.fund_covered, 20);
  assert.equal(coverage.commitment_covered, 30);
  assert.equal(coverage.budget_actual, 0);
  assert.equal(coverage.uncovered_amount, 0);

  const transfer = await api(
    '/transactions/transfer',
    'POST',
    {
      source_account_id: source.id,
      target_account_id: target.id,
      amount: 42,
      date: '2026-06-21',
      description: 'Workflow transfer',
    },
    cookies,
  );
  assert.equal(transfer.transactions.length, 2);
  assert.equal(transfer.transactions[0].transfer_group, transfer.transfer_group);
  assert.equal(transfer.transactions[0].category_id, null);

  const existing = await api(
    '/transactions',
    'POST',
    [
      {
        date: '2026-06-22',
        description: 'Imported transfer out',
        amount: -8,
        account_id: source.id,
      },
      {
        date: '2026-06-23',
        description: 'Imported transfer in',
        amount: 8,
        account_id: target.id,
      },
    ],
    cookies,
  );
  await api(`/transactions/${existing.ids[0]}`, 'PATCH', { category_id: category.id }, cookies);
  const pair = await api(
    '/transactions/transfer/pair',
    'POST',
    { transaction_a_id: existing.ids[0], transaction_b_id: existing.ids[1] },
    cookies,
  );
  assert.equal(pair.transactions[0].transfer_group, pair.transfer_group);
  assert.equal(pair.transactions[0].category_id, null);
  const unpaired = await api(`/transactions/${existing.ids[0]}/unpair`, 'POST', null, cookies);
  assert.equal(unpaired.unpaired, 2);
  const existingRows = (await api('/transactions', 'GET', null, cookies)).rows.filter((row) =>
    existing.ids.includes(row.id),
  );
  assert.equal(
    existingRows.every((row) => row.transfer_group === null),
    true,
  );

  const candidates = await api('/transactions/transfer/candidates', 'GET', null, cookies);
  assert.equal(
    candidates.candidates.some(
      (candidate) =>
        candidate.transaction_a_id === transfer.source_id ||
        candidate.transaction_b_id === transfer.source_id,
    ),
    false,
  );

  const deleted = await fetch(
    `${srv.url}/api/transactions/${transfer.source_id}?delete_partner=true`,
    { method: 'DELETE', headers: { Cookie: cookies } },
  );
  assert.equal(deleted.status, 200);
  const afterDelete = await api('/transactions', 'GET', null, cookies);
  assert.equal(
    afterDelete.rows.some((row) => transfer.ids.includes(row.id)),
    false,
  );
});

test('fund totals reconcile all cash flows and reject invalid month/amount values', async () => {
  const invalid = async (path, method, body) => {
    const response = await fetch(`${srv.url}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookies },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    return response.json();
  };

  await invalid('/funds?month=2026-13', 'GET');
  await invalid('/funds', 'POST', { name: 'Invalid fund month', start_month: '2026-00' });
  await invalid('/funds', 'POST', {
    name: 'Invalid fund amount',
    start_month: '2026-08',
    monthly_contribution: 'Infinity',
  });

  const account = await api('/accounts', 'POST', { name: 'Fund reconciliation account' }, cookies);
  const fund = await api(
    '/funds',
    'POST',
    {
      name: 'Fund reconciliation API',
      start_month: '2026-08',
      monthly_contribution: 100,
      opening_balance: 50,
      target_amount: 500,
      target_date: '2026-12',
    },
    cookies,
  );
  await invalid(`/funds/${fund.id}/movement`, 'POST', {
    kind: 'contribution',
    amount: 'NaN',
    month: '2026-09',
  });
  await invalid(`/funds/${fund.id}/movement`, 'POST', {
    kind: 'contribution',
    amount: 10,
    month: '2026-13',
  });
  await invalid(`/funds/${fund.id}`, 'PATCH', { target_date: '2026-13' });
  await invalid(`/funds/${fund.id}`, 'PATCH', { target_amount: 'Infinity' });
  await invalid(`/funds/${fund.id}`, 'PATCH', { target_date: '' });
  await invalid(`/funds/${fund.id}`, 'PATCH', { target_amount: '' });

  await api(
    `/funds/${fund.id}/movement`,
    'POST',
    { kind: 'contribution', amount: 25, month: '2026-08' },
    cookies,
  );
  await api(
    `/funds/${fund.id}/movement`,
    'POST',
    { kind: 'withdrawal', amount: 40, month: '2026-09' },
    cookies,
  );
  await api(
    '/transactions',
    'POST',
    [
      {
        date: '2026-08-05',
        description: 'Fund reconciliation bill',
        amount: -80,
        account_id: account.id,
        fund_id: fund.id,
      },
      {
        date: '2026-09-05',
        description: 'Fund reconciliation refund',
        amount: 15,
        account_id: account.id,
        fund_id: fund.id,
      },
    ],
    cookies,
  );

  const listed = await api('/funds?month=2026-09', 'GET', null, cookies);
  const reconciled = listed.funds.find((row) => row.id === fund.id);
  assert.equal(reconciled.contributed_so_far, 290);
  assert.equal(reconciled.withdrawn_so_far, 120);
  assert.equal(reconciled.balance, 170);
  assert.equal(reconciled.contributed_so_far - reconciled.withdrawn_so_far, reconciled.balance);
});

test('unknown API routes return a JSON 404', async () => {
  const r = await fetch(`${srv.url}/api/definitely-not-a-route`);
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'Not found' });
});

test('transaction listing paginates and rejects invalid pagination parameters', async () => {
  const all = await api('/transactions?limit=1000', 'GET', null, cookies);
  assert.ok(all.total >= 2);

  const first = await api('/transactions?limit=1&offset=0', 'GET', null, cookies);
  const second = await api('/transactions?limit=1&offset=1', 'GET', null, cookies);
  assert.equal(first.rows.length, 1);
  assert.equal(second.rows.length, 1);
  assert.equal(first.total, all.total);
  assert.equal(second.total, all.total);
  assert.notEqual(first.rows[0].id, second.rows[0].id);

  for (const query of [
    'limit=0',
    'limit=1001',
    'limit=1.5',
    'limit=not-a-number',
    'offset=-1',
    'offset=1.5',
    'offset=not-a-number',
    'offset=9007199254740992',
  ]) {
    const response = await fetch(`${srv.url}/api/transactions?${query}`, {
      headers: { Cookie: cookies },
    });
    assert.equal(response.status, 400, query);
  }
});

test('healthz responds without authentication', async () => {
  const r = await fetch(`${srv.url}/healthz`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.ok(typeof body.uptime === 'number');
});

test('recurrence posting is idempotent and future posts do not suppress the current month', async () => {
  await api('/accounts', 'GET', null, cookies).catch(() => null);
  // /api/accounts may not exist; the categories route is enough for a valid category
  const cats = await api('/categories', 'GET', null, cookies);
  const catId = cats.find?.((c) => c.id)?.id;
  assert.ok(catId);

  const rec = await api(
    '/recurrences',
    'POST',
    {
      name: 'Integration Rent',
      amount: -50,
      day_of_month: 1,
      account_id: null,
      category_id: catId,
      auto_post: true,
    },
    cookies,
  );
  assert.ok(rec.id);

  // Invalid month is rejected before any transaction exists.
  const bad = await fetch(`${srv.url}/api/recurrences/${rec.id}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ month: 'not-a-month' }),
  });
  assert.equal(bad.status, 400);

  // Post a FUTURE month explicitly.
  const now = new Date();
  const nextMonth =
    now.getMonth() === 11
      ? `${now.getFullYear() + 1}-01`
      : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}`;
  const posted = await api(`/recurrences/${rec.id}/post`, 'POST', { month: nextMonth }, cookies);
  assert.equal(posted.ok, true);

  // Listing is read-only now. Explicit auto-posting must still post the
  // CURRENT month even though last_posted_month points at the future month.
  const list = await api('/recurrences', 'GET', null, cookies);
  assert.equal(list.autoPosted, 0);
  const mine = list.recurrences.find((r) => r.id === rec.id);
  assert.equal(mine.last_posted_month, nextMonth);
  const autoPosted = await api('/recurrences/auto-post', 'POST', null, cookies);
  assert.equal(autoPosted.autoPosted >= 1, true);

  // Both months exist exactly once — re-listing must not duplicate anything.
  const before = (await api('/transactions?limit=1000', 'GET', null, cookies)).rows.filter(
    (t) => t.description === 'Integration Rent',
  ).length;
  const listed2 = await api('/recurrences', 'GET', null, cookies);
  const after = (await api('/transactions?limit=1000', 'GET', null, cookies)).rows.filter(
    (t) => t.description === 'Integration Rent',
  ).length;
  assert.equal(listed2.autoPosted, 0); // nothing due anymore this run
  assert.equal(after, before);

  // Posting the same future month again changes nothing (idempotent dedup).
  await api(`/recurrences/${rec.id}/post`, 'POST', { month: nextMonth }, cookies);
  const finalCount = (await api('/transactions?limit=1000', 'GET', null, cookies)).rows.filter(
    (t) => t.description === 'Integration Rent',
  ).length;
  assert.equal(finalCount, after);

  await api(`/recurrences/${rec.id}`, 'DELETE', null, cookies);
});

test('multi-category recurrence templates post atomically as transaction splits', async () => {
  const cats = await api('/categories', 'GET', null, cookies);
  const categoryIds = cats
    .filter((c) => c.id)
    .slice(0, 2)
    .map((c) => c.id);
  assert.equal(categoryIds.length, 2);

  const rec = await api(
    '/recurrences',
    'POST',
    {
      name: 'Integration Household',
      amount: -30,
      day_of_month: 15,
      parts: [
        { category_id: categoryIds[0], amount: -20 },
        { category_id: categoryIds[1], amount: -10 },
      ],
    },
    cookies,
  );
  assert.equal(rec.category_id, null);
  assert.equal(rec.parts.length, 2);

  const invalidUpdate = await fetch(`${srv.url}/api/recurrences/${rec.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ amount: -31 }),
  });
  assert.equal(invalidUpdate.status, 400);

  const categoryDelete = await fetch(`${srv.url}/api/categories/${categoryIds[0]}`, {
    method: 'DELETE',
    headers: { Cookie: cookies },
  });
  assert.equal(categoryDelete.status, 409);

  const month = '2099-12';
  await api(`/recurrences/${rec.id}/post`, 'POST', { month }, cookies);
  const rows = (await api('/transactions?limit=1000', 'GET', null, cookies)).rows.filter(
    (t) => t.description === 'Integration Household',
  );
  const parent = rows.find((t) => t.split_of === null);
  const children = rows.filter((t) => t.split_of === parent?.id);
  assert.ok(parent);
  assert.equal(parent.amount, -30);
  assert.equal(parent.category_id, null);
  assert.equal(children.length, 2);
  assert.deepEqual(
    children.map((t) => [t.category_id, t.amount]).sort(([a], [b]) => a - b),
    [
      ...[
        [categoryIds[0], -20],
        [categoryIds[1], -10],
      ].sort(([a], [b]) => a - b),
    ],
  );

  await api(`/recurrences/${rec.id}/post`, 'POST', { month }, cookies);
  const again = (await api('/transactions?limit=1000', 'GET', null, cookies)).rows.filter(
    (t) => t.description === 'Integration Household',
  );
  assert.equal(again.length, rows.length);
  await api(`/recurrences/${rec.id}`, 'DELETE', null, cookies);
});

test('restore rejects garbage and table-less files without touching live data', async () => {
  const before = (await api('/transactions?limit=1', 'GET', null, cookies)).total;

  const notDbFd = new FormData();
  notDbFd.append('file', new Blob(['this is definitely not a sqlite database']), 'garbage.db');
  const notDb = await fetch(`${srv.url}/api/settings/restore`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: notDbFd,
  });
  assert.equal(notDb.status, 400);
  const dbErr = (await notDb.json()).error;
  assert.match(dbErr, /not a database|valid budget backup|integrity|missing|Not a valid/i);

  // A valid SQLite file that is NOT a budget backup must be refused too.
  const tmp = mkdtempSync(path.join(tmpdir(), 'restore-'));
  const emptyPath = path.join(tmp, 'empty.db');
  const e = new DatabaseSync(emptyPath);
  e.exec('CREATE TABLE unrelated (x)');
  e.close();
  const emptyFd = new FormData();
  emptyFd.append('file', new Blob([readFileSync(emptyPath)]), 'empty.db');
  const emptyRestore = await fetch(`${srv.url}/api/settings/restore`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: emptyFd,
  });
  assert.equal(emptyRestore.status, 400);
  assert.match((await emptyRestore.json()).error, /missing/);
  rmSync(tmp, { recursive: true, force: true });

  const after = (await api('/transactions?limit=1', 'GET', null, cookies)).total;
  assert.equal(after, before); // live data untouched
});

test('backup → restore round trip preserves the data', async () => {
  const txBefore = (await api('/transactions?limit=1', 'GET', null, cookies)).total;

  const backup = await fetch(`${srv.url}/api/settings/backup`, { headers: { Cookie: cookies } });
  assert.equal(backup.status, 200);
  const buf = Buffer.from(await backup.arrayBuffer());

  const restoreFd = new FormData();
  restoreFd.append('file', new Blob([buf]), 'budget-backup.db');
  const restore = await fetch(`${srv.url}/api/settings/restore`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: restoreFd,
  });
  assert.equal(restore.status, 200);
  const body = await restore.json();
  assert.equal(body.ok, true);
  assert.equal(body.transactions, txBefore);

  const after = (await api('/transactions?limit=1', 'GET', null, cookies)).total;
  assert.equal(after, txBefore);
});

test('re-importing the same statement inserts nothing; duplicates within one file both import', async () => {
  const csv = [
    'Started Date,Description,Amount,Currency',
    '2026-05-10,Coffee Bar,-4.50,EUR',
    '2026-05-10,Coffee Bar,-4.50,EUR', // two genuinely different purchases
  ].join('\n');
  const upload = async () => {
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'coffee.csv');
    const up = await fetch(`${srv.url}/api/import/upload`, {
      method: 'POST',
      headers: { Cookie: cookies },
      body: fd,
    });
    assert.equal(up.status, 200);
    return up.json();
  };

  // First pass: both rows in one file are distinct occurrences — preview shows
  // both as new, confirm inserts both.
  const first = await upload();
  assert.equal(first.summary.toImport, 2);
  const firstDone = await api(
    '/import/confirm',
    'POST',
    { token: first.token, account_id: null },
    cookies,
  );
  assert.equal(firstDone.inserted, 2);

  // Re-import of the same file: preview flags both as duplicates, confirm inserts nothing.
  const second = await upload();
  assert.equal(second.summary.toImport, 0);
  assert.equal(second.summary.duplicates, 2);
  const secondDone = await api(
    '/import/confirm',
    'POST',
    { token: second.token, account_id: null },
    cookies,
  );
  assert.equal(secondDone.inserted, 0);
  assert.equal(secondDone.skippedDuplicates, 2);
});

test('xlsx monthly export round-trips through the maintained spreadsheet package', async () => {
  const r = await fetch(`${srv.url}/api/reports/export/monthly/2026-05.xlsx`, {
    headers: { Cookie: cookies },
  });
  assert.equal(r.status, 200);
  assert.equal(
    r.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  assert.equal(wb.SheetNames[0], 'Transactions');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Transactions']);
  const coffee = rows.filter((row) => row.Description === 'Coffee Bar');
  assert.equal(coffee.length, 2);
  assert.equal(coffee[0].Amount, -4.5);
  assert.equal(coffee[0].Currency, 'EUR');
});

test('yearly report includes per-category monthly spending', async () => {
  const report = await api('/reports/yearly/2026', 'GET', null, cookies);
  assert.ok(Array.isArray(report.byCategoryMonthly));
  assert.ok(
    report.byCategoryMonthly.some(
      (row) => row.month === '2026-05' && row.name === 'Uncategorized' && row.spent < 0,
    ),
  );
});

test('report filters and exports respect the selected account', async () => {
  const first = await api('/accounts', 'POST', { name: 'Report account A' }, cookies);
  const second = await api('/accounts', 'POST', { name: 'Report account B' }, cookies);
  const category = await api(
    '/categories',
    'POST',
    { name: 'Report groceries', monthly_budget: 200, account_id: first.id },
    cookies,
  );
  await api(
    '/transactions',
    'POST',
    {
      date: '2026-05-20',
      description: 'A-only grocery',
      amount: -40,
      currency: 'EUR',
      account_id: first.id,
      category_id: category.id,
    },
    cookies,
  );
  await api(
    '/transactions',
    'POST',
    {
      date: '2026-05-20',
      description: 'B-only grocery',
      amount: -90,
      currency: 'EUR',
      account_id: second.id,
    },
    cookies,
  );

  const report = await api(`/reports/monthly/2026-05?account_id=${first.id}`, 'GET', null, cookies);
  assert.equal(report.totals.expenses, -40);
  assert.ok(report.byCategory.some((row) => row.name === 'Report groceries' && row.spent === -40));

  const csv = await fetch(`${srv.url}/api/reports/export/monthly/2026-05?account_id=${first.id}`, {
    headers: { Cookie: cookies },
  });
  assert.equal(csv.status, 200);
  const csvText = await csv.text();
  assert.match(csvText, /A-only grocery/);
  assert.doesNotMatch(csvText, /B-only grocery/);

  const xlsx = await fetch(
    `${srv.url}/api/reports/export/monthly/2026-05.xlsx?account_id=${first.id}`,
    {
      headers: { Cookie: cookies },
    },
  );
  assert.equal(xlsx.status, 200);
  const workbook = XLSX.read(Buffer.from(await xlsx.arrayBuffer()), { type: 'buffer' });
  const summary = XLSX.utils.sheet_to_json(workbook.Sheets.Summary);
  assert.ok(summary.some((row) => row.Category === 'Report groceries' && row.Actual === 40));
});

async function api(path, method, body, cookie) {
  const r = await fetch(`${srv.url}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
