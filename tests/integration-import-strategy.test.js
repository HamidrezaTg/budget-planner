import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freshDataDir, cleanup, startServer } from './helpers.js';

const dataDir = freshDataDir();
let app;
let ai;
let cookies = '';
let aiCalls = 0;

function makePdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(Buffer.from(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`));
  }
  const xref = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (let i = 1; i < offsets.length; i++)
    chunks.push(Buffer.from(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`));
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

async function api(method, route, body) {
  const response = await fetch(`${app.url}${route}`, {
    method,
    headers: { Cookie: cookies, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookies = setCookie.split(';')[0];
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function upload(filename, content, templateMode = 'reuse') {
  const form = new FormData();
  form.append(
    'file',
    new Blob([content], { type: filename.endsWith('.pdf') ? 'application/pdf' : 'text/csv' }),
    filename,
  );
  form.append('template_mode', templateMode);
  const response = await fetch(`${app.url}/api/import/upload`, {
    method: 'POST',
    headers: { Cookie: cookies },
    body: form,
  });
  return { status: response.status, data: await response.json() };
}

before(async () => {
  ai = http.createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    aiCalls++;
    let requestBody = '';
    for await (const chunk of request) requestBody += chunk;
    if (!Array.isArray(JSON.parse(requestBody).messages)) {
      response.writeHead(400).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                header_row_index: 0,
                col_date: 0,
                col_description: 1,
                col_amount: 2,
                col_in: null,
                col_out: null,
                col_state: null,
                ignore_states: [],
                col_type: null,
                col_currency: 3,
                date_format: 'DD/MM/YYYY',
                decimal_point: ',',
                notes: 'The bank uses a date, description, and amount layout.',
                direct_import_instruction:
                  'Use this mapping for future exports with the same headers.',
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => ai.listen(0, '127.0.0.1', resolve));
  app = await startServer(dataDir);
  const setup = await api('POST', '/api/auth/setup', {
    username: 'importer',
    password: 'correct-import-password',
  });
  assert.equal(setup.status, 200);
  const port = ai.address().port;
  const settings = await api('PUT', '/api/settings', {
    provider: 'custom',
    base_url: `http://127.0.0.1:${port}/v1`,
    api_key: 'test-key',
    model: 'test-model',
  });
  assert.equal(settings.status, 200);
});

after(async () => {
  await app?.stop();
  await new Promise((resolve) => ai?.close(resolve));
  cleanup(dataDir);
});

test('failed CSV preflight can be AI-approved and reused as a private template', async () => {
  const csv = 'When,What,Money,Currency\n05/06/2026,Groceries,"-12,50",EUR\n';
  const first = await upload('bank-export.csv', csv);
  assert.equal(first.status, 200);
  assert.equal(first.data.csv_check.status, 'needs_ai');
  assert.match(first.data.csv_check.instruction, /AI analysis is recommended/);

  const analyzed = await api('POST', '/api/import/analyze', { token: first.data.token });
  assert.equal(analyzed.status, 200, JSON.stringify(analyzed.data));
  assert.equal(analyzed.data.csv_check.status, 'analyzed');
  assert.equal(analyzed.data.csv_check.template_saved, true);
  assert.equal(analyzed.data.preview[0].amount, -12.5);
  assert.match(analyzed.data.ai_instruction, /without AI analysis/);

  const templates = await api('GET', '/api/import/templates');
  assert.equal(templates.status, 200);
  assert.equal(templates.data.templates.length, 1);
  assert.equal(aiCalls, 1);

  const second = await upload('bank-export-again.csv', csv);
  assert.equal(second.status, 200);
  assert.equal(second.data.template_used, true);
  assert.equal(second.data.csv_check.status, 'template');
  assert.equal(second.data.preview[0].amount, -12.5);
  assert.equal(aiCalls, 1, 'matching template should avoid another AI request');

  const fresh = await upload('bank-export-fresh.csv', csv, 'fresh');
  assert.equal(fresh.status, 200);
  assert.equal(fresh.data.template_mode, 'fresh');
  assert.equal(fresh.data.csv_check.status, 'needs_ai');
  assert.equal(fresh.data.template_used, undefined);
  assert.equal(aiCalls, 1, 'fresh mode should ignore the saved template');
});

test('PDF import always sends OCR output through AI structuring', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-import-pdf-'));
  const file = path.join(dir, 'statement.pdf');
  try {
    writeFileSync(file, makePdf('BT /F1 12 Tf 50 750 Td (01.09.2026 REWE Market -12,50) Tj ET'));
    const result = await upload('statement.pdf', readFileSync(file));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.ocr_structured_by_ai, true);
    assert.equal(result.data.preview[0].description, 'REWE Market');
    assert.ok(aiCalls >= 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
