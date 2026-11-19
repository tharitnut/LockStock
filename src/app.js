import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import config from './config.js';
import authRoutes from './routes/auth.js';
import productsRoutes from './routes/products.js';
import ordersRoutes from './routes/orders.js';
import reportsRoutes from './routes/reports.js';
import demoRoutes from './routes/demo.js';
import { errorHandler } from './middleware/error.js';
import { notFound } from './lib/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '../public');

const app = express();

app.use(helmet());
app.use(cors({
  origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins,
}));
app.use(express.json({ limit: '100kb' }));

// Health check endpoint (public)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/auth', authRoutes);
app.use('/products', productsRoutes);
app.use('/orders', ordersRoutes);
app.use('/reports', reportsRoutes);

// Optional Demo Visualizer (Mounted ONLY when DEMO_ENABLED=true)
app.use('/demo', (req, res, next) => {
  if (!config.demoEnabled) {
    return next(notFound(`Route ${req.method} ${req.originalUrl} not found`));
  }
  next();
});
app.use('/demo', (req, res, next) => {
  if (config.demoEnabled) {
    return express.static(publicDir)(req, res, next);
  }
  next();
});
app.use('/demo', (req, res, next) => {
  if (config.demoEnabled) {
    return demoRoutes(req, res, next);
  }
  next();
});

// 404 Handler for undefined routes
app.use((req, res, next) => {
  next(notFound(`Route ${req.method} ${req.originalUrl} not found`));
});

// Centralized error handler
app.use(errorHandler);

export default app;
