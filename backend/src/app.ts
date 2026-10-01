import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { api } from './routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  if (env.NODE_ENV !== 'test') app.use(morgan('tiny'));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true }), api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
