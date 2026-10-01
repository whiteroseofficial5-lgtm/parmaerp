import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { ROLE_PERMISSIONS } from '../config/permissions';
import { ah } from '../lib/asyncHandler';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { basePrisma, prisma } from '../lib/prisma';
import { pageParams, paged } from '../lib/pagination';
import { authenticate, requirePermission, signAccessToken } from '../middleware/auth';

export const authRouter = Router();
export const usersRouter = Router();

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const Role = z.enum(['SUPER_ADMIN', 'PRODUCTION_MANAGER', 'WAREHOUSE_MANAGER', 'QC_MANAGER', 'PURCHASE_MANAGER', 'STORE_OPERATOR', 'AUDITOR']);

async function issueTokens(u: { id: string; email: string; role: any; name: string }) {
  const refresh = crypto.randomBytes(48).toString('hex');
  await basePrisma.refreshToken.create({ data: { userId: u.id, tokenHash: sha(refresh), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000) } });
  return { accessToken: signAccessToken(u), refreshToken: refresh };
}
const publicUser = (u: any) => ({ id: u.id, email: u.email, name: u.name, role: u.role, permissions: ROLE_PERMISSIONS[u.role as keyof typeof ROLE_PERMISSIONS] });

authRouter.post('/login', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true }), ah(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const u = await basePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = u && u.isActive && (await bcrypt.compare(password, u.passwordHash));
  await basePrisma.auditLog.create({ data: { userId: u?.id, userEmail: email, userRole: u?.role, action: ok ? 'LOGIN' : 'LOGIN_FAILED', entity: 'User', entityId: u?.id, ip: req.ip, userAgent: req.headers['user-agent'] } });
  if (!ok || !u) throw unauthorized('Invalid email or password');
  await basePrisma.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  res.json({ ...(await issueTokens(u)), user: publicUser(u) });
}));

authRouter.post('/refresh', ah(async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
  const t = await basePrisma.refreshToken.findUnique({ where: { tokenHash: sha(refreshToken) }, include: { user: true } });
  if (!t || t.revokedAt || t.expiresAt < new Date() || !t.user.isActive) throw unauthorized('Session expired');
  await basePrisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } }); // rotation
  res.json({ ...(await issueTokens(t.user)), user: publicUser(t.user) });
}));

authRouter.post('/logout', ah(async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
  await basePrisma.refreshToken.updateMany({ where: { tokenHash: sha(refreshToken) }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

authRouter.get('/me', authenticate, ah(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!u) throw unauthorized();
  res.json(publicUser(u));
}));

authRouter.post('/change-password', authenticate, ah(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string().min(10).regex(/[A-Z]/).regex(/[0-9]/) }).parse(req.body);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(currentPassword, u.passwordHash))) throw badRequest('Current password is incorrect');
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
  await basePrisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

// ───────── Users (Super Admin) ─────────
usersRouter.use(authenticate);
const strip = ({ passwordHash, ...u }: any) => u;

// Lightweight picker list (id/name/role) for operator assignment etc. — any authenticated user.
usersRouter.get('/lookup', ah(async (_req, res) => res.json(await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }))));

usersRouter.get('/', requirePermission('user:read'), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where = q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] } : {};
  const [rows, total] = await Promise.all([prisma.user.findMany({ where, skip, take, orderBy: { name: 'asc' } }), prisma.user.count({ where })]);
  res.json(paged(rows.map(strip), total, page, pageSize));
}));

usersRouter.post('/', requirePermission('user:create'), ah(async (req, res) => {
  const b = z.object({ email: z.string().email(), name: z.string().min(2), role: Role, password: z.string().min(10), employeeCode: z.string().optional() }).parse(req.body);
  const u = await prisma.user.create({ data: { email: b.email.toLowerCase(), name: b.name, role: b.role, employeeCode: b.employeeCode, passwordHash: await bcrypt.hash(b.password, 12) } });
  res.status(201).json(strip(u));
}));

usersRouter.patch('/:id', requirePermission('user:update'), ah(async (req, res) => {
  const b = z.object({ name: z.string().min(2).optional(), role: Role.optional(), isActive: z.boolean().optional(), password: z.string().min(10).optional() }).parse(req.body);
  if (req.params.id === req.user!.id && (b.isActive === false || (b.role && b.role !== 'SUPER_ADMIN'))) throw badRequest('You cannot demote or deactivate your own account');
  const { password, ...rest } = b;
  const u = await prisma.user.update({ where: { id: req.params.id }, data: { ...rest, ...(password && { passwordHash: await bcrypt.hash(password, 12) }) } });
  if (b.isActive === false) await basePrisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } });
  res.json(strip(u));
}));

usersRouter.get('/roles/matrix', requirePermission('user:read'), (_req, res) => res.json(ROLE_PERMISSIONS));

