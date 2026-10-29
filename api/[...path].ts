import { marketApi, type RuntimeEnv } from "../lib/market";

type VercelRequest = {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
};

type VercelResponse = {
  send(body: Uint8Array): void;
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
};

function requestHeaders(headers: VercelRequest["headers"]) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) result.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return result;
}

function requestBody(method: string, body: unknown) {
  if (method === "GET" || method === "HEAD" || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return JSON.stringify(body);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const method = request.method ?? "GET";
  const headers = requestHeaders(request.headers);
  const protocol = headers.get("x-forwarded-proto")?.split(",")[0] ?? "https";
  const host = headers.get("host");
  if (!host) return response.status(400).send(Buffer.from("Missing Host header"));

  const input = new Request(`${protocol}://${host}${request.url ?? "/"}`, {
    body: requestBody(method, request.body),
    headers,
    method,
  });
  const env: RuntimeEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    TWELVEDATA_API_KEY: process.env.TWELVEDATA_API_KEY,
  };
  const output = await marketApi(input, env);
  output.headers.forEach((value, name) => response.setHeader(name, value));
  response.status(output.status).send(Buffer.from(await output.arrayBuffer()));
}
