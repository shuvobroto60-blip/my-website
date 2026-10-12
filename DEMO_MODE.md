# TrackNest demo-first workflow

## Current operating mode

TrackNest should remain in **demo mode** until a deliberate, tested cutover is requested. Demo interactions use browser-local storage and are not shared between browsers or devices. Demo balances, offers, messages, members, and withdrawals are simulated; they are not real money, real users, or real transactions.

## Before enabling real data later

Do not enable live mode just by removing the demo override. Complete this checklist first:

1. Configure Supabase URL and service-role key only in server-side Vercel environment variables; never put the service-role key in browser code.
2. Run `supabase/schema.sql`, then run the compatibility migration `supabase/migrations/20261013_tracknest_compatibility.sql`.
3. Configure a strong `POSTBACK_TOKEN`, admin credentials, and any optional email/SMS provider keys in Vercel. Do not commit secrets.
4. Verify the live API health endpoint and exercise signup, login/logout, role checks, offers, click tracking, conversion postback, idempotent wallet credit, withdrawal request/decision, notifications, support, and audit logs in a non-production test environment.
5. Add automated tests and review all authorization, rate limits, input validation, logging, privacy, and recovery paths.
6. Make the mode an explicit server-controlled deployment setting with a safe default of demo. Do not mix demo localStorage records with live database records.
7. Use a staging deployment and database backup before a live cutover. Do not migrate demo balances or accounts into real money records.

## Migration notes

The compatibility migration adds columns used by current API handlers and defines an idempotent `process_wallet_credit` RPC. Review and test the SQL against a staging Supabase project before production use. It does not enable live mode or configure external providers.
