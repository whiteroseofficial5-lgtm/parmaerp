import { NotificationType, Role, Severity } from '@prisma/client';
import { basePrisma } from './prisma';

interface NotifyInput {
  type: NotificationType;
  title: string;
  message: string;
  severity?: Severity;
  targetRole?: Role;
  userId?: string;
  link?: string;
  /** Same key = one notification, no matter how often a cron job re-detects the condition. */
  dedupeKey?: string;
}

export async function notify(n: NotifyInput) {
  if (n.dedupeKey) {
    const existing = await basePrisma.notification.findUnique({ where: { dedupeKey: n.dedupeKey } });
    if (existing) return existing;
  }
  try {
    return await basePrisma.notification.create({ data: { severity: 'INFO', ...n } });
  } catch (e: any) {
    if (e.code === 'P2002') return null; // raced with another worker
    throw e;
  }
}

/** Notify several roles at once. */
export const notifyRoles = (roles: Role[], n: Omit<NotifyInput, 'targetRole'>) =>
  Promise.all(roles.map((r) => notify({ ...n, targetRole: r, dedupeKey: n.dedupeKey ? `${n.dedupeKey}:${r}` : undefined })));
