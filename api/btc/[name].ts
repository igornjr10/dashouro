// /api/btc/* has two path segments, which api/[...path].ts does not match on Vercel; same handler, same request URL.
import handler from "../[...path]";

export const config = { runtime: "edge" };

export default handler;
