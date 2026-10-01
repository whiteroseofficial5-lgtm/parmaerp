import { Tx } from './prisma';

/** Race-safe document numbers: PREFIX-YYYY-00001 (atomic upsert-increment). */
export async function nextNumber(tx: Tx, prefix: string, pad = 5): Promise<string> {
  const year = new Date().getFullYear();
  const name = `${prefix}-${year}`;
  const row = await (tx as any).sequence.upsert({
    where: { name },
    create: { name, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${year}-${String(row.value).padStart(pad, '0')}`;
}
