import { marketApi, type RuntimeEnv } from "../lib/market";

export const config = { runtime: "edge" };

export default function handler(request: Request) {
  const env: RuntimeEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    TWELVEDATA_API_KEY: process.env.TWELVEDATA_API_KEY,
  };
  return marketApi(request, env);
}
