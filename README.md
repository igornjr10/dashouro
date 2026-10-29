# Aurum — XAU/USD Intelligence

Private Sites dashboard for Igor Ruan. React / TypeScript / Vinext / Cloudflare Workers.

## Data integrity

No demo prices, fabricated candles, generated news, seeded investor positions or simulated AI outputs. External failures become unavailable states. Quote timestamps older than 120 seconds are marked stale and block AI requests. COT is weekly COMEX futures managed money; it is not spot flow. News contains source headlines, not verified article claims.

GET /api/quote: Gold API USD per troy ounce, updates on browser every 30 seconds.
GET /api/cot: CFTC Socrata disaggregated futures only, contract 088691, newest 2 reports.
GET /api/news: Google News personal RSS feed, gold / Fed, past 3 days.
GET /api/fed: official Federal Reserve monetary policy RSS.
GET /api/candles: Twelve Data XAU/USD 5min (100 requested, ~99 completed bars) plus 1h (120 bars, cached until the next hour, ~24 calls/day). Server-computed indicators (EMA, RSI, ATR, momentum, recent highs/lows) and intraday levels: previous UTC day high/low/close, today's Asia/London/New York session ranges (approximate UTC hours), H1 trend. If H1 fails, M5 still returns with intradayError.
GET /api/calendar: faireconomy (ForexFactory) weekly feed, USD high/medium impact only, cached 15 min per instance. Unofficial aggregator: alert-only, never treated as a verified calendar.
GET /api/config: credential presence only, never secret values.
POST /api/insight: same-origin call, fresh source collection and OpenRouter Chat Completions API. No model call without a credential supplied by the current browser session. Returns a structured directional bias (alta/baixa/neutro, confidence, 1–4h horizon, drivers, invalidation). The model only names an invalidation level key; the server resolves it to a computed price. Server caps: neutral/low without current candles; confidence at most "media" with a high-impact USD event within 4h or when H1 trend opposes the bias. A bias is not an entry signal: no entry timing recommendation without candles AND verified economic calendar; the latter is not yet connected. No brokerage execution.

Predictions are logged in this browser (localStorage) and scored against the Twelve Data M5 close at horizon end; the scoreboard shows the hit rate. Price/event alerts use browser notifications from the open tab only, driven by the Gold API spot quote.

The default chart (Lightweight Charts) draws the same Twelve Data candles the AI receives, with EMAs, levels, invalidation, horizon band, past predictions and USD events. The TradingView OANDA:XAUUSD chart remains as an independent option and does not transmit its candles to the AI. Disclose source differences and latency in UI.

## Server secrets, configured only in Sites

OPENROUTER_API_KEY — optional server secret. Never reuses the prior OpenAI key.
Model is locked to openrouter/free with provider max_price prompt/completion = 0 and data_collection = deny. No paid fallback or paid web-search plugins.
TWELVEDATA_API_KEY — configured locally (.env.local) and in Vercel; plan has XAU/USD access.

Never place keys in source, URL logs, client local storage or hosting manifest.

For a public Vercel deployment, do not configure `OPENROUTER_API_KEY`: visitors provide their own OpenRouter key for the current browser tab. This keeps a server key from being available to anonymous visitors.

Alternatively the user enters their OpenRouter key into the private dashboard password field. POST /api/openrouter validates it without generating tokens. Only the current tab holds it in memory; requests send it in X-Aurum-OpenRouter-Key over HTTPS. Same-origin and authenticated-user checks apply to both POST routes. The server uses it only for that request and never logs it or returns it. Disconnect/reload clears it. TradingView scripts run in an cross-origin sandboxed iframe, isolated from dashboard credentials. Key validity does not guarantee inference availability. No automatic retries. Errors, quotas and incomplete responses are presented honestly. Responses include actual selected model.

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
