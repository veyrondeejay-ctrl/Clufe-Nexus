// GET /api/models — lists the Claude models your API key can use.
import { anthropicHeaders, apiBase, apiKey, checkAuth, json, readError } from "../lib/common.js";

export default async (req) => {
  const denied = checkAuth(req);
  if (denied) return denied;
  const key = apiKey();
  if (!key) return json({ error: "ANTHROPIC_API_KEY is not set." }, 500);

  const res = await fetch(`${apiBase()}/v1/models?limit=100`, { headers: anthropicHeaders(key) });
  if (!res.ok) {
    const err = await readError(res);
    return json({ error: err.message }, res.status);
  }
  const data = await res.json();
  const models = (data.data || []).map((m) => ({
    id: m.id,
    name: m.display_name || m.id,
    created_at: m.created_at,
  }));
  return json({ models });
};

export const config = { path: "/api/models" };
