import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from '../../config/env';
import { badRequest } from '../../lib/errors';

const run = promisify(execFile);
export const aiEnabled = () => !!env.ANTHROPIC_API_KEY;
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));

export interface FileInput { buffer: Buffer; mimeType: string; fileName: string }
export interface Extraction<T> { data: T; engine: 'claude-vision' | 'tesseract'; rawText?: string }

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Structured extraction via Claude tool-use (forced tool call ⇒ schema-shaped JSON).
 * Handles typed PDFs, multi-page scanned PDFs, photos and handwriting natively — no separate OCR pass required.
 */
export async function extractWithClaude<T>(file: FileInput, o: { toolName: string; description: string; schema: object; instruction: string }): Promise<Extraction<T>> {
  const b64 = file.buffer.toString('base64');
  let block: any;
  if (file.mimeType === 'application/pdf') block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
  else if (IMAGE_TYPES.has(file.mimeType)) block = { type: 'image', source: { type: 'base64', media_type: file.mimeType, data: b64 } };
  else throw badRequest(`${file.mimeType} is not supported by the vision extractor (use PDF, PNG, JPEG or WebP)`);

  const res = await anthropic().messages.create({
    model: env.AI_MODEL,
    max_tokens: 8000,
    system:
      'You are a GMP documentation specialist digitising pharmaceutical paperwork. Extract ONLY what is printed or written on the document. ' +
      'Never invent values: use null when a field is absent or illegible and list it in illegibleFields. Dates must be ISO (YYYY-MM-DD); ' +
      'Indian dd/mm/yyyy and dd-mm-yy formats are day-first. Numbers must be plain numerics without thousands separators. ' +
      'Report a 0..1 confidence per key field (lower for handwriting or poor scans).',
    tools: [{ name: o.toolName, description: o.description, input_schema: o.schema as any }],
    tool_choice: { type: 'tool', name: o.toolName },
    messages: [{ role: 'user', content: [block, { type: 'text', text: o.instruction }] }],
  });
  const tool = res.content.find((c) => c.type === 'tool_use') as any;
  if (!tool) throw new Error('Model returned no structured output');
  return { data: tool.input as T, engine: 'claude-vision' };
}

/** Plain-text completion (used for narrative summaries). */
export async function complete(system: string, prompt: string, maxTokens = 600): Promise<string> {
  const res = await anthropic().messages.create({ model: env.AI_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] });
  return res.content.filter((c) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
}

export { anthropic };

// ───────────── Local OCR fallback (no API key) ─────────────

async function ocrImage(buf: Buffer): Promise<string> {
  let T: any;
  try { T = await import('tesseract.js'); } catch { throw badRequest('Local OCR unavailable: install tesseract.js or configure ANTHROPIC_API_KEY'); }
  const worker = await T.createWorker('eng');
  try { return (await worker.recognize(buf)).data.text as string; } finally { await worker.terminate(); }
}

/** Multi-page PDF OCR: rasterise with poppler (pdftoppm), OCR each page. Typed PDFs use the text layer first. */
export async function ocrDocument(file: FileInput): Promise<string> {
  if (file.mimeType !== 'application/pdf') return ocrImage(file.buffer);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-'));
  try {
    const pdf = path.join(dir, 'in.pdf');
    await fs.writeFile(pdf, file.buffer);
    try {
      const { stdout } = await run('pdftotext', ['-layout', pdf, '-']);
      if (stdout.trim().length > 80) return stdout; // has a real text layer
    } catch { /* fall through to raster OCR */ }
    try { await run('pdftoppm', ['-r', '200', '-png', pdf, path.join(dir, 'p')]); }
    catch { throw badRequest('Scanned-PDF OCR needs poppler-utils (pdftoppm) on the server, or set ANTHROPIC_API_KEY'); }
    const pages = (await fs.readdir(dir)).filter((f) => f.startsWith('p') && f.endsWith('.png')).sort();
    const texts: string[] = [];
    for (const p of pages) texts.push(await ocrImage(await fs.readFile(path.join(dir, p))));
    return texts.join('\n\n--- page break ---\n\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
