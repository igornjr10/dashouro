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
POST /api/insight: same-origin call, fresh source collection and OpenRouter Chat Completions API. No model call without a credential supplied by the current browser session. No entry timing recommendation without candles AND verified economic calendar; the latter is not yet connected. No brokerage execution.

TradingView OANDA:XAUUSD chart is independent from quote and AI feeds. It does not transmit its candles to the AI. Disclose source differences and latency in UI.

## Server secrets, configured only in Sites

OPENROUTER_API_KEY — optional server secret. Never reuses the prior OpenAI key.
Model is locked to openrouter/free with provider max_price prompt/completion = 0 and data_collection = deny. No paid fallback or paid web-search plugins.
TWELVEDATA_API_KEY — pending a key with authorized XAU/USD access.

Never place keys in source, URL logs, client local storage or hosting manifest.

For a public Vercel deployment, do not configure `OPENROUTER_API_KEY`: visitors provide their own OpenRouter key for the current browser tab. This keeps a server key from being available to anonymous visitors.

Alternatively the user enters their OpenRouter key into the private dashboard password field. POST /api/openrouter validates it without generating tokens. Only the current tab holds it in memory; requests send it in X-Aurum-OpenRouter-Key over HTTPS. Same-origin and authenticated-user checks apply to both POST routes. The server uses it only for that request and never logs it or returns it. Disconnect/reload clears it. TradingView scripts run in an cross-origin sandboxed iframe, isolated from dashboard credentials. Key validity does not guarantee inference availability. No automatic retries. Errors, quotas and incomplete responses are presented honestly. Responses include actual selected model.

Free endpoint rules: https://openrouter.ai/collections/free-models/
Provider constraints: https://openrouter.ai/docs/guides/routing/provider-selection

## Browser storage

Only the user's manually authored plan/checklist is saved in this browser. No account balance or financial details are transmitted by the calculator. No prefilled values. Position calculation uses user-chosen risk, stop, ounces/lot, lot step, and per-lot round-trip cost; rounds down. Gap losses can exceed estimate.

## Checks

node node_modules/typescript/bin/tsc --noEmit
node /root/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/scripts/build-site.mjs

Use Sites source workflow for source push, packaging and private publication.

## Brokerage context

User confirmed Exness via its app/site. This is a preference, not an authenticated feed. No Exness credentials, prices or candles have been connected. OANDA TradingView and Gold API remain explicitly labeled independent references. Exness API eligibility must be verified in the user Personal Area before any integration. Do not assume that using the Exness app establishes the underlying account platform or API access.
