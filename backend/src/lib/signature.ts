import crypto from 'node:crypto';
import { Tx } from './prisma';

/** Electronic signature: binds user + meaning + record + timestamp with a tamper-evident hash. */
export async function sign(tx: Tx, userId: string, entity: string, entityId: string, meaning: string) {
  const ts = new Date().toISOString();
  const hash = crypto.createHash('sha256').update(`${userId}|${entity}|${entityId}|${meaning}|${ts}`).digest('hex');
  return tx.signature.create({ data: { userId, entity, entityId, meaning, hash } });
}
