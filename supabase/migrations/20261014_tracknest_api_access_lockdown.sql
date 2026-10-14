-- The application uses server-side service-role access only; block direct Data API access
-- for anon/authenticated until explicit row policies are intentionally designed.
begin;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Keep the required wallet RPCs callable by the server-side service role only.
grant execute on function public.process_wallet_credit(text, uuid, numeric, uuid) to service_role;
grant execute on function public.request_manual_withdrawal(uuid, numeric, text, text) to service_role;
grant execute on function public.process_manual_withdrawal(uuid, uuid, text, text) to service_role;
grant execute on function public.cancel_manual_withdrawal(uuid, uuid) to service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
