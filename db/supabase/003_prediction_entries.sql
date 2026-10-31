-- Suggested entry of each directional prediction (buy/sell-check rules) and how it played out:
-- entry_status SL / TP1 / TP2 / TP3 / Alvo / aberta / expirou, entry_good true at TP1 or better, false at SL.
alter table predictions add column if not exists entry jsonb;
alter table predictions add column if not exists entry_status text;
alter table predictions add column if not exists entry_good boolean;
alter table predictions add column if not exists entry_final boolean not null default false;
create index if not exists predictions_entry_open on predictions (entry_final) where entry is not null;
