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
    assert.match(source, /apiCall\('\\/api\\/offers',\\{action:'create'/);
    assert.match(source, /apiCall\('\\/api\\/offers',\\{action:'join'/);
    assert.match(source, /apiCall\('\\/api\\/wallet',\\{action:'withdraw'/);
    assert.match(source, /apiCall\('\\/api\\/wallet',\\{action:'cancel'/);
    assert.match(source, /apiCall\('\\/api\\/wallet',\\{action:'update'/);
    assert.match(source, /apiCall\('\\/api\\/chat',\\{kind:'global'/);
    assert.match(source, /apiCall\('\\/api\\/support',\\{action:'create'/);
    assert.match(source, /@media\\(max-width:767px\\)/);
  }
});

test('owner-only withdrawal cancellation migration is atomic and service-role only', async () => {
  const migration = await readFile(path.join(root, 'supabase/migrations/20261014_tracknest_user_withdrawal_cancel.sql'), 'utf8');
  const api = await readFile(path.join(root, 'api/wallet.js'), 'utf8');
  assert.match(migration, /create or replace function public\\.cancel_manual_withdrawal/);
  assert.match(migration, /wd\\.user_id <> p_user_id/);
  assert.match(migration, /wd\\.status <> 'pending'/);
  assert.match(migration, /for update/);
  assert.match(migration, /revoke all on function public\\.cancel_manual_withdrawal[\\s\\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\\.cancel_manual_withdrawal[\\s\\S]*to service_role/);
  assert.match(api, /rpc\\/cancel_manual_withdrawal/);
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
