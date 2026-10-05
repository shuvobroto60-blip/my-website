create extension if not exists pgcrypto;

create table if not exists public.users (
 id uuid primary key default gen_random_uuid(),
 public_id char(5) unique not null check (public_id ~ '^[0-9]{5}$'),
 username text unique not null,
 email text unique not null,
 name text not null default '',
 password_hash text not null,
 role text not null default 'user' check (role in ('user','admin')),
 status text not null default 'active' check (status in ('active','suspended')),
 created_at timestamptz not null default now()
);

create table if not exists public.postbacks (
 id uuid primary key default gen_random_uuid(),
 token text not null default '',
 click_id text not null,
 payout numeric(12,2) not null default 0,
 status text not null default 'approved',
 query jsonb not null default '{}'::jsonb,
 body jsonb not null default '{}'::jsonb,
 received_at timestamptz not null default now()
);
create index if not exists users_public_id_idx on public.users(public_id);
create index if not exists postbacks_click_id_idx on public.postbacks(click_id);
create index if not exists postbacks_received_at_idx on public.postbacks(received_at desc);
alter table public.users enable row level security;
alter table public.postbacks enable row level security;
