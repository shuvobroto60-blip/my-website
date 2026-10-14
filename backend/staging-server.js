import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authHandler from '../api/auth.js';
import usersHandler from '../api/users.js';
import offersHandler from '../api/offers.js';
import walletHandler from '../api/wallet.js';
import chatHandler from '../api/chat.js';
import statsHandler from '../api/stats.js';
import notificationsHandler from '../api/notifications.js';
import paymentsHandler from '../api/payments.js';
import supportHandler from '../api/support.js';
import securityHandler from '../api/security.js';
import postbackHandler from '../api/postback.js';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FRONTEND_ORIGIN'];
for (const name of required) {
  if (!String(process.env[name] || '').trim()) {
    throw new Error(\`Missing required server environment variable: \${name}\`);
  }
}
const allowedOrigins = new Set(String(process.env.FRONTEND_ORIGIN).split(',').map(x => x.trim()).filter(Boolean));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, limit: 300,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { ok: false, message: 'Too many requests. Please try again later.' }
}));
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { ok: false, message: 'Too many authentication attempts. Please try again later.' }
}));

app.get('/api/health', (_req, res) => res.status(200).json({
  ok: true, service: 'tracknest-staging-api', time: new Date().toISOString()
}));

function adapt(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (error) { next(error); }
  };
}
for (const [path, handler] of [
  ['/api/auth', authHandler],
  ['/api/users', usersHandler],
  ['/api/offers', offersHandler],
  ['/api/wallet', walletHandler],
  ['/api/chat', chatHandler],
  ['/api/stats', statsHandler],
  ['/api/notifications', notificationsHandler],
  ['/api/payments', paymentsHandler],
  ['/api/support', supportHandler],
  ['/api/security', securityHandler],
  ['/api/postback', postbackHandler]
]) app.all(path, adapt(handler));

app.all('/api/postback/:token', (req, res, next) => {
  req.query = { ...req.query, token: req.params.token };
  return adapt(postbackHandler)(req, res, next);
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const denied = error?.message === 'Origin not allowed';
  return res.status(denied ? 403 : 500).json({
    ok: false,
    message: denied ? 'Origin not allowed' : 'Request could not be completed'
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log('TrackNest staging API listening on port ' + port));
