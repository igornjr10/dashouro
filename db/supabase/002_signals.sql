-- Partner signals (Telegram forward or pasted text), scored twice: with the signal's SL and with Igor's session-capped SL.
create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('telegram','paste')),
  dedupe_key text unique,
  raw text not null,
  side text not null check (side in ('buy','sell')),
  entry numeric not null,
  sl numeric not null,
  tps numeric[] not null,
  signal_time timestamptz not null,
  session text not null,
  sl_pips int not null,
  adjusted_sl numeric,
  checks jsonb not null,
  status text not null default 'open' check (status in ('open','sl','tp1','tp2','tp3','expired')),
  max_pips numeric,
  result_pips numeric,
  tp1_at timestamptz,
  closed_at timestamptz,
  my_status text not null default 'open' check (my_status in ('open','sl','tp1','tp2','tp3','expired')),
  my_result_pips numeric,
  my_closed_at timestamptz
);
create index if not exists signals_signal_time on signals (signal_time desc);
create index if not exists signals_open on signals (status, my_status);
alter table signals enable row level security;
