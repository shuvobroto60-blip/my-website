import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');

test('staging API fails closed when required secrets are missing or weak', () => {
  assert.match(source, /const required = \['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET', 'FRONTEND_ORIGIN'\]/);
  assert.match(source, /JWT_SECRET\.length < 32/);
  assert.match(source, /Missing required server environment variable/);
});

test('CORS uses an explicit origin allowlist instead of wildcard credentials', () => {
  assert.match(source, /const allowedOrigins = new Set/);
  assert.match(source, /allowedOrigins\.has\(origin\)/);
  assert.doesNotMatch(source, /origin:\s*process\.env\.FRONTEND_ORIGIN\?\.split\(', '\)\s*\|\|\s*'\*'/);
  assert.doesNotMatch(source, /origin:\s*'\*'/);
});

test('API and login routes have rate limits', () => {
  assert.match(source, /const apiLimiter = rateLimit/);
  assert.match(source, /const loginLimiter = rateLimit/);
  assert.match(source, /app\.use\('\/api', apiLimiter\)/);
  assert.match(source, /app\.post\('\/api\/auth\/login', loginLimiter/);
});

test('JWT auth rechecks current database status and role', () => {
  assert.match(source, /jwt\.verify\(header\.slice\(7\), secret, \{ algorithms: \['HS256'\] \}\)/);
  assert.match(source, /\.select\('id,public_id,username,email,role,status,name'\)/);
  assert.match(source, /data\.status !== 'active'/);
  assert.match(source, /req\.user = data/);
  assert.match(source, /expiresIn: '30m'/);
});

test('login does not interpolate user input into raw PostgREST OR filters', () => {
  assert.match(source, /\.eq\('username', username\)/);
  assert.match(source, /\.eq\('email', username\.toLowerCase\(\)\)/);
  assert.doesNotMatch(source, /\.or\(\`username\.eq\.\$\{username\}/);
});

test('API errors do not return raw database exception messages', () => {
  assert.doesNotMatch(source, /res\.status\(500\)\.json\(\{\s*error:\s*e\.message/);
  assert.doesNotMatch(source, /res\.status\(500\)\.json\(\{\s*error:\s*error\.message/);
  assert.match(source, /Internal server error/);
});
