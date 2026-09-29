// Local test harness: serves public/, runs the edge functions under Node,
// and (with MOCK=1) fakes the Anthropic API so the UI can be tested without credits.
//   APP_PASSWORD=test MOCK=1 node test/dev-server.mjs
//   APP_PASSWORD=test ANTHROPIC_API_KEY=sk-... node test/dev-server.mjs   (real API)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT || 8888);
const MOCK_PORT = PORT + 1;
export const received = [];

if (process.env.MOCK) {
  process.env.ANTHROPIC_API_KEY ||= "mock-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
}
globalThis.Netlify = { env: { get: (k) => process.env[k] } };

const routes = {
  "/api/chat": (await import(join(root, "netlify/edge-functions/chat.js"))).default,
  "/api/models": (await import(join(root, "netlify/edge-functions/models.js"))).default,
  "/api/auth": (await import(join(root, "netlify/edge-functions/auth.js"))).default,
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

async function toWebRequest(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body });
}
async function sendWebResponse(res, r) {
  res.writeHead(r.status, Object.fromEntries(r.headers));
  if (r.body) for await (const chunk of r.body) res.write(chunk);
  res.end();
}

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (routes[path]) return sendWebResponse(res, await routes[path](await toWebRequest(req)));
  const file = normalize(join(root, "public", path === "/" ? "index.html" : path));
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(PORT, () => console.log(`Claude Nexus dev server: http://localhost:${PORT}`));

// ---------------- Mock Anthropic API ----------------
if (process.env.MOCK) {
  const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    if (req.url.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [
        { id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
        { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
        { id: "claude-mock-legacy", display_name: "Mock Legacy (manual thinking)" },
      ] }));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    received.push(body);
    console.log("[mock] request:", JSON.stringify({ model: body.model, thinking: body.thinking, output_config: body.output_config, tools: body.tools, max_tokens: body.max_tokens, n: body.messages.length, lastRole: body.messages.at(-1).role, lastTypes: body.messages.at(-1).content.map((b) => b.type + (b.cache_control ? "*" : "")) }));
    if (req.headers["x-api-key"] !== process.env.ANTHROPIC_API_KEY) { res.writeHead(401); return res.end(JSON.stringify({ error: { type: "authentication_error", message: "invalid x-api-key" } })); }
    if (body.model === "claude-mock-legacy" && body.thinking?.type === "adaptive") {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "thinking.type: adaptive thinking is not supported on this model" } }));
    }
    const lastText = body.messages.at(-1).content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
    res.writeHead(200, { "content-type": "text/event-stream" });
    sse(res, "message_start", { message: { id: "msg_1", usage: { input_tokens: 1200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } });
    let i = 0;
    if (body.thinking) {
      sse(res, "content_block_start", { index: i, content_block: { type: "thinking", thinking: "" } });
      for (const w of "The user wants a demo. I'll show markdown, code and math.".split(" ")) { sse(res, "content_block_delta", { index: i, delta: { type: "thinking_delta", thinking: w + " " } }); await sleep(15); }
      sse(res, "content_block_delta", { index: i, delta: { type: "signature_delta", signature: "sig" } });
      sse(res, "content_block_stop", { index: i }); i++;
    }
    if (body.tools?.length) {
      sse(res, "content_block_start", { index: i, content_block: { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} } });
      sse(res, "content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: '{"query":"latest Deriv API news"}' } });
      sse(res, "content_block_stop", { index: i }); i++;
      sse(res, "content_block_start", { index: i, content_block: { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://example.com/a", title: "Example A" }, { type: "web_search_result", url: "https://example.org/b", title: "Example B" }] } });
      sse(res, "content_block_stop", { index: i }); i++;
      sse(res, "content_block_start", { index: i, content_block: { type: "text", text: "", citations: [] } });
      sse(res, "content_block_delta", { index: i, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://example.com/a", title: "Example A", cited_text: "..." } } });
      sse(res, "content_block_delta", { index: i, delta: { type: "text_delta", text: "According to a search result, the news is good. " } });
      sse(res, "content_block_stop", { index: i }); i++;
    }
    const reply = `You said: **${lastText.slice(0, 80)}**\n\n## A heading\n\n- item one\n- item \`two\`\n\n| Col A | Col B |\n|---|---|\n| 1 | 2 |\n\nInline math $E = mc^2$ and a price of $5 and $10.\n\n$$\\int_0^1 x^2\\,dx = \\tfrac{1}{3}$$\n\n\`\`\`python\ndef hello(name):\n    return f"Hi {name}"  # $not math$\n\`\`\`\n\nDone.`;
    sse(res, "content_block_start", { index: i, content_block: { type: "text", text: "" } });
    for (const piece of reply.match(/[\s\S]{1,6}/g)) { sse(res, "content_block_delta", { index: i, delta: { type: "text_delta", text: piece } }); await sleep(8); }
    sse(res, "content_block_stop", { index: i });
    sse(res, "message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 321 } });
    sse(res, "message_stop", {});
    res.end();
  }).listen(MOCK_PORT, () => console.log(`Mock Anthropic API: http://127.0.0.1:${MOCK_PORT}`));
}
