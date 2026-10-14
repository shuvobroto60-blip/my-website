-- Allow an authenticated user to cancel only their own pending manual withdrawal.
begin;

create or replace function public.cancel_manual_withdrawal(
  p_withdrawal_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wd public.withdrawals%rowtype;
  w public.wallets%rowtype;
  amt numeric(14,2);
begin
  if p_withdrawal_id is null or p_user_id is null then
    return jsonb_build_object('ok', false, 'status', 400, 'message', 'Withdrawal id is required');
  end if;

  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if wd.id is null then
    return jsonb_build_object('ok', false, 'status', 404, 'message', 'Withdrawal not found');
  end if;
  if wd.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'status', 403, 'message', 'Not allowed to cancel this withdrawal');
  end if;
  if wd.status <> 'pending' then
    return jsonb_build_object('ok', false, 'status', 409, 'message', 'Only pending withdrawals can be cancelled');
  end if;

  select * into w from public.wallets where user_id = p_user_id for update;
  if w.user_id is null or w.pending < round(wd.amount, 2) then
    return jsonb_build_object('ok', false, 'status', 409, 'message', 'Reserved amount is inconsistent');
  end if;
  amt := round(wd.amount, 2);

  update public.wallets set pending = pending - amt, updated_at = now()
  where user_id = p_user_id;
  insert into public.wallet_transactions(user_id, type, amount, description, reference_id)
  values (p_user_id, 'withdrawal_released', amt, 'Manual withdrawal cancelled by owner; reserved funds released', wd.id::text);

  update public.withdrawals
  set status = 'cancelled',
      admin_note = 'Withdrawal cancelled by owner; reserved funds released',
      processed_at = now(),
      updated_at = now()
  where id = wd.id
  returning * into wd;

  insert into public.audit_logs(actor_id, action, details)
  values (p_user_id, 'withdrawal.cancelled_by_user',
    jsonb_build_object('withdrawal_id', wd.id, 'amount', amt));

  return jsonb_build_object('ok', true, 'withdrawal', to_jsonb(wd));
end;
$$;

revoke all on function public.cancel_manual_withdrawal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_manual_withdrawal(uuid, uuid) to service_role;

commit;
