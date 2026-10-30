import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import type { RuntimeEnv } from "./lib/market";

// Serves /api/* in `vite dev` with the same handler Vercel runs, so the
// dashboard works locally without the Vercel CLI. Secrets come from .env.local.
function localApi(env: RuntimeEnv): Plugin {
  return {
    name: "aurum-local-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const { marketApi } = await server.ssrLoadModule("/lib/market.ts");
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
          // Forward the request body for POST routes such as /api/signal.
          const chunks: Buffer[] = [];
          if (req.method !== "GET" && req.method !== "HEAD") for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const response: Response = await marketApi(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body }), env);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), localApi({ OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, TWELVEDATA_API_KEY: env.TWELVEDATA_API_KEY, SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY, AURUM_ACCESS_TOKEN: env.AURUM_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET, TELEGRAM_OWNER_ID: env.TELEGRAM_OWNER_ID })],
    build: {
      outDir: "dist/vercel",
    },
  };
});
