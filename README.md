# Claude Nexus

Your own private Claude chat app that runs on **your Anthropic API key**. When your claude.ai usage limit runs out, open Claude Nexus and keep going. You pay per token from your API credits.

- Streaming replies with a Claude-style interface in light and dark mode, on desktop and mobile
- **Default model: Claude Opus 5.5 with medium thinking**, with a model picker that lists every model your key can use
- Extended thinking at Off, Low, Medium, or High, plus a web search toggle with cited sources
- Attach images, PDFs, and text or code files by picking them, dragging them in, or pasting
- Markdown, tables, syntax-highlighted code with copy buttons, and LaTeX math
- Chat history with search, rename, delete, edit and resend, retry, and stop
- Export and import your chats as JSON
- Prompt caching turned on automatically, so long chats cost less
- A password lock, so only you can spend your credits

## How it works

```
Browser (public/)  ──►  Netlify Edge Function (/api/chat)  ──►  api.anthropic.com
                        adds your API key server-side
```

Your API key lives only in a Netlify environment variable. It never goes to the browser and it's never committed to Git. Chats are stored in your browser (IndexedDB), so each device keeps its own history. Use **Settings → Export/Import** to move chats between devices.

There's no build step and there are no npm dependencies.

## Deploy on Netlify (about 5 minutes)

1. **Get an API key.** Go to [console.anthropic.com](https://console.anthropic.com) → *API Keys* → *Create key*, and add credits under *Billing*.
2. **Import the repo.** In [app.netlify.com](https://app.netlify.com), go to *Add new project* → *Import an existing project* → *GitHub* and pick this repo. Leave the build command empty. The publish directory is `public`, which `netlify.toml` already sets.
3. **Add environment variables.** Under *Project configuration → Environment variables*, add:

   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your `sk-ant-…` key |
   | `APP_PASSWORD` | a strong password you'll type to unlock the app |

4. **Redeploy.** Go to *Deploys* → *Trigger deploy* → *Deploy site*, so the functions pick up the variables.
5. Open your `*.netlify.app` URL, enter your password, and start chatting.

> Change the API key or password any time in Netlify's environment variables, then redeploy.

## Settings

- **Model / Thinking / Web search**: set these from the chat screen. They're remembered per browser.
- **System prompt**: edit it in Settings. `{date}` is replaced with today's date.
- **Max reply length**: defaults to 32,000 tokens. You're only billed for tokens actually generated.

## Run locally (optional)

Requires Node 18 or later.

```bash
# UI test with a fake API (no credits used)
APP_PASSWORD=test MOCK=1 node test/dev-server.mjs
# Real API
APP_PASSWORD=test ANTHROPIC_API_KEY=sk-ant-... node test/dev-server.mjs
```

Then open http://localhost:8888.

## Notes

- **Billing is separate from claude.ai.** API usage draws from your Console credits, not your Pro/Max plan. Check costs in the Console under *Usage*.
- **claude.ai-only features don't carry over.** Projects, memory, connectors, and artifacts aren't in the API, so they aren't here.
- **Thinking mode switches automatically.** Newer models use adaptive thinking (`effort`) and older ones use a token budget. If a model rejects one mode, the server retries with the other.
- **Large uploads.** Very large PDFs, or many images in one chat, make each request bigger and more expensive because the whole conversation is re-sent every turn. Caching reduces that cost.
