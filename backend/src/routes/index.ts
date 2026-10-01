import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authRouter, usersRouter } from './auth';
import { binsRouter, materialsRouter, productsRouter, racksRouter, scanRouter, shiftsRouter, specsRouter, suppliersRouter, warehousesRouter } from './masters';
import { fgRouter, inventoryRouter } from './inventory';
import { batchesRouter, bomRouter, formulasRouter, productionRouter, publicTraceRouter } from './manufacturing';
import { purchaseRouter } from './purchasing';
import { expiryRouter, qcRouter } from './quality';
import { aiRouter, analyticsRouter, auditRouter, companyRouter, dashboardRouter, documentsRouter, notificationsRouter, publicShareRouter, reportsRouter } from './platform';

export const api = Router();

// Public
api.use('/auth', authRouter);
api.use('/public', publicTraceRouter);
api.use('/public', publicShareRouter);
api.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date() }));

// Authenticated (each router enforces its own RBAC permissions)
api.use('/users', usersRouter);
api.use(authenticate);
api.use('/dashboard', dashboardRouter);
api.use('/raw-materials', materialsRouter);
api.use('/suppliers', suppliersRouter);
api.use('/products', productsRouter);
api.use('/warehouses', warehousesRouter);
api.use('/racks', racksRouter);
api.use('/bins', binsRouter);
api.use('/qc/specifications', specsRouter);
api.use('/shifts', shiftsRouter);
api.use('/scan', scanRouter);
api.use('/inventory', inventoryRouter);
api.use('/finished-goods', fgRouter);
api.use('/formulas', formulasRouter);
api.use('/bom', bomRouter);
api.use('/batches', batchesRouter);
api.use('/production', productionRouter);
api.use('/purchase', purchaseRouter);
api.use('/qc', qcRouter);
api.use('/expiry', expiryRouter);
api.use('/reports', reportsRouter);
api.use('/audit', auditRouter);
api.use('/notifications', notificationsRouter);
api.use('/analytics', analyticsRouter);
api.use('/company', companyRouter);
api.use('/ai', aiRouter);
api.use('/documents', documentsRouter);
