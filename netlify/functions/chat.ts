const DEFAULT_ALLOWED_ENDPOINTS = [
  "https://api.openai.com/v1",
  "https://openrouter.ai/api/v1",
  "https://api.groq.com/openai/v1",
  "https://api.deepseek.com",
  "https://generativelanguage.googleapis.com/v1beta/openai"
];

const MAX_REQUEST_BYTES = 200_000;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 50_000;
const MAX_TOTAL_MESSAGE_CHARS = 100_000;
const UPSTREAM_TIMEOUT_MS = 25_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

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

const normalizeChatEndpoint = (endpoint: string): URL => {
  const url = new URL(endpoint);
  if (url.pathname.endsWith("/chat/completions")) return url;
  if (url.pathname.endsWith("/models")) {
    url.pathname = url.pathname.replace(/\/models$/, "/chat/completions");
    return url;
  }
  if (url.pathname.endsWith("/v1")) {
    url.pathname += "/chat/completions";
    return url;
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/chat/completions";
  return url;
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
  const url = normalizeChatEndpoint(endpoint);
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
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new Error("Request body is too large.");
  }

  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) {
    throw new Error("Request body is too large.");
  }

  return JSON.parse(text);
};

const validateMessages = (messages: unknown): Array<{ role: string; content: string }> => {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new Error(`Messages must contain 1-${MAX_MESSAGES} items.`);
  }

  let totalChars = 0;
  return messages.map((message) => {
    if (!message || typeof message !== "object") {
      throw new Error("Each message must be an object.");
    }

    const { role, content } = message as { role?: unknown; content?: unknown };
    if (!["system", "user", "assistant"].includes(String(role))) {
      throw new Error("Invalid message role.");
    }
    if (typeof content !== "string" || content.length === 0 || content.length > MAX_MESSAGE_CHARS) {
      throw new Error(`Each message content must be 1-${MAX_MESSAGE_CHARS} characters.`);
    }

    totalChars += content.length;
    if (totalChars > MAX_TOTAL_MESSAGE_CHARS) {
      throw new Error(`Messages exceed ${MAX_TOTAL_MESSAGE_CHARS} total characters.`);
    }

    return { role: String(role), content };
  });
};

const sanitizeParams = (params: unknown) => {
  const source = params && typeof params === "object" ? params as Record<string, unknown> : {};
  const clean: Record<string, unknown> = { stream: false };

  if (typeof source.temperature === "number") clean.temperature = Math.min(2, Math.max(0, source.temperature));
  if (typeof source.top_p === "number") clean.top_p = Math.min(1, Math.max(0, source.top_p));
  if (typeof source.max_tokens === "number") clean.max_tokens = Math.min(8192, Math.max(1, Math.floor(source.max_tokens)));
  if (typeof source.max_completion_tokens === "number") clean.max_completion_tokens = Math.min(8192, Math.max(1, Math.floor(source.max_completion_tokens)));

  return clean;
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
    const model = String(payload.model || "").trim();
    const messages = validateMessages(payload.messages);

    if (!model || model.length > 200) {
      return json(400, { error: "Request requires a valid model" });
    }

    const upstream = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(endpoint, apiKey)
      },
      body: JSON.stringify({
        model,
        messages,
        ...sanitizeParams(payload.params)
      })
    });

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
