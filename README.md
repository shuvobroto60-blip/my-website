# TrackNest — Vercel + Supabase Starter

This package is prepared with the TrackNest frontend at `public/index.html` and a Vercel health endpoint at `/api/health`.

## Deploy
1. Upload this project to GitHub.
2. Import the repository into Vercel.
3. Deploy with the default settings.
4. In Supabase, run `supabase/schema.sql` in SQL Editor.
5. Add environment variables in Vercel. Never expose the Supabase service-role key to the browser.

The current HTML is the existing TrackNest prototype. Real authentication, database-backed users, realtime chat, S2S/postback, conversions, and payments still require wiring to Supabase/provider APIs.
