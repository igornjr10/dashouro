import { marketApi, type RuntimeEnv } from "../lib/market";

// Node.js runtime (Fluid Compute) with the Web Request/Response signature.
const handler = {
  fetch(request: Request) {
    const env: RuntimeEnv = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      TWELVEDATA_API_KEY: process.env.TWELVEDATA_API_KEY,
    };
    return marketApi(request, env);
  },
};

export default handler;
