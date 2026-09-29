// POST /api/auth — checks the app password so the login screen can unlock.
import { apiKey, checkAuth, json } from "../lib/common.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const denied = checkAuth(req);
  if (denied) return denied;
  return json({ ok: true, apiKeyConfigured: Boolean(apiKey()) });
};

export const config = { path: "/api/auth" };
