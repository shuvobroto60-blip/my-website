import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('all server-side JavaScript parses', async () => {
  const files = [...await filesUnder('api'), ...await filesUnder('backend')];
  files.push('backend/server.js');
  for (const file of new Set(files)) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${file} failed syntax check:\n${result.stderr}`);
  }
});

test('inline JavaScript in both frontend entrypoints parses', async () => {
  for (const file of ['index.html', 'public/index.html']) {
    const html = await readFile(path.join(root, file), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(([, attrs, code]) => !/\bsrc\s*=/.test(attrs) && code.trim());
    assert.ok(scripts.length > 0, file + ' should contain application scripts');
    for (const [index, match] of scripts.entries()) {
      const result = spawnSync(process.execPath, ['--check'], { input: match[2], encoding: 'utf8' });
      assert.equal(result.status, 0, file + ' inline script ' + index + ' failed syntax check:\n' + result.stderr);
    }
  }
});

test('both entrypoints require server auth and support a configurable staging API origin', async () => {
  for (const file of ['index.html', 'public/index.html']) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.match(source, /API_BASE_URL/);
    assert.match(source, /action:'login'/);
    assert.match(source, /action:'signup'/);
    assert.match(source, /action:'logout'/);
    assert.match(source, /restoreServerSession\(\)/);
    assert.match(source, /if\(!state\.session\)[\s\S]*renderAuthScreen\(\)/);
    assert.doesNotMatch(source, /Auth is intentionally deferred/);
    assert.doesNotMatch(source, /Full demo mode: skip login\/signup/);
  }
});
test('dashboard, offers, wallet, chat, and support mutations call authenticated APIs', async () => {
  for (const file of ['index.html', 'public/index.html']) {
    const source = await readFile(path.join(root, file), 'utf8');
    for (const marker of [
      "apiCall('/api/offers',{action:'create'",
      "apiCall('/api/offers',{action:'join'",
      "apiCall('/api/wallet',{action:'withdraw'",
      "apiCall('/api/wallet',{action:'cancel'",
      "apiCall('/api/wallet',{action:'update'",
      "apiCall('/api/chat',{kind:'global'",
      "apiCall('/api/support',{action:'create'"
    ]) assert.ok(source.includes(marker), file + ' missing server action ' + marker);
    assert.ok(source.includes('@media (max-width:767px)') || source.includes('@media(max-width:767px)'), file + ' missing mobile breakpoint');
  }
});

test('tracking links are signed server-side and clicks are recorded only on redirect', async () => {
  const api = await readFile(path.join(root, 'api/clicks.js'), 'utf8');
  const redirect = await readFile(path.join(root, 'backend/click-redirect.js'), 'utf8');
  for (const file of ['index.html', 'public/index.html']) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.ok(source.includes("apiCall('/api/clicks',{action:'create'"), file + ' must request a signed tracking link');
    assert.ok(source.includes('A click is recorded when the link opens'), file + ' must explain click semantics');
  }
  assert.ok(api.includes("createHmac('sha256'"));
  assert.ok(api.includes('offer_memberships'));
  assert.ok(redirect.includes('timingSafeEqual'));
  assert.ok(redirect.includes("db('clicks'"));
  assert.ok(redirect.includes("target.searchParams.set('click_id', clickId)"));
});

test('owner-only withdrawal cancellation migration is atomic and service-role only', async () => {
  const migration = await readFile(path.join(root, 'supabase/migrations/20261014_tracknest_user_withdrawal_cancel.sql'), 'utf8');
  const api = await readFile(path.join(root, 'api/wallet.js'), 'utf8');
  assert.ok(migration.includes('create or replace function public.cancel_manual_withdrawal'));
  assert.ok(migration.includes('wd.user_id <> p_user_id'));
  assert.ok(migration.includes("wd.status <> 'pending'"));
  assert.ok(migration.includes('for update'));
  assert.ok(migration.includes('revoke all on function public.cancel_manual_withdrawal'));
  assert.ok(migration.includes('grant execute on function public.cancel_manual_withdrawal'));
  assert.ok(api.includes('rpc/cancel_manual_withdrawal'));
});

test('postback endpoint authenticates and never stores the supplied token', async () => {
  const source = await readFile(path.join(root, 'api/postback.js'), 'utf8');
  assert.match(source, /POSTBACK_TOKEN/);
  assert.match(source, /safeEqual\(input\.token,expected\)/);
  assert.match(source, /delete safeInput\.token/);
  assert.match(source, /raw_data:safeInput/);
  assert.match(source, /payout>1000000/);
});

test('wallet credit migration is idempotent and service-role only', async () => {
  const source = await readFile(path.join(root, 'supabase/migrations/20261013_tracknest_compatibility.sql'), 'utf8');
  assert.match(source, /information_schema\.columns/);
  assert.match(source, /create table if not exists public\.wallet_credit_ledger/);
  assert.match(source, /add column if not exists balance_after numeric\(14,2\) not null default 0/);
  assert.match(source, /insert into public\.wallet_transactions/);
  assert.match(source, /on conflict \(click_id\) do nothing/);
  assert.match(source, /create or replace function public\.process_wallet_credit/);
  assert.match(source, /revoke all on function public\.process_wallet_credit[\s\S]*from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.process_wallet_credit[\s\S]*to service_role/);
});

test('the live-mode checklist keeps the production cutover explicit', async () => {
  const source = await readFile(path.join(root, 'DEMO_MODE.md'), 'utf8');
  assert.match(source, /staging/i);
  assert.match(source, /service-role key/i);
  assert.match(source, /Do not migrate demo balances/i);
});

test('manual withdrawals reserve funds and only debit after admin payment confirmation', async () => {
  const migration = await readFile(path.join(root, 'supabase/migrations/20261013_manual_withdrawal_atomic.sql'), 'utf8');
  const api = await readFile(path.join(root, 'api/wallet.js'), 'utf8');
  assert.match(migration, /create or replace function public\.request_manual_withdrawal/);
  assert.match(migration, /w\.balance - w\.pending < amt/);
  assert.match(migration, /set pending = pending \+ amt/);
  assert.match(migration, /set balance = balance - amt, pending = pending - amt, paid = paid \+ amt/);
  assert.match(migration, /for update/);
  assert.match(migration, /revoke all on function public\.process_manual_withdrawal[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.process_manual_withdrawal[\s\S]*to service_role/);
  assert.match(api, /rpc\/request_manual_withdrawal/);
  assert.match(api, /rpc\/process_manual_withdrawal/);
  assert.match(api, /Payment reference is required/);
});
