/* Trading Desk app. Plan B: reads the AES-GCM encrypted gist bundle (key from #k=, kept in localStorage).
   Every number/URL shown comes from the bundle. FOMO URLs are used exactly as the bundle gives them. */
"use strict";
const GIST = "Roms098/89b376e2de7abda5a19e7279e6fffd70";
const LS_KEY = "desk_data_key";
const POLL_MS = 20000, STALE_S = 180;
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const GREEN = "#00d35a", RED = "#ff453a", ORANGE = "#ff9f0a", CYAN = "#64d2ff", BLUE = "#0a84ff", MUTED = "rgba(235,235,245,0.6)", SEP = "rgba(84,84,88,0.55)";
const AGENTS = ["lead", "market", "research", "strategist", "risk", "executor", "reviewer"];
const AGENT_ALIAS = { scanner: "market", auditor: "research", analyst: "strategist", desk: "lead", desk_lead: "lead" };
const canon = (n) => { const k = String(n || "").trim().toLowerCase(); return AGENT_ALIAS[k] || k; };

let RAW = null;            // last real bundle
let TEST = { coins: {}, audits: {} };   // injected test data (never from the desk)
let lastSeq = -1, tab = "home", range = "1H", openAgents = {}, stack = [];

/* ---------- crypto / data ---------- */
function b64uToBytes(b) { b = b.replace(/-/g, "+").replace(/_/g, "/"); while (b.length % 4) b += "="; const bin = atob(b), o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
function getKey() {
  const m = /[#&]k=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) { localStorage.setItem(LS_KEY, m[1]); history.replaceState(null, "", location.pathname + location.search); return m[1]; }
  return localStorage.getItem(LS_KEY) || "";
}
async function decryptBlob(k, blob) {
  const raw = b64uToBytes(blob.trim());
  const key = await crypto.subtle.importKey("raw", b64uToBytes(k), "AES-GCM", false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12))));
}
function B() {
  if (!RAW) return null;
  return { ...RAW, coins: { ...(RAW.coins || {}), ...TEST.coins }, audits: { ...(RAW.audits || {}), ...TEST.audits } };
}

/* ---------- format ---------- */
const money = (v, d = 2) => (v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (v) => (v >= 0 ? "+" : "-");
const pct = (v) => sgn(v) + Math.abs(v).toFixed(2) + "%";
const hhmm = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? Math.round(s) + "s" : s < 5400 ? Math.round(s / 60) + "m" : Math.round(s / 3600) + "h"; };
const px = (p) => (p == null ? "n/a" : p >= 1 ? p.toFixed(4) : p <= 0 ? "0" : p.toFixed(Math.min(14, Math.max(4, Math.ceil(-Math.log10(p)) + 3))));
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 4200); }

/* ---------- Telegram control (Plan B: the app cannot call the API) ---------- */
async function tgCommand(text, payload, why) {
  const b = B(), url = (b.links.bot_url || "https://t.me/Spearhedbot") + "?start=" + encodeURIComponent(payload);
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch (e) {}
  toast(`${why || "Control goes through Telegram"} · ${copied ? "copied" : "send"} “${text}” to ${b.links.bot_name || "@Spearhedbot"}`);
  window.open(url, "_blank", "noopener");
}

/* ---------- odometer ---------- */
function odo(el, text) {
  if (el._text === text) return; const first = !el._text; el._text = text;
  if (el._len !== text.length) { el._len = text.length; el.innerHTML = [...text].map((c) => /\d/.test(c)
      ? `<span class="d"><div>${[0,1,2,3,4,5,6,7,8,9].map((n) => `<span>${n}</span>`).join("")}</div></span>`
      : `<span class="s ${c === "$" ? "dollar" : ""}">${c}</span>`).join(""); }
  const cols = el.querySelectorAll(".d>div"); let i = 0;
  [...text].forEach((c) => { if (/\d/.test(c)) { const col = cols[i++]; if (first) col.style.transition = "none"; col.style.transform = `translateY(${-c * 10}%)`; if (first) requestAnimationFrame(() => (col.style.transition = "")); } });
  /* first paint rolls up from 0 */
  if (first) { cols.forEach((col) => { const tgt = col.style.transform; col.style.transition = "none"; col.style.transform = "translateY(0)"; void col.offsetWidth; col.style.transition = ""; col.style.transform = tgt; }); }
}

/* ---------- canvas helpers ---------- */
function setupCanvas(cv, h) { const dpr = window.devicePixelRatio || 1, w = cv.clientWidth; cv.style.height = h + "px"; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); return { c, w, h }; }
function pill(c, x, y, text, color, align) {
  c.font = "600 11px 'Roboto Mono', ui-monospace, monospace"; const tw = c.measureText(text).width + 14, hh = 20;
  let x0 = align === "right" ? x - tw : align === "center" ? x - tw / 2 : x; x0 = Math.max(4, Math.min(x0, c.canvas.clientWidth - tw - 4));
  c.fillStyle = color; c.beginPath(); c.roundRect(x0, y - hh / 2, tw, hh, 10); c.fill();
  c.fillStyle = color === GREEN || color === ORANGE || color === CYAN ? "#000" : "#fff"; c.textBaseline = "middle"; c.fillText(text, x0 + 7, y + 0.5);
}

/* ---------- HOME chart ---------- */
const RANGE_S = { LIVE: 900, "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800, ALL: 1e12 };
function drawHome() {
  const b = B(), cv = $("#homechart"); if (!cv || !b) return;
  const ch = b.chart || { points: [], marks: [] }, now = Date.now() / 1000;
  let pts = ch.points.filter((p) => p.t >= now - RANGE_S[range]);
  if (pts.length < 2) pts = ch.points.slice(-2);
  const { c, w, h } = setupCanvas(cv, 230);
  if (pts.length < 2) { c.fillStyle = MUTED; c.font = "14px Roboto, system-ui"; c.fillText("Collecting equity history…", 16, h / 2); return; }
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (hi - lo < 0.01 * Math.max(1, hi)) { const m = (lo + hi) / 2, s = 0.006 * Math.max(1, m); lo = m - s; hi = m + s; }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, padT = 58, padB = 18, X = (t) => 10 + ((t - t0) / Math.max(1, t1 - t0)) * (w - 20), Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const up = pts[pts.length - 1].v >= pts[0].v, col = up ? GREEN : RED;
  c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(p.t), Y(p.v)) : c.moveTo(X(p.t), Y(p.v)))); c.strokeStyle = col; c.lineWidth = 2; c.lineJoin = "round"; c.stroke();
  c.lineTo(X(t1), h); c.lineTo(X(t0), h); c.closePath();
  const g = c.createLinearGradient(0, padT, 0, h); g.addColorStop(0, up ? "rgba(0,211,90,.28)" : "rgba(255,69,58,.28)"); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.fill();
  c.fillStyle = MUTED; c.font = "11px 'Roboto Mono', monospace"; c.textBaseline = "alphabetic"; c.fillText(money(hi), 10, padT - 6 + 0); c.fillText(money(lo), 10, h - 4);
  const mk = (ch.marks || []).filter((m) => m.t >= t0 && m.t <= t1); let row = 0;
  mk.forEach((m) => { const x = X(m.t), y = Y(m.v); c.fillStyle = m.kind === "bought" ? BLUE : m.kind === "win" ? GREEN : RED; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill();
    const py = 14 + (row++ % 3) * 22; c.strokeStyle = "rgba(84,84,88,.55)"; c.lineWidth = 1; c.beginPath(); c.moveTo(x, py + 10); c.lineTo(x, y - 5); c.stroke();
    pill(c, x, py, m.label, m.kind === "bought" ? BLUE : m.kind === "win" ? GREEN : RED, x > w * 0.6 ? "right" : "center"); });
}


/* ---------- optional desk extras (defensive; never invent numbers) ---------- */
const WAIT = `<div class="wait">Waiting for data from your agents</div>`;
const PIPE_STAGES = ["SCAN", "ANALYZE", "DEBATE", "CONSENSUS", "IDEA"];
const FLOOR_STAGES = ["lead", "market", "research", "strategist", "risk", "executor", "reviewer"];
const FLOOR_STAGE_LABEL = { lead: "LEAD", market: "MARKET", research: "RESEARCH", strategist: "STRATEGIST", risk: "RISK", executor: "EXECUTOR", reviewer: "REVIEWER" };
const ROLE_MAP = { lead: "Desk Lead", market: "Market Analyst", research: "Research Analyst", strategist: "Strategist", risk: "Risk Manager", executor: "Execution Trader", reviewer: "Trade Reviewer" };
const agentTitle = (n) => ROLE_MAP[canon(n)] || String(n || "?");
function pickObj(b, key) { if (!b) return null; const v = b[key] != null ? b[key] : (b.state ? b.state[key] : null); return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
const numOk = (v) => v != null && v !== "" && isFinite(Number(v));
const tgSafe = (s) => String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
function tgStartUrl(b, payload) { return ((b.links && b.links.bot_url) || "https://t.me/Spearhedbot") + "?start=" + encodeURIComponent(payload); }
function pickList(b, key) {
  if (!b) return null;
  if (Array.isArray(b[key])) return b[key];
  if (b.state && Array.isArray(b.state[key])) return b.state[key];
  return null;
}
function shortMint(m) {
  const s = String(m || "");
  if (s.length < 12) return s || "—";
  return s.slice(0, 4) + "…" + s.slice(-4);
}
function convPct(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  if (n > 1 && n <= 100) return Math.round(n);
  return null;
}
function beatAge(a) {
  if (!a || a.last_beat == null || a.last_beat === "") return Infinity;
  let t = Number(a.last_beat);
  if (!isFinite(t)) return Infinity;
  if (t > 1e12) t /= 1000;
  return Date.now() / 1000 - t;
}
function agentBusy(a) {
  if (a && a.busy === true) return true;
  if (a && a.busy === false) return false;
  const d = String((a && a.detail) || "");
  const num = (re) => { const m = d.match(re); return m ? Number(m[1]) : 0; };
  if (/\bauditing\b/i.test(d)) return true;
  if (num(/queue\s+(\d+)/i) > 0) return true;
  if (num(/waiting\s+(\d+)/i) > 0) return true;
  if (num(/\bopen\s+(\d+)/i) > 0) return true;
  return false;
}
function agentRunState(a) {
  if (!a) return "stale";
  const paused = a.paused === true || a.paused === 1 || a.paused === "true"
    || String(a.status || "").toLowerCase() === "paused";
  if (paused) return "stopped";
  const age = beatAge(a);
  const st = String(a.status || "").toLowerCase();
  if (!isFinite(age) || age > STALE_S || st === "down" || st === "error" || st === "offline") return "stale";
  const rs = String(a.run_state || a.runState || "").toLowerCase().trim();
  if (rs === "busy" || rs === "running") return "running";
  if (rs === "idle") return "idle";
  if (rs === "waiting" || rs === "wait") return "waiting";
  if (a.busy === true) return "running";
  if (a.busy === false) return "idle";
  return agentBusy(a) ? "running" : "idle";
}
function stateLabel(st) {
  const s = String(st || "").toLowerCase();
  if (s === "running" || s === "busy") return "RUNNING";
  if (s === "idle") return "IDLE";
  if (s === "waiting" || s === "wait") return "WAITING";
  if (s === "stopped" || s === "paused" || s === "off") return "STOPPED";
  if (s === "stale" || s === "down") return "STALE";
  return String(st || "IDLE").toUpperCase();
}
function stateDotClass(st) {
  const s = String(st || "idle").toLowerCase();
  if (s === "running" || s === "busy") return "pulse";
  if (s === "idle") return "idle";
  if (s === "waiting" || s === "wait") return "wait";
  if (s === "stopped" || s === "paused" || s === "off") return "off";
  return "down";
}
function statePillClass(st) {
  const s = String(st || "idle").toLowerCase().replace(/\s+/g, "");
  if (s === "running" || s === "busy") return "running";
  if (s === "waiting" || s === "wait") return "waiting";
  if (s === "idle" || s === "ok" || s === "ready") return "idle";
  if (s === "stopped" || s === "paused" || s === "off") return "stopped";
  if (s === "stale" || s === "down" || s === "error" || s === "offline" || s.includes("veto")) return "stale";
  if (s.includes("debat")) return "debating";
  if (s.includes("scan")) return "scanning";
  if (s.includes("analy")) return "analyzing";
  if (s.includes("consensus")) return "consensus";
  if (s.includes("idea")) return "idea";
  return "idle";
}
function statePillHtml(st) {
  const s = String(st || "idle").toLowerCase();
  return `<span class="pill state ${statePillClass(s)}"><i class="dot ${stateDotClass(s)}"></i>${esc(stateLabel(s))}</span>`;
}
function fmtIdeaPx(n) {
  if (n == null || n === "" || !isFinite(Number(n))) return null;
  const v = Number(n);
  if (v >= 1) return v.toFixed(4);
  if (v <= 0) return "0";
  return v.toFixed(Math.min(10, Math.max(4, Math.ceil(-Math.log10(v)) + 2)));
}
function fmtUsdShort(n) {
  if (n == null || n === "" || !isFinite(Number(n))) return null;
  const v = Number(n), a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toFixed(0);
}
function pipelineStages(stageRaw) {
  const raw = String(stageRaw == null ? "" : stageRaw).trim();
  const key = canon(raw);
  const isFloor = FLOOR_STAGES.includes(key) || FLOOR_STAGES.includes(raw.toLowerCase())
    || FLOOR_STAGES.some((id) => raw.toUpperCase() === (FLOOR_STAGE_LABEL[id] || "").toUpperCase() || raw.toUpperCase() === id.toUpperCase());
  if (isFloor) {
    const cur = FLOOR_STAGES.includes(key) ? key : (FLOOR_STAGES.find((id) => raw.toUpperCase() === (FLOOR_STAGE_LABEL[id] || "").toUpperCase()) || key);
    return { names: FLOOR_STAGES.map((id) => FLOOR_STAGE_LABEL[id]), idx: FLOOR_STAGES.indexOf(cur) };
  }
  const s = raw.toUpperCase();
  let idx = PIPE_STAGES.indexOf(s);
  if (idx < 0 && isFinite(Number(stageRaw))) idx = Math.max(0, Math.min(PIPE_STAGES.length - 1, Number(stageRaw)));
  if (idx < 0) idx = PIPE_STAGES.findIndex((p) => s.indexOf(p) >= 0);
  return { names: PIPE_STAGES, idx };
}
function pipelineHtml(b) {
  const pipe = (b && b.pipeline) || (b && b.state && b.state.pipeline) || null;
  const stageRaw = pipe && (pipe.stage || pipe.current || pipe.step);
  if (!pipe || stageRaw == null || stageRaw === "") return WAIT;
  const { names, idx } = pipelineStages(stageRaw);
  return `<div class="pipe">${names.map((name, i) => {
    const cls = i === idx ? "on" : (idx >= 0 && i < idx ? "done" : "");
    const arrow = i < names.length - 1 ? `<span class="pipe-arrow">→</span>` : "";
    return `<div class="pipe-stage ${cls}">${esc(name)}</div>${arrow}`;
  }).join("")}</div>`;
}
function ideasHtml(b) {
  const list = pickList(b, "ideas");
  if (!list) return WAIT;
  if (!list.length) return `<div class="wait">No Solana meme ideas yet</div>`;
  return list.slice(0, 8).map((idea) => {
    const sym = idea.symbol || idea.coin || idea.name || "—";
    const name = idea.name && idea.symbol && idea.name !== idea.symbol ? idea.name : (idea.token_name || "");
    const mint = idea.mint || idea.address || idea.ca || "";
    const side = String(idea.side || "").toUpperCase();
    const entry = fmtIdeaPx(idea.entry), stop = fmtIdeaPx(idea.stop), target = fmtIdeaPx(idea.target);
    const risk = idea.risk || idea.risk_tag || idea.rug_risk || "";
    const mcap = fmtUsdShort(idea.mcap ?? idea.market_cap);
    const liq = fmtUsdShort(idea.liquidity ?? idea.liq ?? idea.liq_usd);
    const agree = Array.isArray(idea.agree) ? idea.agree : (Array.isArray(idea.agents) ? idea.agents : []);
    const agreeTxt = agree.map((a) => typeof a === "string" ? a : (a.name || a.bot || "")).filter(Boolean).join(", ");
    const t = idea.created_at || idea.created || idea.ts || idea.t;
    const tags = [];
    if (side) tags.push(`<span class="pill ${side === "SHORT" ? "short" : "long"}">${esc(side)}</span>`);
    if (risk) tags.push(`<span class="pill risk">${esc(risk)}</span>`);
    if (mcap) tags.push(`<span class="pill grey">MC ${esc(mcap)}</span>`);
    if (liq) tags.push(`<span class="pill grey">Liq ${esc(liq)}</span>`);
    const links = mint ? `<div class="idea-links">
        <a href="https://dexscreener.com/solana/${encodeURIComponent(mint)}" target="_blank" rel="noopener">DexScreener</a>
        <a href="https://birdeye.so/token/${encodeURIComponent(mint)}?chain=solana" target="_blank" rel="noopener">Birdeye</a>
      </div>` : "";
    return `<div class="idea">
      <div class="idea-top"><div><div class="idea-sym">${esc(sym)}</div>${name ? `<div class="idea-name">${esc(name)}</div>` : ""}</div></div>
      ${mint ? `<button type="button" class="idea-mint" data-copy="${esc(mint)}" title="Copy mint">${esc(shortMint(mint))} · tap to copy</button>` : ""}
      <div class="idea-levels">
        <div><label>Entry</label><b>${entry != null ? esc(entry) : "—"}</b></div>
        <div><label>Stop</label><b>${stop != null ? esc(stop) : "—"}</b></div>
        <div><label>Target</label><b>${target != null ? esc(target) : "—"}</b></div>
      </div>
      ${tags.length ? `<div class="idea-meta">${tags.join("")}</div>` : ""}
      ${(agreeTxt || t) ? `<div class="idea-agree">${agreeTxt ? "Agreed: " + esc(agreeTxt) : ""}${agreeTxt && t ? " · " : ""}${t ? esc(hhmm(Number(t) < 1e12 ? Number(t) : Number(t) / 1000)) : ""}</div>` : ""}
      ${links}
    </div>`;
  }).join("");
}
function paperTableHtml(b) {
  const list = pickList(b, "positions");
  if (!list) return WAIT;
  const open = list.filter((p) => {
    const st = String(p.status || "open").toLowerCase();
    return st === "open" || st === "" || p.open === true;
  });
  const rows = (open.length ? open : list).slice(0, 20);
  if (!rows.length) return `<div class="wait">No open paper positions</div>`;
  const body = rows.map((p) => {
    const agent = esc(p.agent || p.bot || p.who || "—");
    const coin = esc(p.coin || p.symbol || p.name || "—");
    const side = String(p.side || "").toUpperCase() || "—";
    const entry = p.entry != null ? px(p.entry) : (p.entry_price != null ? px(p.entry_price) : "—");
    const nowV = p.now != null ? p.now : (p.price != null ? p.price : p.last_price);
    const now = nowV != null ? px(nowV) : "—";
    let pnl = "—";
    if (p.pnl_pct != null && isFinite(Number(p.pnl_pct))) {
      const v = Number(p.pnl_pct);
      pnl = `<span class="${v >= 0 ? "green" : "red"}">${pct(v)}</span>`;
    } else if (p.pnl_usd != null && isFinite(Number(p.pnl_usd))) {
      const v = Number(p.pnl_usd);
      pnl = `<span class="${v >= 0 ? "green" : "red"}">${(v >= 0 ? "+" : "-") + money(Math.abs(v))}</span>`;
    }
    const mint = p.mint || "";
    return `<tr ${mint ? `data-coin="${esc(mint)}"` : ""}><td class="pos-ag">${agent}</td><td class="pos-coin">${coin}</td><td>${esc(side)}</td><td class="pos-px">${esc(entry)}</td><td class="pos-px">${esc(now)}</td><td class="pos-pnl">${pnl}</td></tr>`;
  }).join("");
  return `<div class="pos-wrap"><table class="pos"><thead><tr><th>Agent</th><th>Coin</th><th>Side</th><th>Entry</th><th>Now</th><th>P&amp;L</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function chatAgent(m) {
  return String((m && (m.agent != null && m.agent !== "" ? m.agent : (m.name || m.bot || m.from))) || "").trim() || "desk";
}
function chatText(m) {
  if (!m) return "";
  if (m.text != null && String(m.text) !== "") return String(m.text);
  if (m.message != null && String(m.message) !== "") return String(m.message);
  if (m.body != null && String(m.body) !== "") return String(m.body);
  return "";
}
function chatTime(m) {
  const t = m && (m.created_at != null ? m.created_at : (m.ts != null ? m.ts : (m.t != null ? m.t : m.time)));
  if (t == null || t === "") return null;
  const n = Number(t);
  if (!isFinite(n)) return null;
  return n < 1e12 ? n : n / 1000;
}
function chatHtml(b) {
  const list = pickList(b, "chat");
  if (!list) return WAIT;
  if (!list.length) return `<div class="wait">No floor chat yet</div>`;
  const items = list.map((m) => ({ name: chatAgent(m), msg: chatText(m), t: chatTime(m), ticket: m.ticket_id || m.ticket || m.tid || "" }))
    .filter((m) => m.msg)
    .sort((a, c) => (a.t || 0) - (c.t || 0));
  const shown = items.slice(-40);
  if (!shown.length) return `<div class="wait">No floor chat yet</div>`;
  return `<div class="chat-feed">${shown.map((m, i) => {
    const prev = i ? shown[i - 1].name : "";
    const same = prev && canon(prev) === canon(m.name);
    const accent = catLook(m.name).accent;
    const tShow = m.t != null ? hhmm(m.t) : "";
    const chip = m.ticket ? `<span class="tix-chip">#${esc(m.ticket)}</span>` : "";
    return `<div class="bubble-row${same ? " same" : ""}">
      <div class="bubble-av">${same ? "" : catAvatar(m.name, 36)}</div>
      <div class="bubble-col">
        ${same ? "" : `<div class="bubble-name" style="color:${accent}">${esc(agentTitle(m.name))}${chip}</div>`}
        ${same && chip ? `<div class="bubble-name">${chip}</div>` : ""}
        <div class="bubble" style="border-left-color:${accent}">${esc(m.msg)}</div>
        ${tShow ? `<div class="bubble-time">${esc(tShow)}</div>` : ""}
      </div>
    </div>`;
  }).join("")}</div>`;
}
function agentExtrasHtml(a, st) {
  const role = a.role || agentTitle(a.name) || "";
  const state = agentRunState(a);
  const last = a.last || a.detail || agentLine(a);
  const conv = convPct(a.conviction);
  const convHtml = conv != null
    ? `<div class="conv"><div class="conv-meta"><span>Conviction</span><span>${conv}%</span></div><div class="conv-bar"><i style="width:${conv}%"></i></div></div>`
    : "";
  return `${role ? `<div class="agent-role">${esc(role)}</div>` : ""}
    <div style="margin-top:8px">${statePillHtml(state)}</div>
    ${convHtml}
    ${last ? `<div class="agent-last">${esc(last)}</div>` : ""}`;
}


const CAT_LOOKS = {
  lead:     { fur:"#f4f0e6", inner:"#f2b2c2", iris:"#a46bff", irisDark:"#5a2eb0", stroke:"#8a7f6a", brow:"cool", mark:"crown", accent:"#bf5af2" },
  market:   { fur:"#f3c48a", inner:"#ff9db4", iris:"#4d8dff", irisDark:"#1e4db5", stroke:"#b67a3c", brow:"curious", mark:"tuft", accent:"#0a84ff" },
  research: { fur:"#eef2f7", inner:"#f5b8c6", iris:"#3ad3e0", irisDark:"#0e7a86", stroke:"#8b95a3", brow:"serious", mark:"tips", accent:"#64d2ff" },
  strategist:{ fur:"#e09a4c", inner:"#ee8a7a", iris:"#f0b429", irisDark:"#a45e0c", stroke:"#8a4e18", brow:"think", mark:"tabby", accent:"#ff9f0a" },
  executor: { fur:"#2c2c30", inner:"#f0a8b8", iris:"#b6e04a", irisDark:"#4e7a14", stroke:"#121214", brow:"cool", mark:"muzzle", accent:"#00d35a" },
  risk:     { fur:"#8a4e2c", inner:"#e8b89a", iris:"#ef5a5a", irisDark:"#8a1e1e", stroke:"#5a2e18", brow:"worry", mark:"tips", accent:"#ff453a" },
  reviewer: { fur:"#9aa3ad", inner:"#efb6c4", iris:"#59c18c", irisDark:"#1f6e45", stroke:"#5b636c", brow:"serious", mark:"", acc:"glasses", accent:"#30d158" },
};
function catLook(name) {
  const k = canon(name);
  if (CAT_LOOKS[k]) return CAT_LOOKS[k];
  const keys = Object.keys(CAT_LOOKS);
  let h = 0; for (let i = 0; i < k.length; i++) h = (h + k.charCodeAt(i) * 17) % keys.length;
  return CAT_LOOKS[keys[h]];
}
let _catUid = 0;
function catBrows(kind, color) {
  const s = `fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"`;
  if (kind === "serious") return `<path d="M15.5 21.8 Q22 20.8 28 21.8" ${s}/><path d="M36 21.8 Q42 20.8 48.5 21.8" ${s}/>`;
  if (kind === "think") return `<path d="M15.8 23.2 Q22 19.6 28.2 22.8" ${s}/><path d="M35.8 22.8 Q42 19.6 48.2 23.2" ${s}/>`;
  if (kind === "cool") return `<path d="M16 21.2 Q22 20.2 28.2 23.4" ${s}/><path d="M35.8 23.4 Q42 20.2 48 21.2" ${s}/>`;
  if (kind === "worry") return `<path d="M16.2 24.2 Q22 18.8 28.4 21.4" ${s}/><path d="M35.6 21.4 Q42 18.8 47.8 24.2" ${s}/>`;
  return `<path d="M15.8 22.2 Q22 17.8 28.2 21.2" ${s}/><path d="M35.8 21.2 Q42 17.8 48.2 22.2" ${s}/>`;
}
function catMarks(kind, L) {
  if (kind === "tabby") return `<path d="M32 16 L32 24" stroke="${L.stroke}" stroke-width="2.2" stroke-linecap="round"/><path d="M27 17 L28.2 24" stroke="${L.stroke}" stroke-width="1.8" stroke-linecap="round"/><path d="M37 17 L35.8 24" stroke="${L.stroke}" stroke-width="1.8" stroke-linecap="round"/>`;
  if (kind === "tuft") return `<path d="M32 12 Q34 8 31 6 Q30 14 32 16" fill="${L.fur}" stroke="${L.stroke}" stroke-width=".8"/>`;
  if (kind === "crown") return `<path d="M22 15 L24 6 L28.5 11 L32 4 L35.5 11 L40 6 L42 15 Z" fill="#ffd60a" stroke="#b8860b" stroke-width=".9"/><circle cx="32" cy="9" r="1.4" fill="#ff453a"/>`;
  if (kind === "muzzle") return `<ellipse cx="32" cy="44" rx="9" ry="6.5" fill="#4a4a50"/>`;
  if (kind === "tips") return `<path d="M14 16 L11 7 L18 12 Z" fill="${L.stroke}" opacity=".55"/><path d="M50 16 L53 7 L46 12 Z" fill="${L.stroke}" opacity=".55"/>`;
  return "";
}
function catEye(cx, L) {
  return `<ellipse cx="${cx}" cy="33" rx="7.4" ry="9.2" fill="#fff"/>
    <ellipse cx="${cx}" cy="33.6" rx="6.3" ry="7.8" fill="${L.iris}"/>
    <ellipse cx="${cx}" cy="37.2" rx="5.2" ry="4.2" fill="${L.irisDark}" opacity=".5"/>
    <ellipse cx="${cx}" cy="33.6" rx="2.7" ry="4.6" fill="#1a1020"/>
    <ellipse cx="${cx + 2.3}" cy="29.6" rx="2.5" ry="3.3" fill="#fff"/>
    <circle cx="${cx - 2.2}" cy="35.2" r="1.15" fill="#fff" opacity=".95"/>
    <path d="M${cx - 7.2} 28.2 Q${cx} 22.6 ${cx + 7.2} 28.2" fill="none" stroke="#1a1020" stroke-width="1.7" stroke-linecap="round"/>`;
}
function catSvgInner(name) {
  const L = catLook(name);
  const k = String(name || "").toLowerCase();
  const initial = esc((agentTitle(name).trim().charAt(0).toUpperCase()) || "?");
  return `
    <circle cx="32" cy="36" r="22" fill="${L.fur}"/>
    <path d="M13 30 Q8 5 26 20 Z" fill="${L.fur}"/>
    <path d="M51 30 Q56 5 38 20 Z" fill="${L.fur}"/>
    <path d="M15 24 Q12 10 23 20 Z" fill="${L.inner}"/>
    <path d="M49 24 Q52 10 41 20 Z" fill="${L.inner}"/>
    ${catMarks(L.mark, L)}
    ${catBrows(L.brow, L.stroke)}
    ${catEye(22.2, L)}
    ${catEye(41.8, L)}
    ${L.acc === "glasses" ? `<g fill="none" stroke="#1c1c1e" stroke-width="1.8"><circle cx="22.2" cy="33" r="8.6"/><circle cx="41.8" cy="33" r="8.6"/><path d="M30.8 32 Q32 30.6 33.2 32"/></g><rect x="42" y="46" width="13" height="15" rx="1.5" fill="#fff6d5" stroke="#8a6d1f" stroke-width=".9"/><path d="M44.5 50 H52.5 M44.5 53 H52.5 M44.5 56 H50" stroke="#8a6d1f" stroke-width=".8"/>` : ""}
    <ellipse cx="16.5" cy="41.5" rx="4.2" ry="2.3" fill="#ff8aa8" opacity=".62"/>
    <ellipse cx="47.5" cy="41.5" rx="4.2" ry="2.3" fill="#ff8aa8" opacity=".62"/>
    <path d="M29 45.2 Q32 48 35 45.2" fill="none" stroke="${L.stroke}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M32 45.6 Q32 47.4 32 47.4" fill="none" stroke="${L.stroke}" stroke-width="1.1" stroke-linecap="round"/>
    <circle cx="50" cy="14" r="7" fill="${L.accent}" stroke="#000" stroke-opacity=".15" stroke-width=".6"/>
    <text x="50" y="17.2" text-anchor="middle" font-size="8" font-weight="700" fill="#fff" font-family="Roboto,system-ui,sans-serif">${initial}</text>`;
}
function catAvatar(name, size) {
  const L = catLook(name), s = size || 40, id = "cr" + (++_catUid);
  return `<span class="cat" style="width:${s}px;height:${s}px" title="${esc(name || "")}" aria-hidden="true">
    <svg viewBox="0 0 64 64" width="${s}" height="${s}">
      <defs><clipPath id="${id}"><circle cx="32" cy="32" r="30"/></clipPath></defs>
      <g clip-path="url(#${id})">${catSvgInner(name)}</g>
      <circle cx="32" cy="32" r="30.5" fill="none" stroke="${L.accent}" stroke-width="3"/>
    </svg>
  </span>`;
}
function orderAgents(agents) {
  const list = (agents || []).map((a) => ({ ...a, _id: canon(a.name) }));
  const rank = (id) => { const i = AGENTS.indexOf(id); return i < 0 ? 99 : i; };
  list.sort((a, b) => rank(a._id) - rank(b._id));
  return list;
}
function botNetworkHtml(agents, b) {
  const list = orderAgents(agents);
  if (!list.length) return WAIT;
  const W = 360, H = 230;
  const cx = 180, cy = 108, R = 78;
  const center = list.find((a) => a._id === "lead");
  const ring = list.filter((a) => a._id !== "lead");
  const pos = new Map();
  if (center) pos.set(center, [cx, cy]);
  ring.forEach((ag, i) => {
    const n = Math.max(ring.length, 1);
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pos.set(ag, [cx + R * Math.cos(ang), cy + R * Math.sin(ang)]);
  });
  const nodes = list;
  const pairs = [];
  if (center) ring.forEach((ag) => pairs.push([center, ag]));
  for (let i = 0; i < ring.length; i++) pairs.push([ring[i], ring[(i + 1) % ring.length]]);
  const lines = pairs.map(([a, c]) => {
    const p = pos.get(a), q = pos.get(c);
    return `<path d="M${p[0]} ${p[1]} Q${(p[0]+q[0])/2} ${(p[1]+q[1])/2 - 6} ${q[0]} ${q[1]}" fill="none" stroke="rgba(191,90,242,.4)" stroke-width="1.3"/>`;
  }).join("");
  const dots = nodes.map((ag) => {
    const [x, y] = pos.get(ag);
    const st = agentRunState(ag);
    const col = st === "running" ? "#00d35a" : st === "idle" ? "#8e8e93" : (st === "stopped" || st === "waiting") ? "#ff9f0a" : "#ff453a";
    const accent = catLook(ag.name).accent;
    const r = ag._id === "lead" ? 26 : 22;
    const lab = agentTitle(ag.name).replace(" Analyst", "").replace(" Manager", "").replace(" Trader", "").replace("Desk ", "");
    return `<g>
      <circle cx="${x}" cy="${y}" r="${r}" fill="#111" stroke="${col}" stroke-width="2.4"/>
      <circle cx="${x}" cy="${y}" r="${r - 2.4}" fill="none" stroke="${accent}" stroke-width="1.5"/>
      <g transform="translate(${x - r * 0.72},${y - r * 0.72}) scale(${(r * 1.44) / 64})">${catSvgInner(ag.name)}</g>
      <text x="${x}" y="${y + r + 11}" text-anchor="middle" fill="rgba(235,235,245,.8)" font-size="8.5" font-family="Roboto,system-ui,sans-serif">${esc(lab)}</text>
    </g>`;
  }).join("");
  return `<div class="net-card"><svg class="net-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trading floor network">${lines}${dots}</svg></div>`;
}
function botStatusCardsHtml(agents, b) {
  const list = orderAgents(agents);
  if (!list.length) return WAIT;
  return `<div class="bstats">${list.map((a) => {
    const st = agentRunState(a);
    const conv = convPct(a.conviction);
    const detail = a.detail || agentLine(a) || "";
    const title = a.role || agentTitle(a.name);
    return `<div class="bstat">
      ${catAvatar(a.name, 48)}
      <div class="who"><div class="nm">${esc(title)}</div>
        <div class="agent-role">${esc(a._id || canon(a.name))}</div>
        ${conv != null ? `<div class="conv" style="margin-top:6px"><div class="conv-bar"><i style="width:${conv}%"></i></div></div>` : ""}
        ${detail ? `<div class="agent-last">${esc(detail)}</div>` : ""}
      </div>
      ${statePillHtml(st)}
    </div>`;
  }).join("")}</div>`;
}

/* ---------- views ---------- */
function agentLine(a) { const d = (a.decisions || [])[0]; return d ? d.text : "no decisions yet"; }
function agentState(a, b) { return agentRunState(a); }
function activityAgent(i) {
  if (i.agent || i.bot || i.name) return i.agent || i.bot || i.name;
  const t = String((i.title || "") + " " + (i.kind || "") + " " + (i.detail || "")).toLowerCase();
  for (const n of AGENTS) if (t.includes(n)) return n;
  for (const [oldId, neu] of Object.entries(AGENT_ALIAS)) if (t.includes(oldId)) return neu;
  return null;
}
function actRow(i) {
  const col = { scan_pass: GREEN, audit_pass: GREEN, verdict_pass: GREEN, signal: BLUE, exit: ORANGE, audit_fail: RED, verdict_fail: RED, exec_skip: ORANGE }[i.kind] || "#48484a";
  const ag = activityAgent(i);
  const icon = ag ? catAvatar(ag, 28) : `<div class="ic" style="background:${col}"></div>`;
  return `<div class="row" ${i.mint ? `data-coin="${esc(i.mint)}"` : ""}><div class="main">${icon}<div><div class="tt">${esc(i.title)}</div><div class="dd">${esc(i.detail || i.kind)}</div></div></div><div class="tm">${hhmm(i.created_at)}</div></div>`;
}
function fmtPctNum(v) {
  if (!numOk(v)) return "—";
  const n = Number(v);
  const d = Math.abs(n) < 0.1 && n !== 0 ? 2 : 1;
  return n.toFixed(d).replace(/\.0$/, "") + "%";
}
function asPctPoints(v) {
  if (!numOk(v)) return null;
  return Number(v);
}
function limitsHtml(b) {
  const L = pickObj(b, "limits");
  if (!L) return WAIT;
  const exp = asPctPoints(L.exposure_pct);
  const expMax = asPctPoints(L.max_exposure_pct);
  const pnl = asPctPoints(L.day_pnl_pct);
  const loss = asPctPoints(L.daily_loss_pct);
  const risk = asPctPoints(L.risk_per_trade_pct);
  const halted = L.halted === true || L.halted === 1 || String(L.halted).toLowerCase() === "true";
  function bar(label, value, cap, flip) {
    const hasV = value != null, hasC = cap != null && cap !== 0;
    const ratio = hasV && hasC ? Math.min(1, Math.max(0, Math.abs(value) / Math.abs(cap))) : (hasV ? 0 : 0);
    const over = hasV && hasC && ((flip && value <= -Math.abs(cap)) || (!flip && Math.abs(value) >= Math.abs(cap)));
    const cls = !hasV ? "" : (over ? "over" : (flip && value < 0 ? "down" : ""));
    const capLabel = hasC ? (flip ? "vs −" + fmtPctNum(Math.abs(cap)).replace("%","") + "%" : "vs " + fmtPctNum(cap)) : "";
    return `<div class="lim-row">
      <div class="lim-meta"><span>${esc(label)}</span><b>${hasV ? esc(fmtPctNum(value)) : "—"}${capLabel ? ` <span class="lim-cap">${esc(capLabel)}</span>` : ""}</b></div>
      <div class="lim-bar"><i class="${cls}" style="width:${hasV && hasC ? Math.round(ratio * 100) : 0}%"></i></div>
    </div>`;
  }
  return `${halted ? `<div class="halted">HALTED</div>` : ""}
    <div class="lims">
      ${bar("Exposure", exp, expMax, false)}
      ${bar("Day P&L", pnl, loss, true)}
      ${risk != null ? `<div class="lim-note">Risk per trade ${esc(fmtPctNum(risk))}</div>` : ""}
    </div>`;
}
function isAutoTicket(t) {
  return t && (t.auto === true || t.auto === 1 || String(t.auto).toLowerCase() === "true");
}
function ticketStatusChip(t) {
  const st = String((t && t.status) || "open").toLowerCase();
  return `<span class="tix-chip ${esc(st)}">${esc(st.toUpperCase())}</span>`;
}
function ticketAutoTag(t) {
  return isAutoTicket(t) ? `<span class="tix-chip auto sm">AUTO</span>` : "";
}
function fmtMs(ms) {
  const n = Number(ms);
  if (!isFinite(n)) return "—";
  const sec = n / 1000;
  return (sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)) + "s";
}
function stageMsHtml(sm) {
  if (!sm || typeof sm !== "object" || Array.isArray(sm)) return "";
  const keys = Object.keys(sm);
  if (!keys.length) return "";
  return `<div class="tix-stages">${keys.map((k) => {
    const lab = FLOOR_STAGE_LABEL[canon(k)] || String(k).toUpperCase();
    return `<span><i>${esc(lab)}</i> ${esc(fmtMs(sm[k]))}</span>`;
  }).join("")}</div>`;
}
function ticketsHtml(b) {
  const list = pickList(b, "tickets");
  if (!list) return WAIT;
  if (!list.length) return `<div class="wait">No tickets yet</div>`;
  return `<div class="tix-list">${list.map((t) => {
    const id = t.id != null ? String(t.id) : "";
    const st = String(t.status || "").toLowerCase();
    const auto = isAutoTicket(t);
    const chain = Array.isArray(t.chain) ? t.chain : [];
    const mint = t.mint || "";
    const dir = String(t.direction || t.side || "—").toUpperCase();
    const size = numOk(t.size_usd) ? money(Number(t.size_usd)) : "—";
    const entry = t.entry != null ? px(t.entry) : "—";
    const inv = t.invalidation != null ? px(t.invalidation) : "—";
    const when = t.created_at != null ? hhmm(Number(t.created_at) < 1e12 ? Number(t.created_at) : Number(t.created_at) / 1000) : "";
    const pending = st === "pending" && !auto;
    const safe = tgSafe(id);
    const bot = (b.links && b.links.bot_url) || "https://t.me/Spearhedbot";
    const actions = pending && safe ? `<div class="tix-actions">
      <a class="tix-btn go" href="${esc(bot + "?start=" + encodeURIComponent("approve_" + safe))}" target="_blank" rel="noopener">Approve #${esc(id)}</a>
      <a class="tix-btn no" href="${esc(bot + "?start=" + encodeURIComponent("reject_" + safe))}" target="_blank" rel="noopener">Reject #${esc(id)}</a>
    </div>` : "";
    let latency = "";
    if (t.latency_ms != null && t.latency_ms !== "" && isFinite(Number(t.latency_ms))) {
      const sec = Number(t.latency_ms) / 1000;
      latency = `flag→fill ${sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)}s`;
    }
    const killed = st === "killed" || st === "kill" || st === "veto";
    const killShow = killed && t.kill_reason ? String(t.kill_reason) : "";
    return `<div class="tix">
      <div class="tix-top"><div class="tix-id">#${esc(id || "—")}</div><div class="tix-flags">${ticketStatusChip(t)}${ticketAutoTag(t)}</div></div>
      <div class="tix-asset">${esc(t.asset || t.symbol || t.name || "—")} <span class="tix-dir">${esc(dir)}</span></div>
      ${mint ? `<button type="button" class="idea-mint" data-copy="${esc(mint)}">${esc(shortMint(mint))} · tap to copy</button>` : `<div class="dd">mint —</div>`}
      <div class="tix-grid">
        <div><label>Size</label><b>${esc(size)}</b></div>
        <div><label>Entry</label><b>${esc(entry)}</b></div>
        <div><label>Invalidation</label><b>${esc(inv)}</b></div>
        <div><label>Opened</label><b>${esc(when || "—")}</b></div>
      </div>
      ${latency ? `<div class="tix-lat">${esc(latency)}</div>` : ""}
      ${stageMsHtml(t.stage_ms || t.stageMs)}
      ${killShow ? `<div class="tix-kill">Kill: ${esc(killShow)}</div>` : ""}
      <div class="tix-chain">${chain.length ? chain.map((n) => catAvatar(n, 22)).join("") : `<span class="dd">chain —</span>`}</div>
      ${actions}
    </div>`;
  }).join("")}</div>`;
}
function journalHtml(b) {
  const list = pickList(b, "journal");
  if (!list) return WAIT;
  if (!list.length) return `<div class="wait">No journal entries yet</div>`;
  return `<div class="jnl-list">${list.map((j) => {
    const id = j.ticket_id || j.id || j.ticket || "";
    const pnlV = j.pnl_usd != null ? Number(j.pnl_usd) : (j.pnl != null ? Number(j.pnl) : null);
    const pnlP = j.pnl_pct != null ? Number(j.pnl_pct) : null;
    let pnl = "—", cls = "";
    if (numOk(pnlV)) { cls = Number(pnlV) >= 0 ? "green" : "red"; pnl = (Number(pnlV) >= 0 ? "+" : "−") + money(Math.abs(Number(pnlV))); }
    else if (numOk(pnlP)) { cls = Number(pnlP) >= 0 ? "green" : "red"; pnl = pct(Number(pnlP)); }
    const note = j.post_mortem || j.notes || j.text || j.detail || "";
    const when = j.created_at != null ? hhmm(Number(j.created_at) < 1e12 ? Number(j.created_at) : Number(j.created_at) / 1000) : "";
    return `<div class="jnl ${cls === "red" ? "loss" : ""}">
      <div class="tix-top"><div class="tix-id">#${esc(id || "—")}</div><span class="${cls}">${pnl}</span></div>
      <div class="tix-asset">${esc(j.asset || j.symbol || j.name || "—")}${when ? ` <span class="dd">${esc(when)}</span>` : ""}</div>
      ${note ? `<div class="jnl-note">${esc(note)}</div>` : `<div class="dd">No post-mortem</div>`}
    </div>`;
  }).join("")}</div>`;
}
function weeklyHtml(b) {
  const w = (b && (b.weekly_report != null ? b.weekly_report : (b.state && b.state.weekly_report)));
  if (w == null || w === "") return WAIT;
  if (typeof w === "string") return `<div class="weekly">${esc(w)}</div>`;
  if (typeof w !== "object") return WAIT;
  const pnlV = w.pnl_usd != null ? Number(w.pnl_usd) : (w.pnl != null ? Number(w.pnl) : null);
  const pnlP = w.pnl_pct != null ? Number(w.pnl_pct) : (w.day_pnl_pct != null ? Number(w.day_pnl_pct) : null);
  let pnl = "";
  if (numOk(pnlV)) pnl = `<div class="${Number(pnlV)>=0?"green":"red"}">${Number(pnlV)>=0?"+":"−"}${money(Math.abs(Number(pnlV)))}</div>`;
  else if (numOk(pnlP)) pnl = `<div class="${Number(pnlP)>=0?"green":"red"}">${pct(Number(pnlP))}</div>`;
  const text = w.text || w.summary || w.body || w.notes || "";
  const title = w.title || w.week || w.period || "This week";
  const wins = w.wins, losses = w.losses, n = w.tickets || w.count;
  const meta = [wins != null ? wins + " wins" : null, losses != null ? losses + " losses" : null, n != null ? n + " tickets" : null].filter(Boolean).join(" · ");
  return `<div class="weekly">
    <div class="tix-top"><div class="tix-asset">${esc(title)}</div>${pnl}</div>
    ${meta ? `<div class="dd">${esc(meta)}</div>` : ""}
    ${text ? `<div class="jnl-note">${esc(text)}</div>` : ""}
  </div>`;
}

function funnelHtml(b) {
  const f = pickObj(b, "funnel");
  if (!f) return WAIT;
  const rawCounts = (f.counts && typeof f.counts === "object") ? f.counts
    : ((f.stages && typeof f.stages === "object" && !Array.isArray(f.stages)) ? f.stages : null);
  const counts = {};
  if (rawCounts) {
    Object.keys(rawCounts).forEach((k) => { if (numOk(rawCounts[k])) counts[k] = Number(rawCounts[k]); });
  } else {
    Object.keys(f).forEach((k) => {
      if (k === "kills" || k === "reasons") return;
      if (numOk(f[k])) counts[k] = Number(f[k]);
    });
  }
  const kills = Array.isArray(f.kills) ? f.kills : [];
  const reasonMap = new Map();
  kills.forEach((k) => {
    const reason = String((k && (k.reason || k.kill_reason || k.why)) || "").trim() || "unspecified";
    const rec = reasonMap.get(reason) || { reason, n: 0, stage: (k && k.stage) || "", asset: (k && (k.asset || k.symbol || shortMint(k.mint))) || "" };
    rec.n += 1;
    reasonMap.set(reason, rec);
  });
  const top = [...reasonMap.values()].sort((a, c) => c.n - a.n).slice(0, 5);
  const stageKeys = Object.keys(counts);
  const countHtml = stageKeys.length
    ? `<div class="fun-stages">${stageKeys.map((k) => {
        const lab = FLOOR_STAGE_LABEL[canon(k)] || String(k).toUpperCase();
        return `<span class="fun-chip"><i>${esc(lab)}</i> ${esc(String(counts[k]))}</span>`;
      }).join("")}</div>`
    : "";
  const killHtml = top.length
    ? `<div class="fun-kills">${top.map((r) => `<div class="fun-kill"><b>×${r.n}</b> ${esc(r.reason)}${r.stage ? ` <span class="dd">${esc(FLOOR_STAGE_LABEL[canon(r.stage)] || r.stage)}</span>` : ""}</div>`).join("")}</div>`
    : (kills.length ? "" : `<div class="dd">No kills recorded</div>`);
  if (!countHtml && !top.length && !kills.length) return `<div class="wait">No funnel data yet</div>`;
  return `<div class="funnel">${countHtml}${killHtml}</div>`;
}
function renderHome() {
  const b = B(), s = b.state, ch = b.chart || {}, runStates = (s.agents || []).map(agentRunState), run = runStates.filter((st) => st === "running").length, nIdle = runStates.filter((st) => st === "idle").length, nWaiting = runStates.filter((st) => st === "waiting").length, nStopped = runStates.filter((st) => st === "stopped").length, nStale = runStates.filter((st) => st === "stale").length;
  const mult = ch.multiplier, el = $("#v-home");
  if (!$("#bal")) {
    el.innerHTML = `<div class="label">Portfolio</div>
      <div class="hero"><div class="bal" id="bal"></div><span class="pill paper" id="paperpill"></span></div>
      <div class="sub"><span id="pnl"></span><span class="pill mult" id="mult"></span></div>
      <div class="sec" style="margin-top:16px"><h2>Limits</h2></div><div class="card" id="limwrap"></div>
      <div class="sec"><h2>Tickets</h2></div><div id="tixwrap"></div>
      <div class="card" style="margin-top:8px"><div class="sec" style="margin:0 0 8px"><h2 style="font-size:16px">Desk cycle</h2></div><div id="pipeline"></div></div>
      <div class="sec" id="desknet"><h2>Trading floor</h2></div><div class="card" id="netwrap"></div>
      <div class="sec"><h2>Floor status</h2></div><div id="bstatwrap"></div>
      <div class="chartwrap"><canvas class="ch" id="homechart"></canvas></div>
      <div class="ranges" id="ranges">${Object.keys(RANGE_S).map((r) => `<button data-r="${r}">${r}</button>`).join("")}</div>
      <div class="sec"><h2>Ideas for you</h2></div><div class="card" id="ideaswrap"></div>
      <div id="poswrap"></div>
      <div class="sec"><h2 id="agh"></h2></div><div class="car" id="car"></div>
      <div class="sec"><h2>Activity</h2><button data-go="activity">See all</button></div><div class="card list" id="homeact"></div>
      <div class="statusline" id="statusline"></div>`;
  }
  odo($("#bal"), money((Number(s.stack_usd) || 0) + (s.positions || []).filter((p) => p.status === "open").reduce((a, p) => a + (Number(p.size_usd) || 0) * (Number(p.pnl_pct) || 0) / 100, 0)));
  const pl = $("#paperpill"); pl.textContent = s.mode; pl.className = "pill " + (s.mode === "PAPER" ? "paper" : "live");
  const pp = $("#pnl"); pp.textContent = pct(s.pnl_today_pct) + " today"; pp.className = s.pnl_today_pct >= 0 ? "green" : "red";
  const mp = $("#mult"); mp.textContent = (mult || 1).toFixed(2) + "x"; mp.className = "pill mult" + ((mult || 1) < 1 ? " down" : "");
  $("#ranges").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.r === range));
  const limEl = $("#limwrap"); if (limEl) limEl.innerHTML = limitsHtml(b);
  const tixEl = $("#tixwrap"); if (tixEl) tixEl.innerHTML = ticketsHtml(b);
  const pipeEl = $("#pipeline"); if (pipeEl) pipeEl.innerHTML = pipelineHtml(b);
  const netEl = $("#netwrap"); if (netEl) netEl.innerHTML = botNetworkHtml(s.agents || [], b);
  const bstEl = $("#bstatwrap"); if (bstEl) bstEl.innerHTML = botStatusCardsHtml(s.agents || [], b);
  const ideasEl = $("#ideaswrap"); if (ideasEl) ideasEl.innerHTML = ideasHtml(b);
  const open = (s.positions || []).filter((p) => p.status === "open");
  $("#poswrap").innerHTML = `<div class="sec"><h2>Paper positions</h2></div><div class="card">${paperTableHtml(b)}</div>` +
    (open.length ? `<div class="card list" style="margin-top:8px">${open.map((p) => `<div class="row" data-coin="${esc(p.mint)}"><div><div class="tt">${esc(p.name)}</div><div class="dd">${money(p.size_usd)} · stop ${px(p.stop)}${p.trail_active ? " · trail ON" : ""}</div></div><div class="${p.pnl_pct >= 0 ? "green" : "red"}">${pct(p.pnl_pct)}</div></div>`).join("")}</div>` : "");
  const aghBits = [];
  if (run) aghBits.push(run + " running");
  if (nIdle) aghBits.push(nIdle + " idle");
  if (nWaiting) aghBits.push(nWaiting + " waiting");
  if (nStopped) aghBits.push(nStopped + " stopped");
  if (nStale) aghBits.push(nStale + " stale");
  $("#agh").innerHTML = `Floor · <span class="${run ? "green" : "orange"}">${esc(aghBits.join(" · ") || "none")}</span>`;
  $("#car").innerHTML = orderAgents(s.agents).map((a) => { const rst = agentRunState(a); return `<div class="mini" data-go="agents"><div class="n">${catAvatar(a.name, 28)}<span class="dot ${stateDotClass(rst)}"></span>${esc(agentTitle(a.name))}</div><div class="c">${a.today}</div><div class="l">${esc(a.detail || agentLine(a))}</div></div>`; }).join("");
  const items = (b.activity.items || []).slice(0, 5);
  $("#homeact").innerHTML = items.length ? items.map(actRow).join("") : `<div class="empty">No activity yet</div>`;
  const age = Math.max(0, Math.round(Date.now() / 1000 - b.ts));
  $("#statusline").textContent = `${age > STALE_S ? "STALE" : "Live"} · updated ${new Date(b.ts * 1000).toLocaleTimeString()} (${age}s ago) · data via encrypted bundle, alerts via Telegram`;
  drawHome();
}
function decRow(d, a) { return `<div class="row" ${d.mint ? `data-${a === "auditor" ? "audit" : "coin"}="${esc(d.mint)}"` : ""}><div class="tt" style="font-size:14px;font-weight:400">${esc(d.text)}</div><div class="tm">${hhmm(d.t)}</div></div>`; }
function renderAgents() {
  const b = B(), s = b.state, hasPos = (s.positions || []).some((p) => p.status === "open");
  $("#v-agents").innerHTML = `<h1 class="t">Agents</h1>` + s.agents.map((a) => {
    const dec = (b.decisions && b.decisions[a.name] || a.decisions || []).slice(0, 20), st = agentRunState(a), all = openAgents[a.name], rows = all ? dec : dec.slice(0, 5);
    const lock = a.name === "risk" && hasPos;
    const noteLabel = st === "stopped" ? "Stopped" : st === "stale" ? "No heartbeat" : st === "idle" ? "Idle" : "Running";
    return `<div class="card"><div class="ac-h">${catAvatar(a.name, 36)}<span class="dot ${stateDotClass(st)}"></span><div class="nm">${esc(agentTitle(a.name))}</div><div class="cnt">today <b style="color:#fff">${a.today}</b></div>
      <button class="sw ${a.paused ? "" : "on"}" data-sw="${a.name}" ${lock ? "disabled" : ""} aria-label="${a.name} ${a.paused ? "paused" : st}"></button></div>
      ${agentExtrasHtml(a, st)}
      <div class="note">${noteLabel} · ${esc(a.detail || "")}${lock ? " · cannot be paused while a position is open" : ""}</div>
      <div class="list">${rows.length ? rows.map((d) => decRow(d, a.name)).join("") : `<div class="empty">No decisions yet</div>`}</div>
      ${dec.length > 5 ? `<button class="more" data-more="${a.name}">${all ? "Show less" : `Show all ${dec.length}`}</button>` : ""}</div>`;
  }).join("") + `<div class="note">Pause/resume cannot call the desk directly from this page. Tapping a switch opens Telegram ${esc(b.links.bot_name)} with the command.</div>`;
}
function renderActivity() {
  const b = B(), items = (b.activity && b.activity.items) || [];
  $("#v-activity").innerHTML = `<h1 class="t">Activity</h1>
    <div class="sec" id="deskchat"><h2>Trading Floor</h2></div>
    <div class="card chat-card">${chatHtml(b)}</div>
    <div class="sec" id="funnelhd"><h2>Funnel</h2></div><div class="card" id="funnelwrap">${funnelHtml(b)}</div>
    <div class="sec"><h2>Journal</h2></div><div class="card" id="jnlwrap">${journalHtml(b)}</div>
    <div class="sec"><h2>Weekly report</h2></div><div class="card" id="weekwrap">${weeklyHtml(b)}</div>
    <div class="sec"><h2>Activity log</h2></div>
    <div class="card list" id="actlog">${items.length ? items.map(actRow).join("") : `<div class="empty">No activity yet</div>`}</div>
    <div class="note">Scanner kills and graduations are left out of this feed (hundreds per night); they are in each agent’s decision list.</div>`;
}
function renderAccount() {
  const b = B(), a = b.account, L = b.links, live = a.mode === "LIVE";
  $("#v-account").innerHTML = `<h1 class="t">Account</h1>
    <div class="card"><div class="kv"><span>Mode</span><span class="${live ? "red" : "orange"}">${a.mode}</span></div>
      <div class="seg" style="margin:10px 0"><button data-mode="PAPER" class="${live ? "" : "on paper"}">${live ? "Simulation" : "PAPER"}</button><button data-mode="LIVE" class="${live ? "on" : ""}">LIVE</button></div>
      <div class="note">${a.live_gate && a.live_gate.ready ? "LIVE is unlocked: it needs a typed LIVE confirmation in Telegram." : "LIVE stays gated: " + esc(a.live_gate ? a.live_gate.reason : "")}</div></div>
    <div class="card"><div class="kv"><span>Stack</span><span>${money(a.stack_usd)}</span></div><div class="kv"><span>In positions</span><span>${money(a.in_positions_usd)}</span></div>
      <div class="kv"><span>Free</span><span>${money(a.free_usd)}</span></div><div class="kv"><span>P&amp;L today</span><span class="${a.pnl_today_usd >= 0 ? "green" : "red"}">${(a.pnl_today_usd >= 0 ? "+" : "-") + money(Math.abs(a.pnl_today_usd))}</span></div>
      <div class="kv"><span>Fees paid (after ${Math.round(a.fees_ref_discount * 100)}% referral discount)</span><span>${money(a.fees_paid_usd)}</span></div>
      <div class="field"><input id="stackin" type="number" inputmode="decimal" min="1" value="${a.stack_usd.toFixed(2)}" aria-label="Stack"><button class="btn sm" data-stack>Set stack</button></div>
      <div class="note">Stack changes go through Telegram (${esc(L.bot_name)}).</div></div>
    <div class="card"><a class="link" href="#" data-settings><span>Settings<br><span class="muted" style="font-size:13px">All ${Object.keys(b.settings || {}).filter((k) => /^(scanner|auditor|analyst|executor|risk|desk)\./.test(k) && !k.endsWith("_source") && !k.endsWith("key_present") && !["desk.fees_ref_discount", "scanner.copycat_min_gain_pct"].includes(k)).length} settings · tap to change via Telegram</span></span><span class="chev">›</span></a></div>
    <div class="card"><a class="link" href="${esc(L.profile_url)}" target="_blank" rel="noopener"><span>Your FOMO profile<br><span class="muted" style="font-size:13px">${esc(L.fomo_handle)}</span></span><span class="chev">›</span></a>
      <a class="link" href="#" data-invite><span>Invite a friend</span><span class="chev">›</span></a></div>
    <div class="card"><div class="kv"><span>Alerts</span><span>Telegram ${esc(L.bot_name)}</span></div><div class="note">Web push isn’t available in this static, no-server setup. Every buy/sell alert arrives in Telegram with its FOMO button.</div></div>
    <div class="statusline">Bundle #${b.seq} · ${new Date(b.ts * 1000).toLocaleTimeString()}</div>`;
}


/* ---------- SETTINGS screen: every setting, tap -> Telegram `set <key> to <value>` (copy + deep link) ---------- */
const SETSPEC = [
  ["scanner", [["min_liquidity_usd", "Min liquidity", "$"], ["max_top10_pct", "Max top 10 holders", "%"], ["max_h1_change_pct", "Max 1h change", "%"], ["poll_s", "Poll every", "s"], ["min_pool_age_min", "Min pool age", "min"], ["max_wait_min", "Max wait", "min"]]],
  ["auditor", [["enabled", "Enabled", "bool"], ["max_dev_pct", "Max dev wallet", "%"], ["max_top10_pct", "Max top 10 holders", "%"], ["min_lp_locked_pct", "Min LP locked/burned", "%"], ["max_bundled", "Max bundled wallets", ""], ["max_delegated_accounts", "Max delegated accounts", ""], ["retries", "Retries", ""]]],
  ["analyst", [["mode", "Mode", "enum:rules|jev"], ["min_alive_6h", "Min alive 6h", ""], ["min_organic", "Min organic", ""], ["max_chase", "Max chase", ""], ["min_score", "Min score", ""], ["timeout_s", "Timeout", "s"]]],
  ["executor", [["stack_pct", "Ticket size (% of stack)", "%"], ["max_pool_pct", "Max % of pool liquidity", "%"], ["min_ticket_usd", "Min ticket", "$"], ["below_min", "Below minimum", "enum:bump|skip"], ["recheck_liq_drop_pct", "Re-check liq drop", "%"], ["recheck_price_up_pct", "Re-check price up", "%"]]],
  ["risk", [["poll_s", "Poll every", "s"], ["stop_pct", "Stop loss", "%"], ["trail_start_pct", "Trail starts at", "%"], ["trail_pct", "Trail", "%"], ["timeout_h", "Timeout", "h"]]],
  ["desk", [["mode", "Mode", "ro"], ["paper_start_stack", "Simulation start stack", "ro$"], ["report_time", "Report time", "time"], ["rpc_url", "RPC", "rpc"], ["push_rejects", "Push rejects", "bool"]]],
];
const fmtSet = (v, u) => v === true ? "true" : v === false ? "false" : u === "$" || u === "ro$" ? "$" + Number(v).toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(+v) ? 0 : 2, maximumFractionDigits: 2 }) : u === "%" ? v + "%" : ["s", "min", "h"].includes(u) ? v + u : String(v);
function renderSettings(push = true) {
  const b = B(), S = b.settings || {}, tc = b.account.ticket_check, el = $("#s-settings");
  const groups = SETSPEC.map(([ag, rows]) => `<div class="sg">${ag}</div><div class="card" style="padding:2px 16px">${rows.map(([k, label, u]) => {
    const key = ag + "." + k, v = S[key], ro = u === "ro" || u === "ro$" || (u === "rpc" && S["desk.rpc_url_source"] === "env");
    const shown = u === "rpc" ? String(v).replace(/^https:\/\//, "").split(" ")[0].replace(/^mainnet\./, "") : fmtSet(v, u);
    return `<div class="srow" data-set="${key}"><div class="k">${label}<small>${key}</small></div><div class="v ${ro ? "ro" : ""}">${esc(shown)}${ro ? " 🔒" : ""}</div><span class="chev">›</span></div>`;
  }).join("")}</div>`).join("");
  el.innerHTML = `<div class="top"><button data-back>‹ Back</button><div class="ttl">Settings</div></div>
    <div class="tkt ${tc.branch}">${esc(tc.msg)}</div>
    <div class="note" style="margin:0 4px 6px">Tap a setting to change it. The app is read-only (no server), so it copies <span class="mono">set &lt;key&gt; to &lt;value&gt;</span> and opens ${esc(b.links.bot_name)}; send it there and the desk applies it live, no restart. Risk changes apply to new positions only.${S["analyst.mode"] === "jev" && !S["analyst.key_present"] ? " Analyst runs in rules mode (no Jev key)." : ""}</div>${groups}
    <div class="statusline" style="margin-top:14px">Values from bundle #${b.seq}</div>`;
  show("s-settings", push);
}
function openSheet(key) {
  const b = B(), S = b.settings, spec = SETSPEC.flatMap(([ag, rows]) => rows.map((r) => [ag + "." + r[0], ...r])).find((r) => r[0] === key); if (!spec) return;
  const [, , label, u] = spec, cur = S[key];
  if (u === "ro" || u === "ro$") return toast(`${label} is read-only here: ${key === "desk.mode" ? "use the mode switch on Account (LIVE is gated)" : "the simulation start stack is fixed; use `stack N` for the balance"}`);
  if (u === "rpc" && S["desk.rpc_url_source"] === "env") return toast("RPC is set by the desk’s environment (key never stored or shown); change it on the box");
  const opts = u === "bool" ? ["true", "false"] : u.startsWith("enum:") ? u.slice(5).split("|") : null;
  const field = opts ? `<select id="sv">${opts.map((o) => `<option ${String(cur) === o ? "selected" : ""}>${o}</option>`).join("")}</select>` : `<input id="sv" inputmode="${u === "time" || u === "rpc" ? "text" : "decimal"}" value="${esc(u === "rpc" ? "" : String(cur))}" placeholder="${esc(String(cur))}" autocomplete="off">`;
  const sh = $("#sheet"); sh.hidden = false;
  sh.innerHTML = `<div class="pane"><h3>${esc(label)}</h3><div class="muted" style="font-size:13px">${key} · now ${esc(fmtSet(cur, u))}</div>${field}<div class="cmd" id="scmd"></div>
    <div class="btns"><button class="btn sm" style="background:var(--card2)" data-sheetclose>Cancel</button><button class="btn sm" data-sheetgo="${key}">Copy &amp; open Telegram</button></div></div>`;
  const upd = () => { $("#scmd").textContent = `set ${key} to ${$("#sv").value}`; }; $("#sv").addEventListener("input", upd); $("#sv").addEventListener("change", upd); upd();
}
function sheetGo(key) {
  const v = $("#sv").value.trim().replace(/[%$]/g, ""); if (!/^[A-Za-z0-9.:]+$/.test(v)) return toast("Enter a plain value (letters, numbers, . or :)");
  $("#sheet").hidden = true;
  tgCommand(`set ${key} to ${v}`, "set__" + key.replace(".", "_") + "__" + v.replace(/\./g, "d").replace(/:/g, "c"), "Change setting");
}

/* ---------- COIN screen ---------- */
let coinMint = null;
function candleChart(cv, d, rl) {
  const { c, w, h } = setupCanvas(cv, 300), cs = (d.candles && d.candles.candles) || [];
  if (cs.length < 1) { c.fillStyle = MUTED; c.font = "14px Roboto, system-ui"; c.fillText("No price samples for this coin yet.", 16, 40); return; }
  const volH = 56, top = 14, ph = h - volH - top - 14;
  let lo = Math.min(...cs.map((x) => x[3])), hi = Math.max(...cs.map((x) => x[2]));
  if (rl && rl.price) { lo = Math.min(lo, rl.price); hi = Math.max(hi, rl.price); }
  if (hi <= lo) { const m = hi || 1; lo = m * 0.99; hi = m * 1.01; } const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
  const n = Math.max(cs.length, 8), cw = (w - 24) / n, Y = (v) => top + (1 - (v - lo) / (hi - lo)) * ph, vmax = Math.max(1, ...cs.map((x) => x[5]));
  c.strokeStyle = SEP; c.lineWidth = 0.5; for (let i = 0; i < 4; i++) { const y = top + (ph * i) / 3; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.fillStyle = MUTED; c.font = "10px 'Roboto Mono', monospace"; c.textBaseline = "alphabetic"; c.fillText(px(hi), w - 56, top + 10); c.fillText(px(lo), w - 56, top + ph - 3);
  cs.forEach((k, i) => { const x = 12 + i * cw + cw / 2, up = k[4] >= k[1], col = up ? GREEN : RED;
    c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x, Y(k[2])); c.lineTo(x, Y(k[3])); c.stroke();
    const y1 = Y(k[1]), y2 = Y(k[4]); c.fillStyle = col; c.fillRect(x - cw * 0.3, Math.min(y1, y2), cw * 0.6, Math.max(1.5, Math.abs(y2 - y1)));
    const vh = (k[5] / vmax) * (volH - 6); c.globalAlpha = 0.55; c.fillRect(x - cw * 0.3, h - 14 - vh, cw * 0.6, vh); c.globalAlpha = 1; });
  if (rl && rl.price) { const y = Y(rl.price); c.setLineDash([6, 5]); c.strokeStyle = ORANGE; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); c.setLineDash([]); pill(c, 8, y - 13, "Risk trailing stop " + px(rl.price), ORANGE, "left"); }
  c.fillStyle = MUTED; c.font = "10px 'Roboto Mono', monospace"; c.fillText("vol", 12, h - 14 - volH + 8);
}
function openCoin(mint, push = true) {
  const b = B(), d = b.coins[mint]; coinMint = mint;
  const el = $("#s-coin"), pos = d && d.position, open = pos && pos.status === "open", test = d && d._test;
  if (!d) { el.innerHTML = `<div class="top"><button data-back>‹ Back</button><div class="ttl">Coin</div></div><div class="empty">This coin is not in the current bundle (only open + recent coins are published).</div>`; }
  else {
    const last = d.candles && d.candles.candles && d.candles.candles.length ? d.candles.candles[d.candles.candles.length - 1][4] : null;
    const cdl = d.candles || {}, thin = !cdl.candles || cdl.candles.length < 5;
    const sc = d.scan, au = d.audit, vd = d.verdict;
    el.innerHTML = `<div class="top"><button data-back>‹ Back</button><div class="ttl">${esc(d.name || mint.slice(0, 6))}</div></div>
      ${test ? `<div class="testbar">TEST DATA — rendered from a database copy of a real coin, not a live desk position</div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:baseline"><div><div class="label">${esc(d.symbol || "")} · ${esc(d.status)}</div><div style="font-size:40px;font-weight:600;letter-spacing:-.02em">${last ? "$" + px(last) : "—"}</div></div><span class="pill grey mono">${esc(d.mint.slice(0, 4))}…${esc(d.mint.slice(-4))}</span></div>
      <div class="chartwrap" style="margin-top:8px"><canvas class="ch" id="candles"></canvas></div>
      <div class="note">${cdl.candles && cdl.candles.length ? `${cdl.candles.length} real candle${cdl.candles.length > 1 ? "s" : ""} (${cdl.bucket_s / 60}-min) built from ${cdl.n_samples} price samples. Volume bars = rolling 5-minute volume from DexScreener.` : "No price samples yet."}${thin ? " Data is thin, so only what’s real is shown." : ""}</div>
      <div class="card"><div class="ac-h" style="margin-bottom:6px"><div class="nm" style="font-size:17px">Your position</div></div>${pos ? `
        <div class="kv"><span>Status</span><span class="${open ? "green" : ""}">${esc(pos.status)}${pos.exit_reason ? " · " + esc(pos.exit_reason) : ""}</span></div>
        <div class="kv"><span>Entry</span><span>$${px(pos.entry_price)}</span></div><div class="kv"><span>Size</span><span>${money(pos.size_usd)}</span></div>
        <div class="kv"><span>${open ? "Unrealized" : "Result"}</span><span class="${(open ? 100 * ((pos.last_price || pos.entry_price) / pos.entry_price - 1) : pos.pnl_pct) >= 0 ? "green" : "red"}">${open ? pct(100 * ((pos.last_price || pos.entry_price) / pos.entry_price - 1)) : pct(pos.pnl_pct) + " (" + money(pos.pnl_usd) + ")"}</span></div>
        <div class="kv"><span>Stop</span><span>$${px(pos.stop_price)}</span></div><div class="kv"><span>Trail</span><span>${pos.trail_active ? "ON (never off)" : "off — arms at +" + (d.risk_line ? d.risk_line.trail_start_pct : 20) + "%"}</span></div>`
        : `<div class="empty" style="padding:6px 0">No position in this coin.</div>`}</div>
      <div class="card"><div class="kv"><span>Scanner</span><span>${sc ? (sc.passed ? "pass" : esc(sc.reason)) : "waiting room"}</span></div>
        <div class="kv"><span>Auditor</span><span>${au ? (au.passed ? "8/8" : "failed L" + au.failed_layer) : "not audited"}</span></div>
        <div class="kv"><span>Analyst</span><span>${vd ? "score " + vd.score + (vd.passed ? " pass" : " no") : "—"}</span></div>
        ${au ? `<div style="margin-top:8px"><button class="btn sm" data-audit="${esc(mint)}" style="width:100%">Open Auditor</button></div>` : ""}</div>
      <a class="btn ${open ? "red" : "green"}" href="${esc(d.fomo_url)}" target="_blank" rel="noopener">${open ? "Sell on FOMO" : "Buy on FOMO"}</a>`;
  }
  show("s-coin", push); if (d) candleChart($("#candles"), d, d.risk_line);
}

/* ---------- AUDITOR screen ---------- */
let beamRAF = 0;
function openAudit(mint, push = true) {
  const b = B(), a = b.audits[mint], coin = b.coins[mint], el = $("#s-audit"), test = a && a._test;
  if (!a) { el.innerHTML = `<div class="top"><button data-back>‹ Back</button><div class="ttl">Auditor</div></div><div class="empty">No audit in the bundle for this coin (it was killed by the Scanner or hasn’t been audited yet).</div>`; show("s-audit", push); return; }
  el.innerHTML = `<div class="top"><button data-back>‹ Back</button><div class="ttl">${esc(a.name || "Auditor")}</div></div>
    ${test ? `<div class="testbar">TEST — this is a database copy of a real audit of Maya (a real coin), rendered for proof; not a live desk audit</div>` : ""}
    <div style="display:flex;justify-content:space-between;align-items:center"><div><div class="label">Auditor</div><div style="font-size:30px;font-weight:700">${a.passed ? "8/8 safe" : "Rejected"}</div></div><span class="pill ${a.passed ? "mult" : "mult down"}">${a.passed ? "PASS" : "FAIL L" + a.failed_layer}</span></div>
    <canvas class="ch" id="discs" style="margin-top:6px"></canvas>
    <div class="card list" id="vals">${a.layers.map((l) => `<div class="val"><div class="n ${l.status === "pass" ? "pass" : l.status === "fail" ? "fail" : ""}" data-n="${l.n}">${l.n}</div><div><div class="t1">${esc(l.name)}</div><div class="t2">${esc(l.status === "not_checked" ? "not checked (an earlier layer failed)" : l.detail || "")}</div></div></div>`).join("")}</div>
    <a class="btn" href="${esc(a.fomo_url)}" target="_blank" rel="noopener">Open on FOMO</a>`;
  show("s-audit", push); animateDiscs(a);
}
function animateDiscs(a) {
  cancelAnimationFrame(beamRAF); const cv = $("#discs"); if (!cv) return; const H = 300, { c, w } = setupCanvas(cv, H);
  const n = 8, top = 34, step = (H - top - 26) / n, T = 2600, t0 = performance.now();
  const frame = (now) => { const p = Math.min(1, (now - t0) / T), by = top + p * (n * step); c.clearRect(0, 0, w, H);
    for (let i = n - 1; i >= 0; i--) { const L = a.layers[i], y = top + i * step + step / 2, done = by > y, st = !done ? "pending" : L.status;
      const rx = w * 0.21, ry = 13, th = 11, col = st === "pass" ? ["#00d35a", "#00a847"] : st === "fail" ? ["#ff453a", "#c9382e"] : st === "not_checked" ? ["#3a3a3c", "#2c2c2e"] : ["#48484a", "#3a3a3c"], cx = w * 0.42;
      c.fillStyle = col[1]; c.beginPath(); c.ellipse(cx, y + th, rx, ry, 0, 0, Math.PI); c.lineTo(cx - rx, y); c.lineTo(cx + rx, y); c.closePath(); c.fill();
      c.fillStyle = col[0]; c.beginPath(); c.ellipse(cx, y, rx, ry, 0, 0, 7); c.fill();
      if (done) { c.strokeStyle = st === "not_checked" ? "#8e8e93" : "#fff"; c.lineWidth = 2.5; c.lineCap = "round"; c.beginPath();
        if (st === "pass") { c.moveTo(cx - 7, y); c.lineTo(cx - 2, y + 4); c.lineTo(cx + 8, y - 5); } else if (st === "fail") { c.moveTo(cx - 6, y - 5); c.lineTo(cx + 6, y + 5); c.moveTo(cx + 6, y - 5); c.lineTo(cx - 6, y + 5); } else { c.moveTo(cx - 6, y); c.lineTo(cx + 6, y); } c.stroke(); }
      c.fillStyle = MUTED; c.font = "11px 'Roboto Mono', monospace"; c.textBaseline = "middle"; c.fillText(String(i + 1), 14, y); c.textAlign = "right"; c.fillText(L.name, w - 14, y); c.textAlign = "left"; }
    if (p < 1) { c.fillStyle = CYAN; c.fillRect(10, by - 1, w - 20, 2); c.fillStyle = "rgba(100,210,255,.12)"; c.fillRect(10, by - 14, w - 20, 14); beamRAF = requestAnimationFrame(frame); } };
  beamRAF = requestAnimationFrame(frame);
}

/* ---------- navigation ---------- */
function show(id, push) { document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id)); if (push) { history.pushState({ s: id }, ""); stack.push(id); } $("#" + id).scrollTop = 0; }
function closeScreens() { cancelAnimationFrame(beamRAF); document.querySelectorAll(".screen").forEach((s) => (s.hidden = true)); stack = []; }
window.addEventListener("popstate", () => { if (stack.length) { stack.pop(); if (stack.length) { const id = stack[stack.length - 1]; document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id)); } else closeScreens(); } });
function setTab(t) { tab = t; closeScreens(); document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "v-" + t)); document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === t)); window.scrollTo(0, 0); render(); if (t === "home") drawHome(); }
function render() { const b = B(); if (!b) return; const mb = $("#modebar"), md = b.state.mode; mb.hidden = false; mb.className = md === "PAPER" ? "paper" : "live"; mb.textContent = md === "PAPER" ? "PAPER · simulated fills, no real money" : "LIVE · money moves only when you tap Buy on FOMO"; ({ home: renderHome, agents: renderAgents, activity: renderActivity, account: renderAccount })[tab](); const sb = $("#stale"), age = Date.now() / 1000 - b.ts; sb.hidden = age <= STALE_S; sb.textContent = `STALE · last update ${Math.round(age)}s ago`; }

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab],[data-go],[data-r],[data-coin],[data-audit],[data-back],[data-sw],[data-more],[data-mode],[data-stack],[data-invite],[data-settings],[data-set],[data-sheetclose],[data-sheetgo],[data-copy]"); if (!t) return;
  const D = t.dataset, b = B();
  if (D.settings !== undefined) { e.preventDefault(); renderSettings(); }
  else if (D.copy) { e.preventDefault(); try { await navigator.clipboard.writeText(D.copy); toast("Mint copied"); } catch (err) { toast("Could not copy mint"); } }
  else if (D.set) openSheet(D.set); else if (D.sheetclose !== undefined) $("#sheet").hidden = true; else if (D.sheetgo) sheetGo(D.sheetgo);
  else if (D.tab) setTab(D.tab); else if (D.go) setTab(D.go);
  else if (D.r) { range = D.r; renderHome(); }
  else if (D.coin) openCoin(D.coin); else if (D.audit !== undefined) { e.preventDefault(); b.audits[D.audit] ? openAudit(D.audit) : openCoin(D.audit); }
  else if (D.back !== undefined) history.back();
  else if (D.sw) { const a = b.state.agents.find((x) => x.name === D.sw); tgCommand(`${a.paused ? "resume" : "pause"} ${D.sw}`, `${a.paused ? "resume" : "pause"}_${D.sw}`, a.paused ? "Resume" : "Pause"); }
  else if (D.more) { openAgents[D.more] = !openAgents[D.more]; renderAgents(); }
  else if (D.mode) { const m = D.mode; if (m === b.account.mode) return; if (m === "PAPER") tgCommand("paper", "paper", "Switch to simulation");
    else if (!(b.account.live_gate && b.account.live_gate.ready)) toast("LIVE stays gated: " + b.account.live_gate.reason); else { await navigator.clipboard.writeText("live").catch(() => {}); toast("Send “live” in Telegram, then type LIVE to confirm."); window.open(b.links.bot_url, "_blank", "noopener"); } }
  else if (D.stack !== undefined) { const v = parseFloat($("#stackin").value); if (v > 0) tgCommand(`stack ${v}`, `stack_${v}`, "Set stack"); else toast("Enter a stack amount"); }
  else if (D.invite !== undefined) { e.preventDefault(); const u = b.links.signup_url; if (navigator.share) { navigator.share({ title: "FOMO", text: "Join me on FOMO", url: u }).catch(() => {}); } else { await navigator.clipboard.writeText(u).catch(() => {}); toast("Invite link copied"); } }
});

/* ---------- boot ---------- */
async function load() {
  const key = getKey(); if (!key) { $("#locked").hidden = false; $("#app").hidden = true; return; }
  try {
    const res = await fetch("https://gist.githubusercontent.com/" + GIST + "/raw/d.enc?cb=" + Date.now(), { cache: "no-store" }); if (!res.ok) throw new Error("HTTP " + res.status);
    const bnd = await decryptBlob(key, await res.text()); $("#locked").hidden = true; $("#app").hidden = false;
    if (bnd.seq >= lastSeq || !RAW) { lastSeq = bnd.seq; RAW = bnd; }
    render(); if (!$("#s-coin").hidden && coinMint) openCoin(coinMint, false);
  } catch (e) { if (e.name === "OperationError") { $("#locked").hidden = false; $("#app").hidden = true; return; } if (RAW) { render(); toast("Offline — showing last data"); } }
}
/* test-only hook: lets proof screenshots render a database-copy audit/coin, flagged TEST on screen */
window.desk = { setBundle(o) { RAW = o; render(); }, inject(p) { Object.entries(p.coins || {}).forEach(([k, v]) => (TEST.coins[k] = { ...v, _test: true })); Object.entries(p.audits || {}).forEach(([k, v]) => (TEST.audits[k] = { ...v, _test: true })); render(); }, openCoin: (m) => openCoin(m), openAudit: (m) => openAudit(m), setTab, get coinList() { return B() ? Object.entries(B().coins).map(([m, c]) => ({ m, n: c.candles && c.candles.candles ? c.candles.candles.length : 0, name: c.name })) : []; }, get bundleKeys() { return RAW ? Object.keys(RAW) : []; } };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("resize", () => { if (tab === "home" && B()) drawHome(); });
load(); setInterval(load, POLL_MS); document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
