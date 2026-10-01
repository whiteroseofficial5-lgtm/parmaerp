import { Prisma, PrismaClient } from '@prisma/client';
import { getContext, mergeContext } from './context';

export const basePrisma = new PrismaClient();

/** Models that must never be audited (would recurse or add no value). */
const EXCLUDED = new Set(['AuditLog', 'Sequence', 'RefreshToken', 'Notification']);
const WRITE_OPS = new Set(['create', 'update', 'delete', 'upsert', 'createMany', 'updateMany', 'deleteMany']);
const SINGLE_READ_BEFORE = new Set(['update', 'delete', 'upsert']);
const SENSITIVE = new Set(['passwordHash', 'tokenHash']);

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function toJson(value: unknown): any {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SENSITIVE.has(k) ? '[REDACTED]' : typeof v === 'bigint' ? v.toString() : v)),
  );
}

/**
 * Prisma client with an automatic audit trail: every create/update/delete records
 * who, when, before-value and after-value. Audit rows are written with the *same transaction client*
 * as the business change (via AsyncLocalStorage) so they roll back together.
 */
export const prisma = basePrisma.$extends({
  name: 'audit-trail',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (EXCLUDED.has(model) || !WRITE_OPS.has(operation)) return query(args);

        const ctx = getContext();
        const db: any = ctx.tx ?? basePrisma;
        let before: unknown = null;

        if (SINGLE_READ_BEFORE.has(operation) && (args as any)?.where) {
          try {
            before = await db[lcFirst(model)].findUnique({ where: (args as any).where });
          } catch {
            before = null;
          }
        }

        const result: any = await query(args);

        try {
          const isBulk = operation.endsWith('Many');
          const base = operation.replace('Many', '').toUpperCase();
          await db.auditLog.create({
            data: {
              userId: ctx.user?.id,
              userEmail: ctx.user?.email,
              userRole: ctx.user?.role,
              action: base === 'UPSERT' ? (before ? 'UPDATE' : 'CREATE') : base,
              entity: model,
              entityId: isBulk ? null : result?.id ? String(result.id) : null,
              before: toJson(isBulk ? { where: (args as any)?.where } : before),
              after: toJson(isBulk ? { data: (args as any)?.data, count: result?.count } : result),
              ip: ctx.ip,
              userAgent: ctx.userAgent,
            },
          });
        } catch (e) {
          // An audit failure must fail the business operation (GMP: no un-audited change).
          throw new Error(`Audit trail write failed: ${(e as Error).message}`);
        }
        return result;
      },
    },
  },
});

export type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Run `fn` in an interactive transaction with audit rows bound to the same transaction. */
export function transaction<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
  return prisma.$transaction(
    (tx) => mergeContext({ tx }, () => fn(tx as unknown as Tx)),
    { timeout: opts?.timeout ?? 30_000, maxWait: 10_000 },
  );
}

export const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
export { Prisma };
