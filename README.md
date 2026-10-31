# Aurum — XAU/USD Intelligence

Private Sites dashboard for Igor Ruan. React / TypeScript / Vinext / Cloudflare Workers.

## Data integrity

No demo prices, fabricated candles, generated news, seeded investor positions or simulated AI outputs. External failures become unavailable states. Quote timestamps older than 120 seconds are marked stale and block AI requests. COT is weekly COMEX futures managed money; it is not spot flow. News contains source headlines, not verified article claims.

GET /api/quote: Gold API USD per troy ounce, updates on browser every 30 seconds.
GET /api/cot: CFTC Socrata disaggregated futures only, contract 088691, newest 2 reports.
GET /api/news: Google News personal RSS feed, gold / Fed, past 3 days.
GET /api/fed: official Federal Reserve monetary policy RSS.
GET /api/candles: Twelve Data XAU/USD 5min (100 requested, ~99 completed bars) plus 1h (120 bars, cached until the next hour, ~24 calls/day). Server-computed indicators (EMA, RSI, ATR, momentum, recent highs/lows) and intraday levels: previous UTC day high/low/close, today's Asia/London/New York session ranges (approximate UTC hours), H1 trend. If H1 fails, M5 still returns with intradayError.
GET /api/calendar: official release times from the BLS (CPI, Employment Situation, PPI, JOLTS, ECI) and BEA (GDP, PCE, trade) iCalendar feeds and the Fed FOMC calendar page (statement 14:00 New York), fetched at most every 6 h per instance with an identifying User-Agent (BLS refuses automated retrieval after a few requests; a refused source is reported and its last events are kept, never worked around), plus the faireconomy (ForexFactory) weekly feed for USD events the official calendars do not cover; aggregator events at the same minute as an official one are dropped. Each event carries official/source; verified is true when all three official sources answered. The buy/sell check blocks entries 30 min before and 15 min after a high-impact event.
GET /api/config: credential presence only, never secret values.
POST /api/insight and POST /api/check stream their answer: the Edge function must start responding within ~25s while free models take 30–60s, so the server sends a space every 5s and then the JSON, with the real status in a `status` field and errors in `error` (clients check `error`, not the HTTP code). /api/insight returns two independent calls: `short` (1h, scalping, led by M5, momentum, M5 gauge and candle pressure; confidence capped against the M5 trend or with a high-impact USD event within 1h) and the top-level 4h call (day trade, led by H1 and day levels; capped against the H1 trend or with an event within 4h). Both are stored and scored separately (horizon_hours 1 and 4) and the scoreboard shows hit rates per horizon. Earlier description: POST /api/insight: same-origin call, fresh source collection and OpenRouter Chat Completions API. No model call without a credential supplied by the current browser session. Returns a structured directional bias (alta/baixa/neutro, confidence, 1–4h horizon, drivers, invalidation). The model only names an invalidation level key; the server resolves it to a computed price. Server caps: neutral/low without current candles; confidence at most "media" with a high-impact USD event within 4h or when H1 trend opposes the bias. A bias is not an entry signal: no entry timing recommendation without candles AND verified economic calendar; the latter is not yet connected. No brokerage execution.

Each directional call (1h and 4h) also carries an `entry` built by the buy/sell-check rules for that side (lib/market.ts entryOf: price at the M5 close, structural stop, Igor's 20/45/80 ladder and layer for gold; USD stop and next-level target for Bitcoin), with that check's verdict; neutral calls carry none. The browser log keeps the entry and replays later M5 bars to score it: stop first when a bar touches both, stop to entry after TP1 (TP1 then BE counts as TP1), final at the last target, the stop or 24 h. The chart draws the latest analysis entry for 8 h. With the access token, gold entries are stored with each prediction (predictions.entry, entry_status, entry_good, entry_final; db/supabase/003) and scored on the server by the same lib/entry-outcome.ts whenever history is read; the scoreboard shows "Entradas no TP1+".

POST /api/check?side=buy|sell: pre-trade check the user triggers with "Avaliar compra/venda". The verdict (favoravel / ressalvas / desfavoravel / nao-operar) comes only from fixed server rules: M5 trend, H1 trend, 1h momentum, RSI not stretched, room to the next level (≥2× ATR), risk/reward ≥1.5. Hard block ("nao-operar") with stale candles or a high-impact USD event within 30 min; an event within 4h caps the verdict at "ressalvas". Stops and targets follow Igor's trading rules (1 pip = 0.10 USD, 10 USD per pip per lot): SL = 3 pips beyond the nearest protection level at least 1× ATR away, clamped to 25 pips minimum (so the protection layer fits) and to the session cap (30 pips Asia/London, 50 New York; UTC hours); TP1 20, TP2 40–50, TP3 80 pips; protection layer with the same lot and SL 10–20 pips against the entry, with average price and total loss if both are stopped. Checks 5 and 6 are "no level before TP1" and "technical stop fits the session cap". The model, when a key is present, only explains the verdict (pros, cons, news/COT context) and cannot change it. Works without OpenRouter. Never sends orders; the user decides and executes at the broker. This deliberately relaxes the earlier "no entry evaluation" rule at the user's request.

## Bitcoin view (read-only)

GET /api/btc/candles and /api/btc/quote read Coinbase Exchange public data (BTC-USD; free, no key, real traded volume, no Twelve Data credits). The candles response mirrors the gold one: M5/M15/H1, server indicators, day/session levels, H1 trend, buy/sell gauge and CRT setups with rules=false (structural invalidation and CRT target in USD; the gold pip caps and ladder do not apply). The chart area has an XAU/USD | BTC/USD switch (remembered per browser). With BTC selected, POST /api/insight?asset=btc runs the same 1h/4h analysis on Coinbase candles, crypto headlines (GET /api/btc/news, Google News) and the alternative.me Crypto Fear & Greed index (included in /api/btc/candles); POST /api/check?asset=btc runs the market checklist with USD distances (stop beyond the nearest protecting level or 2x ATR, target at the next level or 3x ATR, R:R >= 1.5, same event blocks) and no gold pip rules. Bitcoin predictions and checks are not stored; partner signals, the risk card and alerts stay on gold.

## CRT in the dashboard

lib/crt.ts ports the CRT model from strategy/ (same entries on the same 90 days of M5: 14/14). /api/candles returns the last three A/B pairs whose B opens at 01, 05 or 09 New York time, with a status (b-formando, sem-setup, aguardando-quebra, entrada, descartado, expirado) and, for an entry, the price, the session-capped stop, the 20/50/80 ladder capped at the CRT target and the protection-layer zone. The overview shows a CRT card, the chart draws the CRT High/Low and the entry plan for 8 h, and alerts fire on a confirmed sweep and on the M5 entry.

## Scalping card (Asian sweep in London)

lib/scalp.ts ports strategy/aurum_strategy/scalp.py asia_sweep (same entries on one year of M5: 155/155 signals, 54/54 trades). Asian range 00–07 UTC; in the London killzone (02–05 New York, not before 07 UTC) the first M5 that trades through the Asian high or low and closes back inside gives a trade against the sweep at the next bar's open, invalidation at the sweep wick, target the other side of the range, one setup per day. Stop, ladder and layer come from rulePlan in lib/crt.ts (Igor's rules, shared with the CRT). /api/candles returns it as `scalp`; the overview shows it for gold only, the chart draws its entry for 8 h and alerts fire on the entry. Weekends are reported as closed (the feed prints flat placeholder bars). Backtest: +148.6 pips net of a 3-pip spread over 54 trades, breaks even near a 6-pip spread; observe on demo.

## Telegram alerts

GET /api/notify (X-Aurum-Access required) builds gold alerts from /api/candles and /api/calendar, read through the CDN so it adds no Twelve Data calls: a summary 45 min before the London scalping window (Asian range, CRT state, high-impact USD events of the day), the Asian-sweep scalping entry, the CRT sweep and M5 entry, and each high-impact USD event 20 min ahead. Each alert key is recorded in the notifications table (db/supabase/004) before sending, so it goes out once; a failed send releases the key. It sends to TELEGRAM_OWNER_ID with TELEGRAM_BOT_TOKEN. Supabase pg_cron calls it every 5 minutes, Monday to Friday UTC, through pg_net: node --env-file=.env.local scripts/notify-cron.mjs (add --off to remove).

## Partner signals (paste or Telegram forward)

POST /api/signal {text, time?} and POST /api/telegram (bot webhook) share one parser for the partner's format ("Gold buy 4019 / SL 4014 / TP 4025…"; unlabeled SL lines and the "T0" typo are accepted; updates such as "tp1 for 20 pips" are rejected as non-signals). Each signal is checked against Igor's rules at its posting time (SL within the session cap, first TP ≥ 20 pips, and, while fresh, entry within 10 pips of the last M5 close plus the live market checklist). A wider SL gets a session-capped "adjusted SL".

Signals are stored in `signals` and scored on the server from H1+M5 bars: filled only when a bar trades through the entry; ladder 20/50/80 pips; TP1 moves the stop to break-even, so TP1 followed by a BE stop counts as TP1; a bar touching both stop and TP1 counts as stop; unfilled or no-TP1 after 24h expires. Each signal is scored twice: with the partner's SL and with the adjusted SL ("suas regras").

Telegram: the bot only processes messages from TELEGRAM_OWNER_ID (until it is set, it replies with the sender's id) and requires TELEGRAM_WEBHOOK_SECRET on every call (set via setWebhook secret_token). The forward's original post time and message id are used for timing and de-duplication. Reading the partner's channel directly is not possible with a bot (it is not an admin there); the owner forwards each signal.

## Database (Supabase, optional)

Supabase `aurum-db` is provisioned through the Vercel Marketplace and connected to the project (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POSTGRES_URL_* are injected by the integration). Tables live in db/supabase/*.sql and are applied with `node --env-file=.env.local scripts/db-migrate.mjs`. RLS is enabled with no policies, so the public anon key cannot read or write; only the server uses the service role, over PostgREST fetch (Edge-safe, no driver at runtime).

Storage is active only when AURUM_ACCESS_TOKEN is also set. The browser sends it as X-Aurum-Access (typed once per device in the scoreboard, kept in localStorage `aurum-access`). With a valid token, /api/insight and /api/check save their results (best effort: a database failure never blocks the answer) and GET /api/history returns the last predictions and checks with hit rates by bias and confidence. Pending predictions are scored on the server whenever history is read within ~8h of expiry. Without the token everything falls back to the per-browser log.

Predictions are logged in this browser (localStorage) and scored against the Twelve Data M5 close at horizon end; the scoreboard shows the hit rate. Price/event alerts use browser notifications from the open tab only, driven by the Gold API spot quote.

The default chart (Lightweight Charts) draws the same Twelve Data candles the AI receives, with EMAs, levels, invalidation, horizon band, past predictions and USD events. The TradingView OANDA:XAUUSD chart remains as an independent option and does not transmit its candles to the AI. Disclose source differences and latency in UI.

## Server secrets, configured only in Sites

OPENROUTER_API_KEY — optional server secret. Never reuses the prior OpenAI key.
Models are free only, tried in order through OpenRouter fallbacks: dots-studio/dots-3-note-preview:free, cohere/north-mini-code:free, then the openrouter/free router (see FREE_MODELS in lib/openrouter.ts for the benchmark notes), with provider max_price prompt/completion = 0 and data_collection = deny. Free NVIDIA/Poolside tiers are unavailable because they require allowing training on prompts. max_tokens 8000 with reasoning capped at 1500 tokens, because free reasoning models otherwise exhaust the budget before answering. No paid fallback or paid web-search plugins.
TWELVEDATA_API_KEY — configured locally (.env.local) and in Vercel; plan has XAU/USD access.

Never place keys in source, URL logs or hosting manifest. The only client storage exception is the user's own OpenRouter key when they tick "Lembrar neste navegador" (see below).

For a public Vercel deployment, do not configure `OPENROUTER_API_KEY`: visitors provide their own OpenRouter key for the current browser tab. This keeps a server key from being available to anonymous visitors.

Alternatively the user enters their OpenRouter key into the private dashboard password field. POST /api/openrouter validates it without generating tokens. By default only the current tab holds it in memory. If the user opts into "Lembrar neste navegador", it is kept in localStorage (aurum-openrouter-key) on that device only, revalidated on page load and removed on disconnect or when OpenRouter rejects it (400/401). Requests send it in X-Aurum-OpenRouter-Key over HTTPS. Same-origin and authenticated-user checks apply to both POST routes. The server uses it only for that request and never logs it or returns it. Disconnect clears it; reload clears it unless remembered. TradingView scripts run in an cross-origin sandboxed iframe, isolated from dashboard credentials. Key validity does not guarantee inference availability. No automatic retries. Errors, quotas and incomplete responses are presented honestly. Responses include actual selected model.

Free endpoint rules: https://openrouter.ai/collections/free-models/
Provider constraints: https://openrouter.ai/docs/guides/routing/provider-selection

## Browser storage

Only the user's manually authored plan/checklist is saved in this browser. No account balance or financial details are transmitted by the calculator. No prefilled values. Position calculation uses user-chosen risk, stop, ounces/lot, lot step, and per-lot round-trip cost; rounds down. Gap losses can exceed estimate.

## Local development (Vercel build)

pnpm install, then pnpm dev:vercel. Vite serves the SPA and /api/* through the same marketApi handler. Optional secrets go in .env.local (git-ignored).

The Vercel function stays on the Edge runtime: a move to Node.js returned 500 on every route and was reverted.

## Checks

node node_modules/typescript/bin/tsc --noEmit
node /root/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/scripts/build-site.mjs

Use Sites source workflow for source push, packaging and private publication.

## Brokerage context

User confirmed Exness via its app/site. This is a preference, not an authenticated feed. No Exness credentials, prices or candles have been connected. OANDA TradingView and Gold API remain explicitly labeled independent references. Exness API eligibility must be verified in the user Personal Area before any integration. Do not assume that using the Exness app establishes the underlying account platform or API access.
