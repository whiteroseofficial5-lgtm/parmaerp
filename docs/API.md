# API reference

_Generated from `backend/src/routes/*.ts` by scanning route registrations — regenerate after changing routes._

All endpoints are under `/api`, return JSON (except file/PDF/PNG downloads) and require `Authorization: Bearer <accessToken>` unless marked **public**. The permission shown is enforced server-side (`requirePermission`); `SUPER_ADMIN` holds every permission. Lists are paginated with `?page=&pageSize=&q=` and return `{ data, meta:{ total, page, pageSize, pages } }`.

Errors: `400` validation (zod details), `401` unauthenticated, `403` missing permission / segregation-of-duties, `404`, `409` business-rule conflict (e.g. insufficient stock, invalid state transition, duplicate invoice).


## `/api/auth`

| Method | Path | Permission |
|---|---|---|
| POST | `/api/auth/login` |  **public** |
| POST | `/api/auth/refresh` |  **public** |
| POST | `/api/auth/logout` |  **public** |
| GET | `/api/auth/me` | authenticated |
| POST | `/api/auth/change-password` | authenticated |

## `/api/users`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/users/lookup` | authenticated |
| GET | `/api/users` | `user:read` |
| POST | `/api/users` | `user:create` |
| PATCH | `/api/users/:id` | `user:update` |
| GET | `/api/users/roles/matrix` | `user:read` |

## `/api/inventory`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/inventory/lots` | `stock:read` |
| POST | `/api/inventory/receive` | `stock:create` |
| POST | `/api/inventory/issue` | `stock:create` |
| POST | `/api/inventory/transfer` | `stock:transfer` |
| POST | `/api/inventory/adjust` | `stock:adjust` |
| POST | `/api/inventory/lots/:id/status` | `stock:approve-lot` |
| GET | `/api/inventory/lots/:id/ledger` | `stock:read` |
| GET | `/api/inventory/lots/:id/where-used` | `batch:read` |
| GET | `/api/inventory/ledger` | `stock:read` |
| GET | `/api/inventory/transfer-orders` | `warehouse:read` |
| POST | `/api/inventory/transfer-orders` | `warehouse:create` |
| POST | `/api/inventory/transfer-orders/:id/execute` | `stock:transfer` |
| GET | `/api/inventory/counts` | `warehouse:read` |
| GET | `/api/inventory/counts/:id` | `warehouse:read` |
| POST | `/api/inventory/counts` | `warehouse:create` |
| PATCH | `/api/inventory/counts/:id/items` | `warehouse:update` |
| POST | `/api/inventory/counts/:id/reconcile` | `stock:adjust` |

## `/api/finished-goods`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/finished-goods` | `fg:read` |
| GET | `/api/finished-goods/:id/ledger` | `fg:read` |
| POST | `/api/finished-goods/:id/reserve` | `fg:update` |
| POST | `/api/finished-goods/:id/move` | `fg:update` |
| GET | `/api/finished-goods/dispatches/all` | `fg:read` |
| POST | `/api/finished-goods/dispatch` | `stock:dispatch` |

## `/api/formulas`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/formulas` | `formula:read` |
| GET | `/api/formulas/diff` | `formula:read` |
| GET | `/api/formulas/:id` | `formula:read` |
| GET | `/api/formulas/:id/cost` | `formula:read` |
| POST | `/api/formulas` | `formula:create` |
| PATCH | `/api/formulas/:id` | `formula:update` |
| POST | `/api/formulas/:id/new-version` | `formula:create` |
| POST | `/api/formulas/:id/submit` | `formula:submit` |
| POST | `/api/formulas/:id/approve` | `formula:approve` |
| POST | `/api/formulas/:id/reject` | `formula:approve` |

## `/api/bom`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/bom/:productId` | `bom:read` |

## `/api/batches`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/batches` | `batch:read` |
| GET | `/api/batches/:id` | `batch:read` |
| POST | `/api/batches` | `batch:create` |
| POST | `/api/batches/:id/approve` | `batch:approve` |
| POST | `/api/batches/:id/start` | `batch:start` |
| POST | `/api/batches/:id/complete` | `batch:complete` |
| POST | `/api/batches/:id/release` | `batch:release` |
| POST | `/api/batches/:id/reject` | `batch:reject` |
| POST | `/api/batches/:id/cancel` | `batch:update` |
| GET | `/api/batches/:id/qr` | `batch:read` |
| GET | `/api/batches/:id/pdf/:kind` | `batch:read` |
| GET | `/api/batches/:id/validate` | `batch:read` |

## `/api/public`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/public/trace/:batchNumber` |  **public** |
| GET | `/api/public/share/:token` |  **public** |

## `/api/production`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/production/work-orders` | `production:read` |
| POST | `/api/production/work-orders` | `production:create` |
| PATCH | `/api/production/work-orders/:id` | `production:update` |
| POST | `/api/production/work-orders/:id/operators` | `production:update` |
| POST | `/api/production/work-orders/:id/create-batch` | `batch:create` |
| GET | `/api/production/schedule` | `production:read` |
| GET | `/api/production/plans` | `production:read` |
| POST | `/api/production/plans` | `production:create` |

## `/api/raw-materials`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/raw-materials` | `material:read` |
| GET | `/api/raw-materials/:id` | `material:read` |
| POST | `/api/raw-materials` | `material:create` |
| PATCH | `/api/raw-materials/:id` | `material:update` |
| DELETE | `/api/raw-materials/:id` | `material:delete` |

## `/api/suppliers`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/suppliers/:id/performance` | `supplier:read` |
| GET | `/api/suppliers` | `supplier:read` |
| GET | `/api/suppliers/:id` | `supplier:read` |
| POST | `/api/suppliers` | `supplier:create` |
| PATCH | `/api/suppliers/:id` | `supplier:update` |
| DELETE | `/api/suppliers/:id` | `supplier:delete` |

## `/api/scan`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/scan/resolve` | `stock:read` |
| GET | `/api/scan/label` | `stock:read` |

## `/api/products`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/products` | `bom:read` |
| GET | `/api/products/:id` | `bom:read` |
| POST | `/api/products` | `production:create` |
| PATCH | `/api/products/:id` | `production:update` |
| DELETE | `/api/products/:id` | `production:delete` |

## `/api/warehouses`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/warehouses` | `warehouse:read` |
| GET | `/api/warehouses/:id` | `warehouse:read` |
| POST | `/api/warehouses` | `warehouse:create` |
| PATCH | `/api/warehouses/:id` | `warehouse:update` |
| DELETE | `/api/warehouses/:id` | `warehouse:delete` |

## `/api/racks`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/racks` | `warehouse:read` |
| GET | `/api/racks/:id` | `warehouse:read` |
| POST | `/api/racks` | `warehouse:create` |
| PATCH | `/api/racks/:id` | `warehouse:update` |
| DELETE | `/api/racks/:id` | `warehouse:delete` |

## `/api/bins`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/bins` | `warehouse:read` |
| GET | `/api/bins/:id` | `warehouse:read` |
| POST | `/api/bins` | `warehouse:create` |
| PATCH | `/api/bins/:id` | `warehouse:update` |
| DELETE | `/api/bins/:id` | `warehouse:delete` |

## `/api/qc/specifications`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/qc/specifications` | `qc:read` |
| GET | `/api/qc/specifications/:id` | `qc:read` |
| POST | `/api/qc/specifications` | `qc:create` |
| PATCH | `/api/qc/specifications/:id` | `qc:update` |
| DELETE | `/api/qc/specifications/:id` | `qc:delete` |

## `/api/shifts`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/shifts` | `production:read` |
| GET | `/api/shifts/:id` | `production:read` |
| POST | `/api/shifts` | `production:create` |
| PATCH | `/api/shifts/:id` | `production:update` |
| DELETE | `/api/shifts/:id` | `production:delete` |

## `/api/dashboard`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/dashboard` | `dashboard:read` |

## `/api/analytics`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/analytics` | authenticated |
| GET | `/api/analytics/materials` | authenticated |
| GET | `/api/analytics/production-needs` | authenticated |
| GET | `/api/analytics/expiry-risk` | authenticated |
| GET | `/api/analytics/suppliers` | authenticated |

## `/api/reports`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/reports` | `report:read` |
| GET | `/api/reports/:name` | `report:read` |

## `/api/audit`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/audit` | `audit:read` |
| GET | `/api/audit/entities` | `audit:read` |

## `/api/notifications`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/notifications` | `notification:read` |
| GET | `/api/notifications/count` | `notification:read` |
| POST | `/api/notifications/:id/read` | `notification:read` |
| POST | `/api/notifications/read-all` | `notification:read` |

## `/api/company`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/company` | authenticated |
| PUT | `/api/company` | `user:update` |
| POST | `/api/company/logo` | `user:update` |

## `/api/ai`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/ai/status` | `ai:read` |
| POST | `/api/ai/bmr/upload` | `ai:bmr` |
| POST | `/api/ai/invoice/upload` | `ai:invoice` |
| GET | `/api/ai/jobs` | `ai:read` |
| GET | `/api/ai/jobs/:id` | `ai:read` |
| GET | `/api/ai/jobs/:id/file` | `ai:read` |
| PUT | `/api/ai/jobs/:id/corrections` | `ai:read` |
| POST | `/api/ai/jobs/:id/reprocess` | `ai:read` |
| POST | `/api/ai/jobs/:id/reject` | `ai:read` |
| POST | `/api/ai/jobs/:id/commit` | `ai:read` |
| POST | `/api/ai/validate` | `ai:validate` |
| POST | `/api/ai/search` | `ai:search` |

## `/api/documents`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/documents` | `document:read` |
| POST | `/api/documents` | `document:create` |
| GET | `/api/documents/:id` | `document:read` |
| GET | `/api/documents/:id/download` | `document:read` |
| POST | `/api/documents/:id/versions` | `document:create` |
| PATCH | `/api/documents/:id` | `document:create` |
| POST | `/api/documents/:id/share` | `document:create` |
| DELETE | `/api/documents/:id` | `document:delete` |

## `/api/purchase`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/purchase/requisitions` | `purchase:read` |
| POST | `/api/purchase/requisitions` | `purchase:create` |
| POST | `/api/purchase/requisitions/:id/decision` | `purchase:approve` |
| POST | `/api/purchase/requisitions/auto` | `purchase:create` |
| GET | `/api/purchase/orders` | `purchase:read` |
| GET | `/api/purchase/orders/:id` | `purchase:read` |
| POST | `/api/purchase/orders` | `purchase:create` |
| POST | `/api/purchase/orders/:id/approve` | `purchase:approve` |
| POST | `/api/purchase/orders/:id/cancel` | `purchase:update` |
| GET | `/api/purchase/orders/:id/pdf` | `purchase:read` |
| GET | `/api/purchase/grn` | `purchase:read` |
| GET | `/api/purchase/grn/:id` | `purchase:read` |
| POST | `/api/purchase/grn` | `purchase:grn` |
| GET | `/api/purchase/grn/:id/pdf` | `purchase:read` |
| GET | `/api/purchase/invoices` | `purchase:read` |
| GET | `/api/purchase/invoices/:id` | `purchase:read` |
| POST | `/api/purchase/invoices/match` | `purchase:read` |
| POST | `/api/purchase/invoices` | `purchase:create` |
| POST | `/api/purchase/invoices/:id/approve` | `purchase:approve` |
| POST | `/api/purchase/invoices/:id/reject` | `purchase:approve` |

## `/api/qc`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/qc/samples` | `qc:read` |
| GET | `/api/qc/samples/:id` | `qc:read` |
| GET | `/api/qc/samples/:id/specs` | `qc:read` |
| POST | `/api/qc/samples` | `qc:create` |
| PUT | `/api/qc/samples/:id/results` | `qc:update` |
| POST | `/api/qc/samples/:id/finalise` | `qc:update` |
| GET | `/api/qc/samples/:id/report` | `qc:read` |

## `/api/expiry`

| Method | Path | Permission |
|---|---|---|
| GET | `/api/expiry` | `expiry:read` |
| POST | `/api/expiry/sweep` | `expiry:update` |
| POST | `/api/expiry/write-off/:lotId` | `expiry:update` |
| GET | `/api/expiry/recalls` | `expiry:read` |
| POST | `/api/expiry/recalls` | `expiry:recall` |
| POST | `/api/expiry/recalls/:id/close` | `expiry:recall` |
