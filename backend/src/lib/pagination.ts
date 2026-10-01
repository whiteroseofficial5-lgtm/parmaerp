import { Request } from 'express';

export function pageParams(req: Request, defaultSize = 25) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, q: String(req.query.q ?? '').trim() };
}

export const paged = <T>(data: T[], total: number, page: number, pageSize: number) => ({
  data,
  meta: { total, page, pageSize, pages: Math.ceil(total / pageSize) },
});
