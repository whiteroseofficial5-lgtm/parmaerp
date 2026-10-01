import { Router } from 'express';
import { ZodTypeAny } from 'zod';
import { ah } from '../lib/asyncHandler';
import { notFound } from '../lib/errors';
import { pageParams, paged } from '../lib/pagination';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';

interface CrudOpts {
  model: string;
  perm: string; // resource prefix for reads, e.g. "supplier"
  writePerm?: string; // resource prefix for create/update/delete (defaults to perm)
  create: ZodTypeAny;
  update?: ZodTypeAny;
  search: string[];
  include?: object;
  orderBy?: object;
  filters?: string[]; // whitelisted equality filters from query string
  softDelete?: { field: string; value: any };
}

/** Small, RBAC-guarded, paginated CRUD router for simple master data. */
export function crud(o: CrudOpts) {
  const r = Router();
  const db = () => (prisma as any)[o.model];

  r.get('/', requirePermission(`${o.perm}:read`), ah(async (req, res) => {
    const { skip, take, page, pageSize, q } = pageParams(req);
    const where: any = {};
    if (q) where.OR = o.search.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } }));
    for (const f of o.filters ?? []) if (req.query[f] !== undefined && req.query[f] !== '') where[f] = req.query[f] === 'true' ? true : req.query[f] === 'false' ? false : req.query[f];
    const [rows, total] = await Promise.all([db().findMany({ where, skip, take, include: o.include, orderBy: o.orderBy ?? { createdAt: 'desc' } }), db().count({ where })]);
    res.json(paged(rows, total, page, pageSize));
  }));

  r.get('/:id', requirePermission(`${o.perm}:read`), ah(async (req, res) => {
    const row = await db().findUnique({ where: { id: req.params.id }, include: o.include });
    if (!row) throw notFound();
    res.json(row);
  }));

  r.post('/', requirePermission(`${o.writePerm ?? o.perm}:create`), ah(async (req, res) => {
    res.status(201).json(await db().create({ data: o.create.parse(req.body), include: o.include }));
  }));

  r.patch('/:id', requirePermission(`${o.writePerm ?? o.perm}:update`), ah(async (req, res) => {
    res.json(await db().update({ where: { id: req.params.id }, data: (o.update ?? (o.create as any).partial()).parse(req.body), include: o.include }));
  }));

  r.delete('/:id', requirePermission(`${o.writePerm ?? o.perm}:delete`), ah(async (req, res) => {
    if (o.softDelete) await db().update({ where: { id: req.params.id }, data: { [o.softDelete.field]: o.softDelete.value } });
    else await db().delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }));
  return r;
}
