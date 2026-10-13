import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET', 'FRONTEND_ORIGIN'];
for (const name of required) {
  if (!String(process.env[name] || '').trim()) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.JWT_SECRET;
const allowedOrigins = new Set(
  process.env.FRONTEND_ORIGIN.split(',').map(value => value.trim()).filter(Boolean)
);
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header are typically server-to-server/health checks.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '256kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});
app.use('/api', apiLimiter);

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function auth(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const claims = jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] });
    if (!claims.sub) return res.status(401).json({ error: 'Invalid session' });

    // Read current role/status from the database so a demoted or suspended user
    // cannot keep admin privileges until an old JWT expires.
    const { data, error } = await supabase
      .from('users')
      .select('id,public_id,username,email,role,status,name')
      .eq('id', claims.sub)
      .maybeSingle();
    if (error) return res.status(503).json({ error: 'Authentication service unavailable' });
    if (!data || data.status !== 'active') {
      return res.status(401).json({ error: 'Session is no longer active' });
    }
    req.user = data;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

function admin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  return next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'tracknest-backend', time: new Date().toISOString() });
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().slice(0, 160);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password || password.length > 200) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Avoid interpolating user input into a raw PostgREST OR filter.
    let result = await supabase.from('users')
      .select('id,public_id,username,email,password_hash,role,status,name')
      .eq('username', username).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data && username.includes('@')) {
      result = await supabase.from('users')
        .select('id,public_id,username,email,password_hash,role,status,name')
        .eq('email', username.toLowerCase()).maybeSingle();
      if (result.error) throw result.error;
    }

    const user = result.data;
    const passwordMatches = user?.password_hash
      ? await bcrypt.compare(password, user.password_hash)
      : false;
    if (!user || user.status !== 'active' || !passwordMatches) {
      return res.status(401).json({ error: 'Invalid username/email or password' });
    }

    const token = jwt.sign({ sub: user.id }, secret, {
      algorithm: 'HS256',
      expiresIn: '30m',
      issuer: 'tracknest-backend',
      audience: 'tracknest-frontend'
    });
    return res.json({
      token,
      user: {
        id: user.id, publicId: user.public_id, username: user.username,
        email: user.email, role: user.role, status: user.status, name: user.name
      }
    });
  } catch {
    return res.status(500).json({ error: 'Login service temporarily unavailable' });
  }
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.get('/api/admin/users', auth, admin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80).replace(/[%,_()]/g, '');
    let query = supabase.from('users')
      .select('id,public_id,username,email,role,status,name,created_at')
      .order('created_at', { ascending: false });
    if (/^\d{5}$/.test(q)) {
      query = query.eq('public_id', q);
    } else if (q) {
      query = query.ilike('username', `%${q}%`);
    }
    const { data, error } = await query.limit(100);
    if (error) return res.status(500).json({ error: 'Unable to load users' });
    return res.json(data || []);
  } catch {
    return res.status(500).json({ error: 'Unable to load users' });
  }
});

app.post('/api/postback/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const expected = String(process.env.POSTBACK_TOKEN || '');
    if (!expected) {
      return res.status(503).json({ ok: false, error: 'Postback authentication is not configured' });
    }
    if (!safeEqual(token, expected)) {
      return res.status(401).json({ ok: false, error: 'Invalid postback token' });
    }

    const query = { ...(req.query || {}) };
    const body = { ...(req.body || {}) };
    delete query.token;
    delete body.token;
    const clickId = String(body.click_id || query.click_id || body.clickid || query.clickid || '')
      .trim().slice(0, 200);
    const payout = Number(body.payout ?? query.payout ?? 0);
    if (!clickId || !Number.isFinite(payout) || payout < 0 || payout > 1000000) {
      return res.status(400).json({ ok: false, error: 'Invalid click_id or payout' });
    }
    const payload = {
      token: '', click_id: clickId, payout,
      status: String(body.status || query.status || 'received').slice(0, 40),
      query, body
    };
    const { data, error } = await supabase.from('postbacks').insert(payload).select('id').single();
    if (error) return res.status(500).json({ ok: false, error: 'Postback could not be stored' });
    return res.json({ ok: true, postback_id: data.id });
  } catch {
    return res.status(500).json({ ok: false, error: 'Postback service temporarily unavailable' });
  }
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const status = error?.message === 'Origin not allowed' ? 403 : 500;
  return res.status(status).json({
    error: status === 403 ? 'Origin not allowed' : 'Internal server error'
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`TrackNest backend listening on port ${port}`);
});
