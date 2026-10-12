-- Atomic manual withdrawal workflow.
-- Pending requests reserve funds; wallet balance is debited only after an admin confirms the external transfer.
begin;

alter table public.withdrawals
  add column if not exists account_details jsonb not null default '{}'::jsonb,
  add column if not exists admin_note text,
  add column if not exists processed_at timestamptz,
  add column if not exists account_number text;

alter table public.wallets
  add column if not exists balance numeric(14,2) not null default 0,
  add column if not exists pending numeric(14,2) not null default 0,
  add column if not exists paid numeric(14,2) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists withdrawals_pending_created_idx
  on public.withdrawals(status, created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;

create or replace function public.request_manual_withdrawal(
  p_user_id uuid,
  p_amount numeric,
  p_method text,
  p_account_number text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets%rowtype;
  wd public.withdrawals%rowtype;
  amt numeric(14,2);
  acct text;
  method_name text;
begin
  if p_user_id is null or p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    return jsonb_build_object('ok', false, 'status', 400, 'message', 'Invalid withdrawal amount');
  end if;
  amt := round(p_amount, 2);
  if amt <= 0 then
    return jsonb_build_object('ok', false, 'status', 400, 'message', 'Amount is below supported precision');
  end if;
  method_name := trim(coalesce(p_method, ''));
  acct := trim(coalesce(p_account_number, ''));
  if method_name not in ('bKash', 'Nagad', 'Rocket') or acct !~ '^[0-9+ -]{8,25}$' then
    return jsonb_build_object('ok', false, 'status', 400, 'message', 'Invalid payout method or account number');
  end if;

  insert into public.wallets(user_id, balance, pending, paid)
  values (p_user_id, 0, 0, 0)
  on conflict (user_id) do nothing;

  select * into w from public.wallets where user_id = p_user_id for update;
  if w.user_id is null then
    return jsonb_build_object('ok', false, 'status', 404, 'message', 'Wallet not found');
  end if;
  if w.balance - w.pending < amt then
    return jsonb_build_object('ok', false, 'status', 400, 'message', 'Insufficient available balance');
  end if;

  insert into public.withdrawals(user_id, amount, method, account_number, account_details, status)
  values (p_user_id, amt, method_name, acct, jsonb_build_object('account_number', acct), 'pending')
  returning * into wd;

  update public.wallets set pending = pending + amt, updated_at = now()
  where user_id = p_user_id;

  insert into public.wallet_transactions(user_id, type, amount, description, reference_id)
  values (p_user_id, 'withdrawal_pending', amt, 'Manual withdrawal requested; funds reserved', wd.id::text);

  return jsonb_build_object('ok', true, 'withdrawal', to_jsonb(wd),
    'available_balance', w.balance - (w.pending + amt), 'balance', w.balance,
    'pending', w.pending + amt);
end;
$$;

create or replace function public.process_manual_withdrawal(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_status text,
  p_payment_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wd public.withdrawals%rowtype;
  w public.wallets%rowtype;
  next_status text := trim(coalesce(p_status, ''));
  pay_ref text := left(trim(coalesce(p_payment_ref, '')), 120);
  amt numeric(14,2);
begin
  if p_withdrawal_id is null or p_admin_id is null or next_status not in ('approved', 'rejected', 'cancelled') then
    return jsonb_build_object('ok', false, 'status', 400, 'message', 'Invalid withdrawal update');
  end if;
  if next_status = 'approved' and pay_ref = '' then
    return jsonb_build_object('ok', false, 'status', 400, 'message', 'Payment reference is required');
  end if;

  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if wd.id is null then
    return jsonb_build_object('ok', false, 'status', 404, 'message', 'Withdrawal not found');
  end if;
  if wd.status <> 'pending' then
    return jsonb_build_object('ok', false, 'status', 409, 'message', 'Withdrawal is already ' || wd.status);
  end if;

  select * into w from public.wallets where user_id = wd.user_id for update;
  if w.user_id is null then
    return jsonb_build_object('ok', false, 'status', 500, 'message', 'Wallet not found');
  end if;
  amt := round(wd.amount, 2);
  if w.pending < amt then
    return jsonb_build_object('ok', false, 'status', 409, 'message', 'Reserved withdrawal amount is inconsistent');
  end if;

  if next_status = 'approved' then
    if w.balance < amt then
      return jsonb_build_object('ok', false, 'status', 409, 'message', 'Wallet balance is lower than withdrawal amount');
    end if;
    update public.wallets
    set balance = balance - amt, pending = pending - amt, paid = paid + amt, updated_at = now()
    where user_id = wd.user_id;
    insert into public.wallet_transactions(user_id, type, amount, description, reference_id)
    values (wd.user_id, 'withdrawal_paid', -amt, 'Manual withdrawal paid; reference: ' || pay_ref, wd.id::text);
  else
    -- Funds were only reserved, not deducted. Releasing pending restores availability without changing balance.
    update public.wallets set pending = pending - amt, updated_at = now()
    where user_id = wd.user_id;
    insert into public.wallet_transactions(user_id, type, amount, description, reference_id)
    values (wd.user_id, 'withdrawal_released', amt, 'Manual withdrawal ' || next_status || '; reserved funds released', wd.id::text);
  end if;

  update public.withdrawals
  set status = next_status,
      admin_note = case
        when next_status = 'approved' then 'Manual payment reference: ' || pay_ref
        when next_status = 'rejected' then 'Withdrawal rejected by admin; reserved funds released'
        else 'Withdrawal cancelled by admin; reserved funds released'
      end,
      provider_ref = case when next_status = 'approved' then pay_ref else provider_ref end,
      processed_at = now(),
      updated_at = now()
  where id = wd.id
  returning * into wd;

  insert into public.audit_logs(actor_id, action, details)
  values (p_admin_id, 'withdrawal.' || next_status,
    jsonb_build_object('withdrawal_id', wd.id, 'user_id', wd.user_id, 'amount', amt, 'payment_ref', nullif(pay_ref, '')));

  return jsonb_build_object('ok', true, 'withdrawal', to_jsonb(wd));
end;
$$;

revoke all on function public.request_manual_withdrawal(uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.process_manual_withdrawal(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.request_manual_withdrawal(uuid, numeric, text, text) to service_role;
grant execute on function public.process_manual_withdrawal(uuid, uuid, text, text) to service_role;

commit;
