import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

const root = path.resolve(env.UPLOAD_DIR);

export async function saveFile(buf: Buffer, originalName: string, folder = 'documents') {
  const ext = path.extname(originalName).toLowerCase();
  const id = crypto.randomUUID();
  const rel = path.join(folder, new Date().toISOString().slice(0, 7), `${id}${ext}`);
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  const checksum = crypto.createHash('sha256').update(buf).digest('hex');
  return { storagePath: rel, checksum, size: buf.length };
}

export async function readStored(storagePath: string): Promise<Buffer> {
  const abs = path.resolve(root, storagePath);
  if (!abs.startsWith(root)) throw new Error('Invalid storage path'); // path traversal guard
  return fs.readFile(abs);
}
