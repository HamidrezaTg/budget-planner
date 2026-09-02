import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onlineOcr } from '../server/services/online-ocr.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-online-ocr-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('online OCR sends a bounded image data URL to the selected AI profile', async () => {
  const file = path.join(dir, 'statement.png');
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('test-image'),
    ]),
  );
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '2026-05-01 Groceries -12.50' } }] }),
    };
  };
  try {
    const text = await onlineOcr(file, {
      baseUrl: 'https://example.test/v1',
      apiKey: 'secret',
      model: 'vision',
    });
    assert.match(text, /Groceries/);
    const image = request.messages[1].content.find((part) => part.type === 'image_url');
    assert.match(image.image_url.url, /^data:image\/png;base64,/);
    assert.equal(request.model, 'vision');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('online OCR rejects non-image and non-PDF files before making a request', async () => {
  const file = path.join(dir, 'statement.csv');
  fs.writeFileSync(file, 'date,amount\n2026-05-01,-1');
  await assert.rejects(
    onlineOcr(file, { baseUrl: 'https://example.test/v1', apiKey: 'secret', model: 'vision' }),
    /supports only PDF, PNG, and JPEG/,
  );
});
