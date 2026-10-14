import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('staging API mounts the existing authenticated feature handlers', async () => {
  const source = await readFile(new URL('../backend/staging-server.js', import.meta.url), 'utf8');
  for (const route of ['/api/auth','/api/users','/api/offers','/api/wallet','/api/chat','/api/stats','/api/notifications','/api/payments','/api/support','/api/security']) {
    assert.ok(source.includes(route), \`missing staging route \${route}\`);
  }
  assert.match(source, /FRONTEND_ORIGIN/);
  assert.match(source, /express-rate-limit|rateLimit/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
});
