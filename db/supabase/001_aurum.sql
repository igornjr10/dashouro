-- Aurum history: AI directional predictions and buy/sell checks.
-- RLS is on with no policies, so the public anon key can read or write nothing;
-- only the server (service role) touches these tables.

create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bias text not null check (bias in ('alta','baixa','neutro')),
  confidence text not null check (confidence in ('baixa','media','alta')),
  horizon_hours int not null check (horizon_hours between 1 and 4),
  ref_price numeric not null,
  ref_time timestamptz not null,
  invalidation_level text,
  invalidation_price numeric,
  drivers jsonb not null default '[]'::jsonb,
  model text,
  status text not null default 'pending' check (status in ('pending','scored','unchecked')),
  result_price numeric,
  result_move numeric,
  hit boolean,
  scored_at timestamptz
);
create index if not exists predictions_status_ref_time on predictions (status, ref_time);
create index if not exists predictions_created_at on predictions (created_at desc);

create table if not exists trade_checks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  side text not null check (side in ('buy','sell')),
  verdict text not null check (verdict in ('favoravel','ressalvas','desfavoravel','nao-operar')),
  passed int not null,
  total int not null,
  price numeric not null,
  stop_price numeric not null,
  stop_name text not null,
  target_price numeric,
  target_name text,
  rr numeric,
  block text,
  checks jsonb not null,
  model text
);
create index if not exists trade_checks_created_at on trade_checks (created_at desc);

alter table predictions enable row level security;
alter table trade_checks enable row level security;
