-- TrackNest compatibility migration: safe to run after supabase/schema.sql.
-- Keeps demo mode as the default; this only prepares backend schema for a future opt-in live mode.
begin;

-- Notifications currently have an outbound-delivery shape; add the in-app notification shape too.
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

-- Withdrawal API stores structured account details and processing metadata.
alter table public.withdrawals
  add column if not exists account_details jsonb not null default '{}'::jsonb,
  add column if not exists admin_note text,
  add column if not exists processed_at timestamptz;

-- Preserve the original raw payload name and add the fields currently written by postback.js.
alter table public.conversions
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists goal_name text,
  add column if not exists transaction_id text,
  add column if not exists ip_address text,
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists device text,
  add column if not exists os text;

-- Idempotency ledger prevents duplicate wallet credits for the same click/postback.
create table if not exists public.wallet_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  click_id text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  conversion_id uuid references public.conversions(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
alter table public.wallet_credit_ledger enable row level security;

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
begin
  if p_click_id is null or length(trim(p_click_id)) = 0 then
    return jsonb_build_object('ok', false, 'message', 'click_id is required');
  end if;
  if p_user_id is null or p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    return jsonb_build_object('ok', false, 'message', 'Invalid wallet credit');
  end if;

  insert into public.wallet_credit_ledger(click_id, user_id, conversion_id, amount)
  values (trim(p_click_id), p_user_id, p_conversion_id, round(p_amount, 2))
  on conflict (click_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select * into existing from public.wallet_credit_ledger where click_id = trim(p_click_id);
    if existing.user_id <> p_user_id or existing.amount <> round(p_amount, 2) then
      return jsonb_build_object('ok', false, 'message', 'click_id was already credited with different details');
    end if;
    select balance into new_balance from public.wallets where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'credited', false,
      'ledger_id', existing.id, 'balance_after', coalesce(new_balance, 0));
  end if;

  insert into public.wallets(user_id, balance, pending, paid)
  values (p_user_id, 0, 0, 0)
  on conflict (user_id) do nothing;

  update public.wallets
  set balance = balance + round(p_amount, 2), updated_at = now()
  where user_id = p_user_id
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'Wallet could not be created for user';
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'credited', true,
    'ledger_id', inserted_id, 'balance_after', new_balance);
exception when others then
  raise;
end;
$$;

-- Only the server-side service role should invoke this privileged credit function.
revoke all on function public.process_wallet_credit(text, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.process_wallet_credit(text, uuid, numeric, uuid) to service_role;

commit;
