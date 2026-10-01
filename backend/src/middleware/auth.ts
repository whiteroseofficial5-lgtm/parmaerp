import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { can } from '../config/permissions';
import { forbidden, unauthorized } from '../lib/errors';
import { runWithContext } from '../lib/context';

interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  name?: string;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.access_token as string | undefined);
  if (!token) return next(unauthorized());
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as unknown as JwtPayload;
    req.user = { id: p.sub, email: p.email, role: p.role, name: p.name };
    // Everything downstream (incl. the Prisma audit extension) can see who is acting.
    runWithContext({ user: req.user, ip: req.ip, userAgent: req.headers['user-agent'] }, () => next());
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

export const requirePermission =
  (...perms: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (perms.some((p) => can(req.user!.role, p))) return next();
    next(forbidden(`Requires permission: ${perms.join(' or ')}`));
  };

export const signAccessToken = (u: { id: string; email: string; role: Role; name: string }) =>
  jwt.sign({ sub: u.id, email: u.email, role: u.role, name: u.name }, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as any,
  });
