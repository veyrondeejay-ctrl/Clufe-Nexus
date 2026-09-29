// POST /api/chat — streams a Claude reply from the Anthropic Messages API.
// The API key stays on the server (ANTHROPIC_API_KEY env var); the browser never sees it.
import {
  anthropicHeaders, apiBase, apiKey, checkAuth, json, readError,
} from "../lib/common.js";

const EFFORTS = ["low", "medium", "high"];
const MANUAL_BUDGET = { low: 4000, medium: 12000, high: 28000 };
const WEB_SEARCH_TYPES = ["web_search_20250305", "web_search_20260318"];

// Older models only support manual thinking budgets; newer ones use adaptive thinking.
// If this guess is wrong for a model, the retry below switches mode automatically.
function prefersManualThinking(model) {
  return /^claude-(3|(opus|sonnet|haiku)-4-(0|1|5)(-|$)|(opus|sonnet)-4(-\d{8})?$)/.test(model);
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages must be a non-empty array");
  return messages.map((m) => {
    if (m.role !== "user" && m.role !== "assistant") throw new Error("bad role");
    const content = typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : Array.isArray(m.content) ? m.content.map((b) => ({ ...b })) : null;
    if (!content || content.length === 0) throw new Error("empty message content");
    return { role: m.role, content };
  });
}

function buildPayload(body) {
  const model = String(body.model || "claude-opus-5-5");
  const messages = cleanMessages(body.messages);
  let maxTokens = Math.min(Math.max(parseInt(body.max_tokens, 10) || 32000, 256), 128000);

  const payload = { model, max_tokens: maxTokens, stream: true, messages };

  if (typeof body.system === "string" && body.system.trim()) {
    payload.system = [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }];
  }

  // Prompt caching: mark the last block of the final user turn so long chats
  // re-read cached history at a fraction of the normal input price.
  const last = messages[messages.length - 1];
  if (last.role === "user") {
    const lb = last.content[last.content.length - 1];
    if (lb && lb.type !== "thinking" && lb.type !== "redacted_thinking") lb.cache_control = { type: "ephemeral" };
  }

  const effort = EFFORTS.includes(body.thinking) ? body.thinking : null;
  if (effort) {
    if (prefersManualThinking(model)) setManualThinking(payload, effort);
    else setAdaptiveThinking(payload, effort);
  }

  if (body.web_search) {
    payload.tools = [{ type: WEB_SEARCH_TYPES[0], name: "web_search", max_uses: 5 }];
  }
  return { payload, effort };
}

function setAdaptiveThinking(payload, effort) {
  payload.thinking = { type: "adaptive" };
  payload.output_config = { effort };
}

function setManualThinking(payload, effort) {
  delete payload.output_config;
  const budget = MANUAL_BUDGET[effort];
  payload.thinking = { type: "enabled", budget_tokens: budget };
  if (payload.max_tokens <= budget + 1024) payload.max_tokens = budget + 8000;
}

async function callAnthropic(payload, key) {
  return fetch(`${apiBase()}/v1/messages`, {
    method: "POST",
    headers: anthropicHeaders(key),
    body: JSON.stringify(payload),
  });
}

// Try to repair a 400 caused by a model/feature mismatch. Returns true if something changed.
function repair(payload, effort, message, tried) {
  const msg = message.toLowerCase();
  if (effort && /thinking|adaptive|budget_tokens|effort|output_config/.test(msg) && !tried.thinking) {
    tried.thinking = true;
    if (payload.thinking?.type === "adaptive") setManualThinking(payload, effort);
    else setAdaptiveThinking(payload, effort);
    return true;
  }
  if (payload.tools && /web_search/.test(msg) && !tried.search) {
    tried.search = true;
    payload.tools[0].type = WEB_SEARCH_TYPES[1];
    return true;
  }
  if (/max_tokens/.test(msg) && !tried.maxTokens) {
    tried.maxTokens = true;
    const m = message.match(/(\d{3,6})\s*(?:tokens)?\s*(?:for|is the|,|\.|$)/i);
    const allowed = m ? parseInt(m[1], 10) : 8192;
    payload.max_tokens = Math.max(1024, Math.min(payload.max_tokens, allowed));
    if (payload.thinking?.budget_tokens >= payload.max_tokens) {
      payload.thinking.budget_tokens = Math.max(1024, payload.max_tokens - 2048);
    }
    return true;
  }
  return false;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const denied = checkAuth(req);
  if (denied) return denied;

  const key = apiKey();
  if (!key) {
    return json({ error: "ANTHROPIC_API_KEY is not set. Add it in Netlify → Site configuration → Environment variables, then redeploy." }, 500);
  }

  let built;
  try {
    built = buildPayload(await req.json());
  } catch (e) {
    return json({ error: `Bad request: ${e.message}` }, 400);
  }
  const { payload, effort } = built;

  const tried = {};
  let upstream;
  for (let attempt = 0; attempt < 4; attempt++) {
    upstream = await callAnthropic(payload, key);
    if (upstream.ok) break;
    const err = await readError(upstream);
    if (upstream.status === 400 && repair(payload, effort, err.message, tried)) continue;
    return json({ error: err.message, type: err.type }, upstream.status);
  }
  if (!upstream.ok) return json({ error: "Request failed after retries." }, 502);

  // Pass the SSE stream straight through (keeps edge CPU use tiny).
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
};

export const config = { path: "/api/chat" };
