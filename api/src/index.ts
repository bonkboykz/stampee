import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import authRoutes from './routes/auth.js';
import profilesRoutes from './routes/profiles.js';
import campaignsRoutes from './routes/campaigns.js';
import customersRoutes from './routes/customers.js';
import issuedCardsRoutes from './routes/issuedCards.js';
import licenseKeysRoutes from './routes/licenseKeys.js';
import publicSignupRoutes from './routes/publicSignup.js';
import storageRoutes from './routes/storage.js';

const app = new Hono();

const corsOrigin = process.env.CORS_ORIGIN ?? '*';
app.use('*', logger());
app.use('*', cors({
  origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((s) => s.trim()),
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));

app.get('/', (c) => c.json({ ok: true, service: 'stampee-api' }));
app.get('/health', (c) => c.json({ ok: true }));

app.route('/auth', authRoutes);
app.route('/profiles', profilesRoutes);
app.route('/campaigns', campaignsRoutes);
app.route('/customers', customersRoutes);
app.route('/issued-cards', issuedCardsRoutes);
app.route('/license-keys', licenseKeysRoutes);
app.route('/public', publicSignupRoutes);
app.route('/storage', storageRoutes);

app.onError((err, c) => {
  console.error('[api] unhandled', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[api] listening on http://0.0.0.0:${info.port}`);
});
