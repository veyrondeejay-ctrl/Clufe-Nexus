/* Claude Nexus — a personal Claude chat client for your own Anthropic API key. */
(() => {
  "use strict";

  // ---------- Defaults ----------
  const DEFAULT_MODEL = "claude-opus-5-5";
  const FALLBACK_MODELS = [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ];
  const DEFAULT_SYSTEM =
    "You are Claude, an AI assistant made by Anthropic. You are being accessed through Claude Nexus, " +
    "a personal chat app that connects to the Anthropic API. The current date is {date}.\n\n" +
    "Be genuinely helpful, direct and thoughtful. Use Markdown formatting (headings, lists, tables, " +
    "fenced code blocks with a language tag, and LaTeX math between $…$ or $$…$$) when it makes a reply clearer; " +
    "keep casual replies conversational.";
  const DEFAULTS = {
    model: DEFAULT_MODEL,
    thinking: "medium",
    webSearch: false,
    maxTokens: 32000,
    system: DEFAULT_SYSTEM,
    theme: "system",
  };
  const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|cfg|conf|log|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|sql|r|m|lua|pl|dart|scala|vue|svelte|env|gitignore|dockerfile|tex|bib|srt|vtt|mq4|mq5|mqh|pine)$/i;

  // ---------- Small utils ----------
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };
  const ICON = {
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
    retry: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  };

  // ---------- Settings & auth ----------
  let settings = { ...DEFAULTS, ...store.get("nexus.settings", {}) };
  const saveSettings = () => store.set("nexus.settings", settings);
  const getPassword = () => { try { return localStorage.getItem("nexus.pw") || sessionStorage.getItem("nexus.pw") || ""; } catch (_) { return memPassword; } };
  let memPassword = "";
  function setPassword(pw, remember) {
    memPassword = pw;
    try {
      localStorage.removeItem("nexus.pw"); sessionStorage.removeItem("nexus.pw");
      (remember ? localStorage : sessionStorage).setItem("nexus.pw", pw);
    } catch (_) { /* memory only */ }
  }

  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", settings.theme);
    const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const l = $("#hljs-light"), d = $("#hljs-dark");
    if (l && d) { l.disabled = dark; d.disabled = !dark; }
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

  async function api(path, opts = {}) {
    const headers = { "content-type": "application/json", "x-nexus-password": getPassword() || memPassword, ...(opts.headers || {}) };
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) { showLogin("Session locked — enter your password again."); }
    return res;
  }

  // ---------- Storage (IndexedDB, with localStorage fallback) ----------
  const db = {
    handle: null,
    async open() {
      if (!("indexedDB" in window)) return;
      this.handle = await new Promise((resolve) => {
        try {
          const req = indexedDB.open("claude-nexus", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("chats", { keyPath: "id" });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
      });
    },
    async all() {
      if (!this.handle) return store.get("nexus.chats", []);
      return new Promise((resolve) => {
        const r = this.handle.transaction("chats").objectStore("chats").getAll();
        r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]);
      });
    },
    async put(chat) {
      const clean = JSON.parse(JSON.stringify(chat, (k, v) => (k.startsWith("_") ? undefined : v)));
      if (!this.handle) { const list = [...chats.values()].map((c) => (c.id === chat.id ? clean : c)); store.set("nexus.chats", list); return; }
      return new Promise((resolve) => {
        const tx = this.handle.transaction("chats", "readwrite");
        tx.objectStore("chats").put(clean); tx.oncomplete = resolve; tx.onerror = () => { toast("Couldn't save chat (storage full?)"); resolve(); };
      });
    },
    async remove(id) {
      if (!this.handle) { store.set("nexus.chats", [...chats.values()].filter((c) => c.id !== id)); return; }
      return new Promise((resolve) => { const tx = this.handle.transaction("chats", "readwrite"); tx.objectStore("chats").delete(id); tx.oncomplete = resolve; tx.onerror = resolve; });
    },
  };

  // ---------- State ----------
  const chats = new Map();
  let currentId = null;
  let pending = []; // attachments waiting in the composer
  let streaming = null; // { ctrl, chatId }
  let models = [];

  const current = () => chats.get(currentId) || null;

  // ---------- Toast ----------
  let toastTimer;
  function toast(text) {
    const t = $("#toast"); t.textContent = text; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // ---------- Login ----------
  function showLogin(msg = "") {
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
    $("#login-error").textContent = msg;
    setTimeout(() => $("#login-password").focus(), 50);
  }
  async function tryUnlock(pw) {
    const res = await fetch("/api/auth", { method: "POST", headers: { "x-nexus-password": pw } }).catch(() => null);
    if (!res) return { ok: false, error: "Couldn't reach the server." };
    const j = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, apiKeyConfigured: j.apiKeyConfigured };
    return { ok: false, error: j.error || `Error ${res.status}` };
  }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#login-password").value;
    const btn = e.submitter || $("#login-form button"); btn.disabled = true;
    const r = await tryUnlock(pw);
    btn.disabled = false;
    if (!r.ok) { $("#login-error").textContent = r.error; return; }
    setPassword(pw, $("#login-remember").checked);
    $("#login-password").value = "";
    await enterApp();
    if (r.apiKeyConfigured === false) toast("ANTHROPIC_API_KEY isn't set on the server yet.");
  });

  // ---------- Markdown ----------
  if (window.DOMPurify) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
    });
  }
  function renderMath(tex, display) {
    try { if (window.katex) return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "htmlAndMathml" }); } catch (_) { /* fallthrough */ }
    return `<code>${escapeHtml(display ? `$$${tex}$$` : `$${tex}$`)}</code>`;
  }
  function renderMarkdown(src) {
    if (!window.marked || !window.DOMPurify) return `<p>${escapeHtml(src).replace(/\n/g, "<br>")}</p>`;
    const codes = []; const maths = [];
    let s = src.replace(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g, (m) => { codes.push(m); return `${codes.length - 1}`; });
    s = s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (m, a, b) => { maths.push([a ?? b, true]); return `${maths.length - 1}`; });
    s = s.replace(/\\\(([\s\S]+?)\\\)|\$(?![\s\d])([^\n$]+?)(?<!\s)\$(?!\d)/g, (m, a, b) => { maths.push([a ?? b, false]); return `${maths.length - 1}`; });
    s = s.replace(/(\d+)/g, (m, i) => codes[+i]);
    let html = DOMPurify.sanitize(marked.parse(s, { gfm: true, breaks: false }));
    html = html.replace(/(\d+)/g, (m, i) => renderMath(maths[+i][0], maths[+i][1]));
    return html;
  }
  function enhanceCode(container, highlight) {
    container.querySelectorAll("pre > code").forEach((code) => {
      const pre = code.parentElement;
      if (pre.parentElement.classList.contains("code-block")) return;
      const lang = ((code.className.match(/language-([\w+#.-]+)/) || [])[1] || "").toLowerCase();
      const wrap = el("div", "code-block");
      const head = el("div", "code-head", `<span>${escapeHtml(lang || "code")}</span>`);
      const btn = el("button", null, "Copy"); btn.type = "button";
      btn.onclick = () => copyText(code.textContent, btn);
      head.appendChild(btn);
      pre.replaceWith(wrap); wrap.append(head, pre);
      if (highlight && window.hljs) {
        try {
          if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(code.textContent, { language: lang, ignoreIllegals: true }).value;
          else if (code.textContent.length < 20000) code.innerHTML = hljs.highlightAuto(code.textContent).value;
          code.classList.add("hljs");
        } catch (_) { /* ignore */ }
      }
    });
  }
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch (_) {
      const ta = el("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    if (btn) {
      const old = btn.innerHTML; btn.innerHTML = btn.textContent === "Copy" ? "Copied" : ICON.check;
      setTimeout(() => { btn.innerHTML = old; }, 1400);
    } else toast("Copied");
  }

  // ---------- Sidebar ----------
  function groupLabel(ts) {
    const d = new Date(ts); const now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = (day(now) - day(d)) / 86400000;
    if (diff < 1) return "Today";
    if (diff < 2) return "Yesterday";
    if (diff < 8) return "Previous 7 days";
    if (diff < 31) return "Previous 30 days";
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }
  function renderSidebar() {
    const list = $("#chat-list"); list.innerHTML = "";
    const q = $("#search").value.trim().toLowerCase();
    const items = [...chats.values()]
      .filter((c) => !q || (c.title || "").toLowerCase().includes(q) || c.messages.some((m) => (m.text || "").toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (!items.length) { list.appendChild(el("div", "chat-group", q ? "No matching chats" : "No chats yet")); return; }
    let last = "";
    for (const c of items) {
      const g = groupLabel(c.updatedAt);
      if (g !== last) { list.appendChild(el("div", "chat-group", escapeHtml(g))); last = g; }
      const item = el("div", "chat-item" + (c.id === currentId ? " active" : ""));
      item.innerHTML = `<span class="t">${escapeHtml(c.title || "New chat")}</span><span class="acts">
        <button class="icon-btn" data-a="rename" title="Rename" aria-label="Rename">${ICON.pencil}</button>
        <button class="icon-btn" data-a="delete" title="Delete" aria-label="Delete">${ICON.trash}</button></span>`;
      item.onclick = (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a === "delete") { e.stopPropagation(); deleteChat(c.id); return; }
        if (a === "rename") { e.stopPropagation(); renameInline(item, c); return; }
        openChat(c.id); closeSidebar();
      };
      list.appendChild(item);
    }
  }
  function renameInline(item, chat) {
    const input = el("input"); input.value = chat.title || "";
    item.innerHTML = ""; item.appendChild(input); input.focus(); input.select();
    const done = async (save) => {
      if (save && input.value.trim()) { chat.title = input.value.trim(); await db.put(chat); }
      renderSidebar(); updateTitle();
    };
    input.onkeydown = (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
    input.onblur = () => done(true);
    input.onclick = (e) => e.stopPropagation();
  }
  async function deleteChat(id) {
    const c = chats.get(id);
    if (!confirm(`Delete "${c?.title || "this chat"}"?`)) return;
    if (streaming?.chatId === id) streaming.ctrl.abort();
    chats.delete(id); await db.remove(id);
    if (currentId === id) newChat(); else renderSidebar();
  }
  const openSidebar = () => $("#app").classList.add("sidebar-open");
  const closeSidebar = () => $("#app").classList.remove("sidebar-open");

  // ---------- Chat view ----------
  function updateTitle() {
    const c = current();
    $("#chat-title").textContent = c ? c.title || "" : "";
    document.title = c?.title ? `${c.title} · Claude Nexus` : "Claude Nexus";
  }
  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? "Burning the midnight oil?" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }
  function newChat() {
    currentId = null;
    renderMessages(); renderSidebar(); updateTitle();
    $("#input").focus();
  }
  function openChat(id) {
    currentId = id;
    const c = current();
    if (c?.model && models.some((m) => m.id === c.model)) { $("#model").value = c.model; }
    renderMessages(); renderSidebar(); updateTitle();
    scrollToBottom(true);
  }

  function renderMessages() {
    const box = $("#messages"); box.innerHTML = "";
    const c = current();
    const empty = !c || c.messages.length === 0;
    $("#welcome").classList.toggle("hidden", !empty);
    if (empty) { $("#greeting").textContent = greeting(); return; }
    c.messages.forEach((m, i) => box.appendChild(renderMessage(c, m, i === c.messages.length - 1)));
  }

  function renderMessage(chat, m, isLast) {
    if (m.role === "user") return renderUser(chat, m);
    const wrap = el("div", "msg assistant" + (isLast ? " last" : ""));
    wrap.dataset.id = m.id;
    fillAssistant(wrap, chat, m, false);
    return wrap;
  }

  function renderUser(chat, m) {
    const wrap = el("div", "msg user"); wrap.dataset.id = m.id;
    if (m.attachments?.length) {
      const files = el("div", "files");
      for (const a of m.attachments) {
        if (a.kind === "image" && a.data) { const img = el("img"); img.src = `data:${a.mediaType};base64,${a.data}`; img.alt = a.name; files.appendChild(img); }
        else files.appendChild(el("span", "file-pill", `${ICON.file}<span>${escapeHtml(a.name)}</span>`));
      }
      wrap.appendChild(files);
    }
    if (m.text) wrap.appendChild(el("div", "bubble", escapeHtml(m.text)));
    const acts = el("div", "msg-actions");
    const copy = el("button", "icon-btn", ICON.copy); copy.title = "Copy"; copy.onclick = () => copyText(m.text, copy);
    const edit = el("button", "icon-btn", ICON.edit); edit.title = "Edit"; edit.onclick = () => startEdit(chat, m, wrap);
    acts.append(copy, edit); wrap.appendChild(acts);
    return wrap;
  }

  function startEdit(chat, m, wrap) {
    if (streaming) { toast("Wait for the reply to finish, or stop it first."); return; }
    const box = el("div", "edit-box");
    const ta = el("textarea"); ta.value = m.text || "";
    const row = el("div", "row");
    const cancel = el("button", "btn ghost", "Cancel"); cancel.type = "button";
    const save = el("button", "btn primary", "Send"); save.type = "button";
    row.append(cancel, save); box.append(ta, row);
    wrap.querySelector(".bubble")?.remove(); wrap.querySelector(".msg-actions")?.remove();
    wrap.appendChild(box); ta.focus();
    cancel.onclick = () => renderMessages();
    save.onclick = async () => {
      const idx = chat.messages.indexOf(m);
      m.text = ta.value.trim();
      chat.messages = chat.messages.slice(0, idx + 1);
      await startReply(chat);
    };
    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !isTouch()) { e.preventDefault(); save.click(); } };
  }

  function fillAssistant(wrap, chat, m, live) {
    const openThinking = wrap.querySelector("details.thinking")?.open;
    const scrollState = wrap.querySelector(".thinking-body")?.scrollTop;
    wrap.innerHTML = "";

    if (m.searches?.length) {
      const act = el("div", "activity");
      for (const s of m.searches) {
        act.appendChild(el("span", "tag", `${ICON.globe}<span>${escapeHtml(s.query || "Searching…")}${s.count != null ? ` · ${s.count} results` : ""}</span>`));
      }
      wrap.appendChild(act);
    }

    if (m.thinking || (live && m._phase === "thinking")) {
      const d = el("details", "thinking");
      const secs = m.thinkMs ? Math.max(1, Math.round(m.thinkMs / 1000)) : null;
      const label = live && m._phase === "thinking" ? "Thinking…" : secs ? `Thought for ${secs}s` : "Thoughts";
      d.innerHTML = `<summary>${label}</summary>`;
      const body = el("div", "thinking-body"); body.textContent = m.thinking || "";
      d.appendChild(body);
      if (openThinking) d.open = true;
      wrap.appendChild(d);
      if (scrollState != null) body.scrollTop = live ? body.scrollHeight : scrollState;
    }

    const body = el("div", "body" + (live ? " cursor-host" : ""));
    if (m.text) body.innerHTML = renderMarkdown(m.text);
    else if (live && m._phase !== "thinking") body.innerHTML = "";
    enhanceCode(body, !live);
    if (live) {
      const dot = el("span", "cursor");
      const lastBlock = body.lastElementChild;
      if (lastBlock && /^(P|LI|H\d)$/.test(lastBlock.tagName)) lastBlock.appendChild(dot);
      else if (lastBlock?.tagName === "UL" || lastBlock?.tagName === "OL") (lastBlock.lastElementChild || lastBlock).appendChild(dot);
      else body.appendChild(dot);
    }
    wrap.appendChild(body);

    if (m.sources?.length) {
      const src = el("div", "sources");
      for (const s of m.sources.slice(0, 12)) {
        const a = el("a"); a.href = s.url; a.target = "_blank"; a.rel = "noopener noreferrer";
        let host = s.url; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch (_) { /* keep */ }
        a.textContent = s.title ? `${host} · ${s.title}` : host; a.title = s.title || s.url;
        src.appendChild(a);
      }
      wrap.appendChild(src);
    }

    if (!live) {
      const notice = noticeFor(m);
      if (notice) wrap.appendChild(notice);
      const acts = el("div", "msg-actions");
      const copy = el("button", "icon-btn", ICON.copy); copy.title = "Copy"; copy.onclick = () => copyText(m.text || "", copy);
      acts.appendChild(copy);
      const isLast = chat.messages[chat.messages.length - 1] === m;
      if (isLast) {
        const retry = el("button", "icon-btn", ICON.retry); retry.title = "Retry";
        retry.onclick = () => regenerate(chat);
        acts.appendChild(retry);
      }
      const meta = [];
      if (m.model) meta.push(prettyModel(m.model));
      if (m.usage) meta.push(`${fmt(m.usage.input)} in · ${fmt(m.usage.output)} out`);
      if (meta.length) acts.appendChild(el("span", "meta", escapeHtml(meta.join(" · "))));
      wrap.appendChild(acts);
    }
  }

  function noticeFor(m) {
    let text = null; let err = false; let action = null;
    if (m.error) { text = m.error; err = true; action = "Retry"; }
    else if (m.stopped) text = "You stopped this reply.";
    else if (m.stopReason === "max_tokens") { text = "The reply hit the maximum length."; action = "Continue"; }
    else if (m.stopReason === "refusal") { text = "Claude declined to continue this reply."; }
    if (!text) return null;
    const n = el("div", "notice" + (err ? " err" : ""), `<span>${escapeHtml(text)}</span>`);
    if (action) {
      const b = el("button", "btn", action); b.type = "button";
      b.onclick = () => {
        const chat = current(); if (!chat) return;
        if (action === "Retry") regenerate(chat);
        else sendMessage("Continue exactly where you left off.", []);
      };
      n.appendChild(b);
    }
    return n;
  }

  const fmt = (n) => (n == null ? "?" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const prettyModel = (id) => models.find((x) => x.id === id)?.name || id;

  // ---------- Scrolling ----------
  let stickToBottom = true;
  $("#messages").addEventListener("scroll", () => {
    const b = $("#messages");
    stickToBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
  });
  function scrollToBottom(force) {
    const b = $("#messages");
    if (force || stickToBottom) b.scrollTop = b.scrollHeight;
  }

  // ---------- Attachments ----------
  const isTouch = () => matchMedia("(pointer: coarse)").matches;
  function readAs(file, how) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result); r.onerror = () => reject(r.error);
      how === "text" ? r.readAsText(file) : r.readAsDataURL(file);
    });
  }
  async function processImage(file) {
    const dataUrl = await readAs(file, "dataurl");
    if (file.type === "image/gif") return { mediaType: "image/gif", data: dataUrl.split(",")[1] };
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const maxSide = 1568;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && IMAGE_TYPES.includes(file.type)) {
      return { mediaType: file.type, data: dataUrl.split(",")[1] };
    }
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    const keepPng = file.type === "image/png" && file.size < 3 * 1024 * 1024;
    if (!keepPng) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const type = keepPng ? "image/png" : "image/jpeg";
    return { mediaType: type, data: c.toDataURL(type, 0.9).split(",")[1] };
  }
  async function addFiles(fileList) {
    for (const file of fileList) {
      try {
        if (file.type.startsWith("image/")) {
          const r = await processImage(file);
          pending.push({ id: uid(), kind: "image", name: file.name || "image", ...r });
        } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          if (file.size > 30 * 1024 * 1024) { toast(`${file.name} is over 30 MB`); continue; }
          const data = (await readAs(file, "dataurl")).split(",")[1];
          pending.push({ id: uid(), kind: "pdf", name: file.name, mediaType: "application/pdf", data });
        } else if (file.type.startsWith("text/") || /json|xml|javascript|yaml|csv|sql/.test(file.type) || TEXT_EXT.test(file.name)) {
          if (file.size > 3 * 1024 * 1024) { toast(`${file.name} is too large to include as text`); continue; }
          const text = await readAs(file, "text");
          pending.push({ id: uid(), kind: "text", name: file.name, text });
        } else {
          toast(`Can't read ${file.name} — try an image, PDF or text/code file.`);
        }
      } catch (e) { toast(`Couldn't read ${file.name}`); }
    }
    renderPending();
  }
  function renderPending() {
    const box = $("#attachments"); box.innerHTML = "";
    for (const a of pending) {
      const item = el("div", "att");
      if (a.kind === "image") { const img = el("img"); img.src = `data:${a.mediaType};base64,${a.data}`; img.alt = a.name; item.appendChild(img); }
      else item.appendChild(el("span", "file-pill", `${ICON.file}<span>${escapeHtml(a.name)}</span>`));
      const x = el("button", "x", ICON.x); x.type = "button"; x.title = "Remove";
      x.onclick = () => { pending = pending.filter((p) => p.id !== a.id); renderPending(); };
      item.appendChild(x); box.appendChild(item);
    }
    updateSendState();
  }

  // ---------- Building API messages ----------
  function userBlocks(m) {
    const blocks = [];
    for (const a of m.attachments || []) {
      if (a.kind === "image" && a.data) blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } });
      else if (a.kind === "pdf" && a.data) blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name });
      else if (a.kind === "text") blocks.push({ type: "text", text: `<file name="${a.name.replace(/"/g, "'")}">\n${a.text}\n</file>` });
    }
    if (m.text) blocks.push({ type: "text", text: m.text });
    if (!blocks.length) blocks.push({ type: "text", text: "(empty message)" });
    return blocks;
  }
  function toApiMessages(list) {
    const out = [];
    for (const m of list) {
      let role, content;
      if (m.role === "user") { role = "user"; content = userBlocks(m); }
      else {
        if (!m.text || !m.text.trim()) continue; // failed/empty replies are skipped
        role = "assistant"; content = [{ type: "text", text: m.text }];
      }
      const prev = out[out.length - 1];
      if (prev && prev.role === role) prev.content.push(...content);
      else out.push({ role, content });
    }
    while (out.length && out[0].role !== "user") out.shift();
    return out;
  }
  const systemPrompt = () => (settings.system || "").replace(/\{date\}/g,
    new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }));

  // ---------- Sending ----------
  async function sendMessage(text, attachments) {
    if (streaming) return;
    let chat = current();
    if (!chat) {
      chat = { id: uid(), title: "", model: $("#model").value, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      chats.set(chat.id, chat); currentId = chat.id;
    }
    const msg = { id: uid(), role: "user", text, attachments, at: Date.now() };
    chat.messages.push(msg);
    if (!chat.title) chat.title = makeTitle(text, attachments);
    stickToBottom = true;
    await startReply(chat);
  }
  function makeTitle(text, attachments) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (t) return t.length > 60 ? t.slice(0, 57).trimEnd() + "…" : t;
    return attachments?.[0]?.name || "New chat";
  }
  async function regenerate(chat) {
    if (streaming) return;
    const last = chat.messages[chat.messages.length - 1];
    if (last?.role === "assistant") chat.messages.pop();
    await startReply(chat);
  }

  async function startReply(chat) {
    const model = $("#model").value || DEFAULT_MODEL;
    chat.model = model; chat.updatedAt = Date.now();
    const history = chat.messages.slice();
    const msg = { id: uid(), role: "assistant", text: "", thinking: "", searches: [], sources: [], model, at: Date.now(), _phase: "waiting" };
    chat.messages.push(msg);
    await db.put(chat);
    renderMessages(); renderSidebar(); updateTitle();
    scrollToBottom(true);

    const wrap = $(`#messages [data-id="${msg.id}"]`);
    const ctrl = new AbortController();
    streaming = { ctrl, chatId: chat.id };
    updateSendState();

    let raf = 0;
    const paint = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const w = $(`#messages [data-id="${msg.id}"]`);
        if (w) { fillAssistant(w, chat, msg, true); scrollToBottom(); }
      });
    };
    fillAssistant(wrap, chat, msg, true);

    let continuation = null;
    try {
      for (let round = 0; round < 5; round++) {
        const messages = toApiMessages(history);
        if (continuation) messages.push({ role: "assistant", content: continuation });
        const res = await api("/api/chat", {
          method: "POST",
          signal: ctrl.signal,
          body: JSON.stringify({
            model,
            messages,
            system: systemPrompt(),
            max_tokens: settings.maxTokens,
            thinking: settings.thinking === "off" ? null : settings.thinking,
            web_search: settings.webSearch,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(friendlyError(res.status, j.error));
        }
        const result = await consumeStream(res, msg, paint);
        if (result.stopReason === "pause_turn") { continuation = (continuation || []).concat(result.blocks); continue; }
        msg.stopReason = result.stopReason;
        break;
      }
    } catch (e) {
      if (e.name === "AbortError") msg.stopped = true;
      else msg.error = e.message || String(e);
    } finally {
      if (raf) cancelAnimationFrame(raf);
      if (msg._thinkStart && !msg.thinkMs) msg.thinkMs = Date.now() - msg._thinkStart;
      delete msg._phase;
      streaming = null;
      chat.updatedAt = Date.now();
      await db.put(chat);
      if (currentId === chat.id) {
        const w = $(`#messages [data-id="${msg.id}"]`);
        if (w) fillAssistant(w, chat, msg, false);
        scrollToBottom();
      }
      renderSidebar(); updateSendState();
    }
  }

  function friendlyError(status, message) {
    const m = message || "";
    if (status === 401) return "Wrong app password.";
    if (/credit balance is too low/i.test(m)) return "Your Anthropic credit balance is too low. Add credits at console.anthropic.com → Billing.";
    if (/invalid x-api-key|authentication_error/i.test(m)) return "The ANTHROPIC_API_KEY on the server is invalid. Update it in Netlify and redeploy.";
    if (status === 429) return `Rate limited by the API — wait a moment and retry. ${m}`;
    if (status === 529 || /overloaded/i.test(m)) return "Claude's API is overloaded right now. Retry in a few seconds.";
    if (/model/i.test(m) && /not.?found|invalid/i.test(m)) return `That model isn't available to your API key: ${m}`;
    return m || `Request failed (HTTP ${status}).`;
  }

  // Parse the Anthropic SSE stream and update `msg` as tokens arrive.
  async function consumeStream(res, msg, paint) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const blocks = [];
    let stopReason = null;
    const usage = msg.usage || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    msg.usage = usage;
    let roundInput = 0;

    const handle = (ev) => {
      switch (ev.type) {
        case "message_start": {
          const u = ev.message?.usage || {};
          roundInput = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          usage.input += roundInput;
          usage.cacheRead += u.cache_read_input_tokens || 0;
          usage.cacheWrite += u.cache_creation_input_tokens || 0;
          break;
        }
        case "content_block_start": {
          const b = { ...ev.content_block };
          blocks[ev.index] = b;
          if (b.type === "thinking" || b.type === "redacted_thinking") {
            msg._phase = "thinking"; if (!msg._thinkStart) msg._thinkStart = Date.now();
            if (b.thinking) msg.thinking += b.thinking;
          } else {
            if (msg._phase === "thinking" && msg._thinkStart) msg.thinkMs = (msg.thinkMs || 0) + (Date.now() - msg._thinkStart);
            if (msg._phase === "thinking") msg._thinkStart = null;
            msg._phase = "writing";
          }
          if (b.type === "text") { b.text = b.text || ""; if (b.text) msg.text += b.text; }
          if (b.type === "server_tool_use") { b._json = ""; if (b.name === "web_search") msg.searches.push({ id: b.id, query: "" }); }
          if (b.type === "web_search_tool_result") {
            const s = msg.searches.find((x) => x.id === b.tool_use_id);
            if (s) s.count = Array.isArray(b.content) ? b.content.length : 0;
          }
          paint();
          break;
        }
        case "content_block_delta": {
          const b = blocks[ev.index]; const d = ev.delta || {};
          if (!b) break;
          if (d.type === "text_delta") { b.text += d.text; msg.text += d.text; }
          else if (d.type === "thinking_delta") { b.thinking = (b.thinking || "") + d.thinking; msg.thinking += d.thinking; }
          else if (d.type === "signature_delta") { b.signature = d.signature; }
          else if (d.type === "input_json_delta") { b._json += d.partial_json || ""; }
          else if (d.type === "citations_delta" && d.citation) {
            (b.citations = b.citations || []).push(d.citation);
            const c = d.citation;
            if (c.url && !msg.sources.some((s) => s.url === c.url)) msg.sources.push({ url: c.url, title: c.title || "" });
          }
          paint();
          break;
        }
        case "content_block_stop": {
          const b = blocks[ev.index];
          if (b?.type === "server_tool_use") {
            try { b.input = b._json ? JSON.parse(b._json) : (b.input || {}); } catch (_) { b.input = b.input || {}; }
            const s = msg.searches.find((x) => x.id === b.id);
            if (s && b.input?.query) s.query = b.input.query;
            paint();
          }
          break;
        }
        case "message_delta":
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
          if (ev.usage?.output_tokens != null) msg._roundOut = ev.usage.output_tokens;
          break;
        case "message_stop":
          usage.output += msg._roundOut || 0; msg._roundOut = 0;
          break;
        case "error":
          throw new Error(friendlyError(0, ev.error?.message || "The stream was interrupted."));
        default: break;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
        const data = chunk.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        let ev; try { ev = JSON.parse(data); } catch (_) { continue; }
        handle(ev);
      }
    }
    if (msg._roundOut) { usage.output += msg._roundOut; msg._roundOut = 0; }
    const clean = blocks.filter(Boolean).map((b) => {
      const { _json, ...rest } = b;
      if (rest.type === "server_tool_use" && !rest.input) rest.input = {};
      return rest;
    });
    if (!stopReason && !msg.text) throw new Error("The connection closed before Claude replied. Please retry.");
    return { stopReason, blocks: clean };
  }

  // ---------- Composer ----------
  const input = $("#input");
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.4) + "px"; }
  function updateSendState() {
    const btn = $("#send");
    btn.classList.toggle("stop", !!streaming);
    btn.title = streaming ? "Stop" : "Send (Enter)";
    btn.setAttribute("aria-label", streaming ? "Stop" : "Send");
    btn.disabled = !streaming && !input.value.trim() && pending.length === 0;
  }
  input.addEventListener("input", () => { autosize(); updateSendState(); store.set("nexus.draft", input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !isTouch()) { e.preventDefault(); $("#composer").requestSubmit(); }
  });
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (streaming) { streaming.ctrl.abort(); return; }
    const text = input.value.trim();
    if (!text && !pending.length) return;
    const atts = pending; pending = [];
    input.value = ""; store.del("nexus.draft"); autosize(); renderPending();
    sendMessage(text, atts);
  });
  $("#file-input").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });

  // Drag & drop
  let dragDepth = 0;
  const main = $(".main");
  main.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { dragDepth++; $("#drop-overlay").classList.remove("hidden"); } });
  main.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("#drop-overlay").classList.add("hidden"); });
  main.addEventListener("dragover", (e) => e.preventDefault());
  main.addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; $("#drop-overlay").classList.add("hidden"); if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });

  // Toggles
  const searchBtn = $("#toggle-search");
  function syncToggles() {
    searchBtn.setAttribute("aria-pressed", String(!!settings.webSearch));
    $("#thinking").value = settings.thinking;
    $("#thinking").closest(".chip").classList.toggle("on", settings.thinking !== "off");
  }
  searchBtn.onclick = () => { settings.webSearch = !settings.webSearch; saveSettings(); syncToggles(); };
  $("#thinking").onchange = (e) => { settings.thinking = e.target.value; saveSettings(); syncToggles(); };
  $("#model").onchange = (e) => {
    settings.model = e.target.value; saveSettings();
    const c = current(); if (c) { c.model = settings.model; db.put(c); }
  };

  // ---------- Models ----------
  async function loadModels() {
    let list = [];
    try {
      const res = await api("/api/models");
      if (res.ok) list = (await res.json()).models || [];
    } catch (_) { /* fallback */ }
    if (!list.length) list = FALLBACK_MODELS.slice();
    if (!list.some((m) => m.id === DEFAULT_MODEL)) list.unshift({ id: DEFAULT_MODEL, name: "Claude Opus 5.5" });
    models = list;
    const sel = $("#model"); sel.innerHTML = "";
    for (const m of list) { const o = el("option"); o.value = m.id; o.textContent = m.name; sel.appendChild(o); }
    sel.value = list.some((m) => m.id === settings.model) ? settings.model : DEFAULT_MODEL;
  }

  // ---------- Settings dialog ----------
  const dlg = $("#settings");
  $("#open-settings").onclick = () => {
    $("#set-system").value = settings.system;
    $("#set-max-tokens").value = settings.maxTokens;
    $("#set-theme").value = settings.theme;
    let inT = 0, outT = 0, cached = 0, replies = 0;
    for (const c of chats.values()) for (const m of c.messages) if (m.usage) { inT += m.usage.input || 0; outT += m.usage.output || 0; cached += m.usage.cacheRead || 0; replies++; }
    $("#usage-summary").textContent = `${replies} replies saved in this browser · ${fmt(inT)} input tokens (${fmt(cached)} from cache) · ${fmt(outT)} output tokens. Exact costs are in console.anthropic.com → Usage.`;
    closeSidebar();
    dlg.showModal();
  };
  $("#save-settings").onclick = (e) => {
    e.preventDefault();
    settings.system = $("#set-system").value;
    settings.maxTokens = Math.min(128000, Math.max(256, parseInt($("#set-max-tokens").value, 10) || DEFAULTS.maxTokens));
    settings.theme = $("#set-theme").value;
    saveSettings(); applyTheme(); dlg.close(); toast("Settings saved");
  };
  $("#reset-settings").onclick = () => {
    $("#set-system").value = DEFAULTS.system; $("#set-max-tokens").value = DEFAULTS.maxTokens; $("#set-theme").value = DEFAULTS.theme;
  };
  $("#lock").onclick = () => { store.del("nexus.pw"); memPassword = ""; dlg.close(); showLogin(); };
  $("#export-chats").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "claude-nexus", version: 1, exportedAt: new Date().toISOString(), chats: [...chats.values()] }, null, 2)], { type: "application/json" });
    const a = el("a"); a.href = URL.createObjectURL(blob); a.download = `claude-nexus-chats-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#import-chats").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data.chats;
      let n = 0;
      for (const c of list || []) { if (c?.id && Array.isArray(c.messages)) { chats.set(c.id, c); await db.put(c); n++; } }
      renderSidebar(); toast(`Imported ${n} chat${n === 1 ? "" : "s"}`);
    } catch (_) { toast("That file isn't a Claude Nexus export."); }
  };
  $("#delete-all").onclick = async () => {
    if (!confirm("Delete ALL chats in this browser? This can't be undone.")) return;
    for (const id of [...chats.keys()]) await db.remove(id);
    chats.clear(); dlg.close(); newChat();
  };

  // ---------- Wiring ----------
  $("#new-chat").onclick = () => { newChat(); closeSidebar(); };
  $("#new-chat-top").onclick = () => newChat();
  $("#open-sidebar").onclick = openSidebar;
  $("#close-sidebar").onclick = closeSidebar;
  $("#scrim").onclick = closeSidebar;
  $("#search").addEventListener("input", renderSidebar);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); newChat(); }
    if (e.key === "Escape" && streaming && document.activeElement === input) streaming.ctrl.abort();
  });

  async function enterApp() {
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await loadModels();
    syncToggles();
    renderSidebar(); renderMessages(); updateTitle();
    const draft = store.get("nexus.draft", "");
    if (draft && !input.value) input.value = draft;
    autosize(); updateSendState();
    if (!isTouch()) input.focus();
  }

  async function boot() {
    applyTheme();
    await db.open();
    for (const c of await db.all()) chats.set(c.id, c);
    const pw = getPassword();
    if (!pw) { showLogin(); return; }
    const r = await tryUnlock(pw);
    if (!r.ok) { showLogin(r.error === "Wrong password." ? "" : r.error); return; }
    await enterApp();
  }
  boot();
})();
