import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { HttpError } from '../lib/errors';

/** Outside production, surface the last line of the driver message so a 503 is actually actionable. */
const devDetail = (e: any): string | undefined =>
  env.NODE_ENV === 'production' ? undefined : String(e?.message ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop();

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Database not reachable / credentials rejected. Without this branch it degrades into a bare
  // "Internal server error", which tells you nothing about what to fix. Checked by `name` (like
  // MulterError below) so the handler can never itself throw on an undefined error class.
  if (err?.name === 'PrismaClientInitializationError') {
    return res.status(503).json({
      error: 'Database connection failed — the server in DATABASE_URL is down or rejected the credentials. Check the API logs at boot ("Database OK …"), then: docker compose up -d db (host port 5433) and keep DATABASE_URL in sync.',
      details: devDetail(err),
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Duplicate value violates a unique constraint', details: err.meta });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
    if (err.code === 'P2003') return res.status(409).json({ error: 'Record is referenced by other data and cannot be changed/removed' });
    // Schema never pushed (or pushed against a different database) — the classic "fresh database" failure.
    if (err.code === 'P2021' || err.code === 'P2022') {
      return res.status(503).json({
        error: 'Database schema is missing or out of date. Run: npx prisma db push --skip-generate && npm run seed',
        details: devDetail(err),
      });
    }
  }
  if (err?.name === 'MulterError') return res.status(400).json({ error: err.message });
  const detail = devDetail(err);
  console.error(err);
  // In development the UI mirrors the last line of the real message, so an unmapped failure is still
  // diagnosable from the browser. Production keeps the opaque message.
  res.status(500).json({
    error: env.NODE_ENV === 'production' || !detail ? 'Internal server error' : `Internal server error: ${detail}`,
    details: detail,
  });
}

export const notFoundHandler = (_req: Request, res: Response) => res.status(404).json({ error: 'Route not found' });
