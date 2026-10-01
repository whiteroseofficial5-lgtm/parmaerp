import { Role } from '@prisma/client';

/**
 * Permission format: `<resource>:<action>`.
 * Segregation of duties is deliberate: whoever creates a formula/batch cannot be the one who approves/releases it
 * (except SUPER_ADMIN, which should be a break-glass account in production).
 */
export type Permission = string;

const read = (...r: string[]) => r.map((x) => `${x}:read`);
const all = (...r: string[]) => r.flatMap((x) => ['read', 'create', 'update', 'delete'].map((a) => `${x}:${a}`));

const ALL_READ = read(
  'dashboard', 'material', 'stock', 'formula', 'bom', 'batch', 'production', 'fg', 'expiry', 'supplier',
  'purchase', 'qc', 'warehouse', 'report', 'document', 'analytics', 'notification', 'ai', 'audit',
);

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ['*'],

  PRODUCTION_MANAGER: [
    ...read('dashboard', 'material', 'stock', 'bom', 'fg', 'expiry', 'qc', 'warehouse', 'report', 'analytics', 'notification', 'supplier'),
    ...all('production'),
    'formula:read', 'formula:create', 'formula:update', 'formula:submit',
    'batch:read', 'batch:create', 'batch:update', 'batch:approve', 'batch:start', 'batch:complete',
    'document:read', 'document:create', 'ai:read', 'ai:bmr', 'ai:search',
    'report:export',
  ],

  WAREHOUSE_MANAGER: [
    ...read('dashboard', 'formula', 'bom', 'batch', 'production', 'qc', 'report', 'analytics', 'notification', 'supplier', 'purchase'),
    ...all('material'), ...all('stock'), ...all('warehouse'), ...all('fg'), ...all('expiry'),
    'stock:adjust', 'stock:transfer', 'stock:dispatch', 'expiry:recall', 'purchase:grn',
    'document:read', 'document:create', 'ai:read', 'ai:search',
    'report:export',
  ],

  QC_MANAGER: [
    ...read('dashboard', 'material', 'stock', 'bom', 'production', 'fg', 'expiry', 'warehouse', 'report', 'analytics', 'notification', 'supplier', 'purchase'),
    ...all('qc'),
    'formula:read', 'formula:approve',
    'batch:read', 'batch:release', 'batch:reject',
    'stock:approve-lot', 'expiry:recall',
    'document:read', 'document:create', 'ai:read', 'ai:validate', 'ai:search',
    'report:export',
  ],

  PURCHASE_MANAGER: [
    ...read('dashboard', 'material', 'stock', 'formula', 'bom', 'expiry', 'warehouse', 'report', 'analytics', 'notification', 'qc'),
    ...all('supplier'), ...all('purchase'),
    'purchase:approve', 'purchase:grn', 'material:create', 'material:update',
    'document:read', 'document:create', 'ai:read', 'ai:invoice', 'ai:search',
    'report:export',
  ],

  STORE_OPERATOR: [
    ...read('dashboard', 'material', 'stock', 'warehouse', 'fg', 'expiry', 'notification', 'purchase', 'production', 'batch'),
    'stock:create', 'stock:transfer', 'purchase:grn',
    'document:read', 'ai:search',
  ],

  AUDITOR: [...ALL_READ, 'report:export', 'audit:export', 'user:read'],
};

export function can(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes('*') || perms.includes(permission);
}
