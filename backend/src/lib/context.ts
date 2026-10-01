import { AsyncLocalStorage } from 'node:async_hooks';
import { Role } from '@prisma/client';

export interface RequestContext {
  user?: { id: string; email: string; role: Role };
  ip?: string;
  userAgent?: string;
  /** Active interactive-transaction client so audit rows commit/rollback with the business change. */
  tx?: any;
}

const als = new AsyncLocalStorage<RequestContext>();

export const getContext = (): RequestContext => als.getStore() ?? {};
export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => als.run(ctx, fn);
export const mergeContext = <T>(patch: Partial<RequestContext>, fn: () => T): T =>
  als.run({ ...getContext(), ...patch }, fn);
