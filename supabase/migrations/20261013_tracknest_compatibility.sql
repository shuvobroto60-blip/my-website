-- TrackNest compatibility migration: run only after reviewing the target schema.
-- Keeps demo mode as the default; this prepares backend schema for future opt-in live mode.
begin;

-- Notifications support both outbound delivery records and in-app messages.
alter table public.notifications
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists type text not null default 'system',
  add column if not exists is_read boolean not null default false;

update public.notifications
set title = coalesce(title, subject, 'TrackNest notification'),
    message = coalesce(message, body, ''),
    type = coalesce(type, channel, 'system')
where title is null or message is null or type is null;

-- Withdrawal API uses structured account details and processing metadata.
alter table public.withdrawals
  add column if not exists account_details jsonb not null default '{}'::jsonb,
  add column if not exists admin_note text,
  add column if not exists processed_at timestamptz;

-- Conversion postback metadata.
alter table public.conversions
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists goal_name text,
  add column if not exists transaction_id text,
  add column if not exists ip_address text,
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists device text,
  add column if not exists os text;

-- Match both clean installs and existing TrackNest deployments that already have
-- a ledger with status/balance_after/credited_at required columns.
create table if not exists public.wallet_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  click_id text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  conversion_id uuid references public.conversions(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'credited',
  balance_after numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  credited_at timestamptz not null default now()
);
alter table public.wallet_credit_ledger
  add column if not exists status text not null default 'credited',
  add column if not exists balance_after numeric(14,2) not null default 0,
  add column if not exists credited_at timestamptz not null default now();
alter table public.wallet_credit_ledger enable row level security;

-- Preserve the wallet transaction history table used by existing deployments.
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  amount numeric(14,2) not null,
  description text,
  reference_id text,
  created_at timestamptz not null default now()
);
alter table public.wallet_transactions enable row level security;

create or replace function public.process_wallet_credit(
  p_click_id text,
  p_user_id uuid,
  p_amount numeric,
  p_conversion_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id uuid;
  existing public.wallet_credit_ledger%rowtype;
  new_balance numeric(14,2);
  credit_amount numeric(14,2);
begin
  if p_click_id is null or length(trim(p_click_id)) = 0 or length(trim(p_click_id)) > 200 then
    return jsonb_build_object('ok', false, 'message', 'Invalid click_id');
  end if;
  if p_user_id is null or p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    return jsonb_build_object('ok', false, 'message', 'Invalid wallet credit');
  end if;
  credit_amount := round(p_amount, 2);
  if credit_amount <= 0 then
    return jsonb_build_object('ok', false, 'message', 'Credit amount is below the supported precision');
  end if;

  -- Create a wallet row before ledger insertion; any later error rolls back both.
  insert into public.wallets(user_id, balance, pending, paid)
  values (p_user_id, 0, 0, 0)
  on conflict (user_id) do nothing;

  insert into public.wallet_credit_ledger(click_id, user_id, conversion_id, amount, status, balance_after, credited_at)
  values (trim(p_click_id), p_user_id, p_conversion_id, credit_amount, 'credited', 0, now())
  on conflict (click_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select * into existing from public.wallet_credit_ledger where click_id = trim(p_click_id);
    if existing.id is null then
      return jsonb_build_object('ok', false, 'message', 'Unable to verify existing credit');
    end if;
    if existing.user_id <> p_user_id or existing.amount <> credit_amount then
      return jsonb_build_object('ok', false, 'message', 'click_id was already credited with different details');
    end if;
    return jsonb_build_object('ok', true, 'duplicate', true, 'credited', false,
      'click_id', existing.click_id, 'ledger_id', existing.id,
      'balance_after', existing.balance_after);
  end if;

  update public.wallets
  set balance = balance + credit_amount, updated_at = now()
  where user_id = p_user_id
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'Wallet could not be updated for user';
  end if;

  update public.wallet_credit_ledger
  set balance_after = new_balance, credited_at = now()
  where id = inserted_id;

  insert into public.wallet_transactions(user_id, type, amount, description, reference_id)
  values (p_user_id, 'credit', credit_amount, 'Conversion payout', trim(p_click_id));

  return jsonb_build_object('ok', true, 'duplicate', false, 'credited', true,
    'click_id', trim(p_click_id), 'ledger_id', inserted_id, 'balance_after', new_balance);
end;
$$;

-- The function is privileged and must only be callable by server-side service_role.
revoke all on function public.process_wallet_credit(text, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.process_wallet_credit(text, uuid, numeric, uuid) to service_role;

commit;
