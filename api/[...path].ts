import { marketApi, type RuntimeEnv } from "../lib/market";

export const config = { runtime: "edge" };

export default function handler(request: Request) {
  const env: RuntimeEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    TWELVEDATA_API_KEY: process.env.TWELVEDATA_API_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    AURUM_ACCESS_TOKEN: process.env.AURUM_ACCESS_TOKEN,
  };
  return marketApi(request, env);
}
