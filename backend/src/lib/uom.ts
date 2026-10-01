import { Prisma } from '@prisma/client';
import { badRequest } from './errors';

// Base units: mass → g, volume → ml, count → nos
const TABLE: Record<string, { dim: 'mass' | 'volume' | 'count'; factor: number }> = {
  KG: { dim: 'mass', factor: 1000 }, G: { dim: 'mass', factor: 1 }, GM: { dim: 'mass', factor: 1 }, MG: { dim: 'mass', factor: 0.001 },
  L: { dim: 'volume', factor: 1000 }, LTR: { dim: 'volume', factor: 1000 }, ML: { dim: 'volume', factor: 1 },
  NOS: { dim: 'count', factor: 1 }, TAB: { dim: 'count', factor: 1 }, CAP: { dim: 'count', factor: 1 }, PCS: { dim: 'count', factor: 1 }, BTL: { dim: 'count', factor: 1 },
};

const norm = (u: string) => u.trim().toUpperCase().replace(/\./g, '');

/** Convert a quantity between units of the same dimension (e.g. g → kg). Same unit is a no-op. */
export function convertQty(qty: Prisma.Decimal | number, from: string, to: string): Prisma.Decimal {
  const q = new Prisma.Decimal(qty);
  const f = norm(from), t = norm(to);
  if (f === t) return q;
  const a = TABLE[f], b = TABLE[t];
  if (!a || !b) throw badRequest(`Unknown unit of measure: ${!a ? from : to}`);
  if (a.dim !== b.dim) throw badRequest(`Cannot convert ${from} to ${to} (different dimensions)`);
  return q.mul(a.factor).div(b.factor);
}
