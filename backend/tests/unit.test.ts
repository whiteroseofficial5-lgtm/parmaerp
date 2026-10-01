import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { convertQty } from '../src/lib/uom';
import { bestMatch, similarity } from '../src/lib/fuzzy';
import { addMonths, expiryFrom, daysBetween } from '../src/services/dates';
import { holt, mean, std } from '../src/lib/stats';
import { can, ROLE_PERMISSIONS } from '../src/config/permissions';

test('UOM conversion: mass, volume, identity, and rejection of incompatible dimensions', () => {
  assert.equal(convertQty(750, 'G', 'KG').toString(), '0.75');
  assert.equal(convertQty(2, 'KG', 'G').toString(), '2000');
  assert.equal(convertQty(500, 'ML', 'L').toString(), '0.5');
  assert.equal(convertQty(new Prisma.Decimal('1.5'), 'kg', 'KG').toString(), '1.5');
  assert.throws(() => convertQty(1, 'KG', 'L'), /different dimensions/);
  assert.throws(() => convertQty(1, 'FURLONG', 'KG'), /Unknown unit/);
});

test('fuzzy matching maps invoice descriptions to material master names', () => {
  assert.ok(similarity('Paracetamol IP', 'Paracetamol') > 0.8);
  assert.ok(similarity('Magnesium Stearate', 'Magnesium Stearate IP') > 0.8);
  assert.ok(similarity('Paracetamol', 'Ibuprofen') < 0.4);
  const mats = [{ n: 'Maize Starch IP' }, { n: 'Povidone K30' }, { n: 'Talc' }];
  assert.equal(bestMatch('Povidone K-30', mats, (m) => [m.n])?.item.n, 'Povidone K30');
  assert.equal(bestMatch('Completely unrelated chemical', mats, (m) => [m.n]), null);
});

test('date helpers: month clamping and pharma expiry convention (last valid day)', () => {
  assert.equal(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(expiryFrom(new Date('2026-03-15T00:00:00Z'), 24).toISOString().slice(0, 10), '2028-03-14');
  assert.equal(daysBetween(new Date('2026-01-01'), new Date('2026-01-31')), 30);
});

test('Holt forecast follows an upward trend and is non-negative; flat series stays flat', () => {
  const up = holt([10, 12, 14, 16, 18, 20], 3);
  assert.ok(up.forecast[0] > 20 && up.forecast[2] > up.forecast[0]);
  const flat = holt([50, 50, 50, 50], 2);
  assert.ok(Math.abs(flat.forecast[0] - 50) < 0.001 && flat.sigma < 0.001);
  assert.ok(holt([5, 3, 1, 0], 3).forecast.every((v) => v >= 0));
  assert.deepEqual(holt([], 2).forecast, [0, 0]);
  assert.equal(Math.round(mean([2, 4, 6])), 4);
  assert.ok(std([1, 1, 1]) === 0);
});

test('RBAC: segregation of duties is encoded in the permission matrix', () => {
  assert.ok(can('SUPER_ADMIN', 'anything:at-all'));
  // Author (production) can create/submit formulas but cannot approve; QC approves but cannot author.
  assert.ok(can('PRODUCTION_MANAGER', 'formula:create') && !can('PRODUCTION_MANAGER', 'formula:approve'));
  assert.ok(can('QC_MANAGER', 'formula:approve') && !can('QC_MANAGER', 'formula:create'));
  // Production approves & starts batches; only QC releases.
  assert.ok(can('PRODUCTION_MANAGER', 'batch:approve') && !can('PRODUCTION_MANAGER', 'batch:release'));
  assert.ok(can('QC_MANAGER', 'batch:release') && !can('QC_MANAGER', 'batch:create'));
  // Auditor is strictly read-only (no create/update/delete/approve anywhere).
  const writes = ROLE_PERMISSIONS.AUDITOR.filter((p) => /:(create|update|delete|approve|release|adjust|dispatch)$/.test(p));
  assert.deepEqual(writes, []);
  assert.ok(can('AUDITOR', 'audit:read') && !can('STORE_OPERATOR', 'audit:read'));
  // Store operators can receive/issue but cannot adjust stock or approve lots.
  assert.ok(can('STORE_OPERATOR', 'stock:create') && !can('STORE_OPERATOR', 'stock:adjust') && !can('STORE_OPERATOR', 'stock:approve-lot'));
});
