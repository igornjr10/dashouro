# Aurum — XAU/USD Intelligence

Private Sites dashboard for Igor Ruan. React / TypeScript / Vinext / Cloudflare Workers.

## Data integrity

No demo prices, fabricated candles, generated news, seeded investor positions or simulated AI outputs. External failures become unavailable states. Quote timestamps older than 120 seconds are marked stale and block AI requests. COT is weekly COMEX futures managed money; it is not spot flow. News contains source headlines, not verified article claims.

GET /api/quote: Gold API USD per troy ounce, updates on browser every 30 seconds.
GET /api/cot: CFTC Socrata disaggregated futures only, contract 088691, newest 2 reports.
GET /api/news: Google News personal RSS feed, gold / Fed, past 3 days.
GET /api/fed: official Federal Reserve monetary policy RSS.
GET /api/candles: Twelve Data XAU/USD 5min, last 100 bars, completed candles only.
GET /api/config: credential presence only, never secret values.
POST /api/insight: authenticated same-origin call, fresh source collection and OpenAI Responses API. No model call without configured credential. No entry timing recommendation without candles AND verified economic calendar; the latter is not yet connected. No brokerage execution.

TradingView OANDA:XAUUSD chart is independent from quote and AI feeds. It does not transmit its candles to the AI. Disclose source differences and latency in UI.

## Server secrets, configured only in Sites

OPENAI_API_KEY — pending user connection via OpenAI Developers plugin.
OPENAI_MODEL — optional, defaults to gpt-4.1-mini.
TWELVEDATA_API_KEY — pending a key with authorized XAU/USD access.

Never place keys in source, URL logs, client local storage or hosting manifest.

## Browser storage

Only the user's manually authored plan/checklist is saved in this browser. No account balance or financial details are transmitted by the calculator. No prefilled values. Position calculation uses user-chosen risk, stop, ounces/lot, lot step, and per-lot round-trip cost; rounds down. Gap losses can exceed estimate.

## Checks

node node_modules/typescript/bin/tsc --noEmit
node /root/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/scripts/build-site.mjs

Use Sites source workflow for source push, packaging and private publication.
