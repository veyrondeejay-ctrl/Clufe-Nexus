// Shared helpers for the Claude Nexus edge functions.
// Runs on Netlify Edge (Deno). Uses only standard web APIs.

export function env(name) {
  try {
    if (globalThis.Netlify?.env?.get) return globalThis.Netlify.env.get(name);
  } catch (_) { /* ignore */ }
  try {
    if (globalThis.Deno?.env?.get) return globalThis.Deno.env.get(name);
  } catch (_) { /* ignore */ }
  return undefined;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Returns a Response if the request is NOT allowed, otherwise null.
export function checkAuth(req) {
  const expected = env("APP_PASSWORD");
  if (!expected) {
    return json({
      error: "APP_PASSWORD is not set. Add it in Netlify → Site configuration → Environment variables, then redeploy.",
      code: "no_password_configured",
    }, 500);
  }
  const given = req.headers.get("x-nexus-password") || "";
  if (!safeEqual(given, expected)) {
    return json({ error: "Wrong password.", code: "unauthorized" }, 401);
  }
  return null;
}

export function apiKey() {
  return env("ANTHROPIC_API_KEY");
}

export function apiBase() {
  return (env("ANTHROPIC_BASE_URL") || "https://api.anthropic.com").replace(/\/$/, "");
}

export function anthropicHeaders(key) {
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
}

export async function readError(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return { message: j?.error?.message || text, type: j?.error?.type, raw: text };
  } catch (_) {
    return { message: text || res.statusText, type: undefined, raw: text };
  }
}
