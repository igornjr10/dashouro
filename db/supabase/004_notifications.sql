-- Telegram alerts already sent (one row per alert key), so the 5-minute scheduler never repeats one.
create table if not exists notifications (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table notifications enable row level security;
