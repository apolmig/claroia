const DEFAULT_ALLOWED_ENDPOINTS = [
  "https://api.openai.com/v1",
  "https://openrouter.ai/api/v1",
  "https://api.groq.com/openai/v1",
  "https://api.deepseek.com",
  "https://generativelanguage.googleapis.com/v1beta/openai"
];

const MAX_REQUEST_BYTES = 10_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

const rateLimit = new Map<string, { count: number; resetAt: number }>();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-user-api-key"
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" }
  });

const allowedUrls = () =>
  (process.env.NETLIFY_ALLOWED_ENDPOINTS || DEFAULT_ALLOWED_ENDPOINTS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value));

const clientKey = (request: Request): string =>
  request.headers.get("x-nf-client-connection-ip") ||
  request.headers.get("client-ip") ||
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  "unknown";

const checkRateLimit = (request: Request) => {
  const now = Date.now();
  const key = clientKey(request);
  const current = rateLimit.get(key);
  if (!current || current.resetAt <= now) {
    rateLimit.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) {
    throw new Error("Rate limit exceeded. Please wait before retrying.");
  }
};

const isPrivateHost = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  return lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "0.0.0.0" ||
    lower === "::1" ||
    lower === "[::1]" ||
    lower.startsWith("0.") ||
    lower.startsWith("127.") ||
    lower.startsWith("10.") ||
    lower.startsWith("169.254.") ||
    lower.startsWith("192.168.") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower);
};

const isAllowedEndpoint = (url: URL): boolean =>
  allowedUrls().some((allowed) => {
    const allowedPath = allowed.pathname.replace(/\/+$/, "");
    const actualPath = url.pathname.replace(/\/+$/, "");
    return url.protocol === "https:" &&
      url.origin === allowed.origin &&
      (actualPath === allowedPath || actualPath.startsWith(`${allowedPath}/`));
  });

const validateEndpoint = (endpoint: string): string => {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS endpoints are allowed in the public demo.");
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error("Private network endpoints are not allowed in the public demo.");
  }
  if (!isAllowedEndpoint(url)) {
    throw new Error("Endpoint is not allowed for this demo.");
  }
  return url.toString();
};

const authHeaders = (endpoint: string, apiKey: string): Record<string, string> => {
  if (endpoint.includes("openai.azure.com") || endpoint.includes("api-version=")) {
    return { "api-key": apiKey };
  }
  return { authorization: `Bearer ${apiKey}` };
};

const readJsonBody = async (request: Request): Promise<any> => {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_REQUEST_BYTES) throw new Error("Request body is too large.");
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) throw new Error("Request body is too large.");
  return JSON.parse(text);
};

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export default async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = request.headers.get("x-user-api-key")?.trim();
  if (!apiKey) {
    return json(401, { error: "Missing x-user-api-key header" });
  }

  try {
    checkRateLimit(request);
    const payload = await readJsonBody(request);
    const endpoint = validateEndpoint(String(payload.endpoint || ""));
    const upstream = await fetchWithTimeout(endpoint, { headers: authHeaders(endpoint, apiKey) });
    const text = await upstream.text();
    if (upstream.status >= 300 && upstream.status < 400) {
      return json(502, { error: "Upstream redirects are not allowed." });
    }
    if (!upstream.ok) {
      return json(upstream.status, { error: `Upstream request failed (${upstream.status}).` });
    }
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, "content-type": upstream.headers.get("content-type") || "application/json" }
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Upstream request timed out."
      : error instanceof Error ? error.message : "Invalid request";
    return json(400, { error: message });
  }
};
