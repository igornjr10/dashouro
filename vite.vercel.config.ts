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
          const response: Response = await marketApi(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers }), env);
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
    plugins: [react(), localApi({ OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, TWELVEDATA_API_KEY: env.TWELVEDATA_API_KEY })],
    build: {
      outDir: "dist/vercel",
    },
  };
});
