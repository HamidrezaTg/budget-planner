import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chatComplete } from './ai.js';

const MAX_PAGES = 10;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

function formatFor(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const signature = Buffer.alloc(8);
  try {
    fs.readSync(fd, signature, 0, signature.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (signature.subarray(0, 4).toString('ascii') === '%PDF') return 'pdf';
  if (
    signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (signature[0] === 0xff && signature[1] === 0xd8) return 'jpeg';
  throw new Error('Online OCR supports only PDF, PNG, and JPEG statements');
}

function renderPdf(filePath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulden-online-ocr-'));
  try {
    let info;
    try {
      info = execFileSync('pdfinfo', [filePath], { encoding: 'utf8', timeout: 30_000 });
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new Error('Online PDF OCR requires Poppler (poppler-utils)');
      throw new Error('Could not inspect PDF for online OCR');
    }
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!Number.isInteger(pages) || pages < 1)
      throw new Error('Could not determine the PDF page count');
    if (pages > MAX_PAGES) throw new Error(`Online OCR supports at most ${MAX_PAGES} PDF pages`);
    const prefix = path.join(dir, 'page');
    try {
      execFileSync(
        'pdftoppm',
        ['-f', '1', '-l', String(pages), '-r', '120', '-png', filePath, prefix],
        {
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new Error('Online PDF OCR requires Poppler (poppler-utils)');
      throw new Error('Could not render PDF for online OCR');
    }
    const images = fs
      .readdirSync(dir)
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
      .map((name) => ({ path: path.join(dir, name), mime: 'image/png' }));
    return { dir, images };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function onlineOcr(filePath, cfg) {
  const format = formatFor(filePath);
  const rendered = format === 'pdf' ? renderPdf(filePath) : null;
  const images = rendered?.images || [
    { path: filePath, mime: format === 'png' ? 'image/png' : 'image/jpeg' },
  ];
  if (images.length > MAX_PAGES) throw new Error(`Online OCR supports at most ${MAX_PAGES} pages`);
  let total = 0;
  try {
    const content = [
      {
        type: 'text',
        text:
          'Read this bank statement image. Return only the visible statement text, one transaction per line. ' +
          'Preserve dates, descriptions, amounts, debit/credit signs, and currencies. Do not invent missing values.',
      },
    ];
    for (const image of images) {
      const data = fs.readFileSync(image.path);
      if (data.length > MAX_IMAGE_BYTES) throw new Error('A rendered OCR page is too large');
      total += data.length;
      if (total > MAX_TOTAL_BYTES)
        throw new Error('The rendered OCR pages exceed the upload limit');
      content.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${data.toString('base64')}` },
      });
    }
    const message = await chatComplete(cfg, [
      { role: 'system', content: 'You are a careful bank-statement OCR engine.' },
      { role: 'user', content },
    ]);
    const text = String(message.content || '').trim();
    if (!text) throw new Error('Online OCR returned no text');
    return text;
  } finally {
    if (rendered) fs.rmSync(rendered.dir, { recursive: true, force: true });
  }
}
