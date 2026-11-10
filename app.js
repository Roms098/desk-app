/* Trading Desk app. Plan B: reads the AES-GCM encrypted gist bundle (key from #k=, kept in localStorage).
   Every number/URL shown comes from the bundle. FOMO URLs are used exactly as the bundle gives them. */
"use strict";
const GIST = "Roms098/89b376e2de7abda5a19e7279e6fffd70";
const LS_KEY = "desk_data_key";
const POLL_MS = 20000, STALE_S = 180;
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const GREEN = "#00d35a", RED = "#ff453a", ORANGE = "#ff9f0a", CYAN = "#64d2ff", BLUE = "#0a84ff", MUTED = "rgba(235,235,245,0.6)", SEP = "rgba(84,84,88,0.55)";
const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];

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
const ROLE_MAP = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
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
function statePillClass(st) {
  const s = String(st || "idle").toLowerCase().replace(/\s+/g, "");
  if (s.includes("veto") || s === "down" || s === "error" || s === "off") return "veto";
  if (s.includes("debat")) return "debating";
  if (s.includes("scan")) return "scanning";
  if (s.includes("analy")) return "analyzing";
  if (s.includes("consensus")) return "consensus";
  if (s.includes("idea")) return "idea";
  if (s === "ok" || s === "idle" || s === "ready" || s === "running") return "idle";
  return "ok";
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
function pipelineHtml(b) {
  const pipe = (b && b.pipeline) || (b && b.state && b.state.pipeline) || null;
  const stageRaw = pipe && (pipe.stage || pipe.current || pipe.step);
  if (!pipe || stageRaw == null || stageRaw === "") return WAIT;
  let idx = -1;
  const s = String(stageRaw).toUpperCase();
  idx = PIPE_STAGES.indexOf(s);
  if (idx < 0 && isFinite(Number(stageRaw))) idx = Math.max(0, Math.min(PIPE_STAGES.length - 1, Number(stageRaw)));
  if (idx < 0) idx = PIPE_STAGES.findIndex((p) => s.indexOf(p) >= 0);
  return `<div class="pipe">${PIPE_STAGES.map((name, i) => {
    const cls = i === idx ? "on" : (idx >= 0 && i < idx ? "done" : "");
    const arrow = i < PIPE_STAGES.length - 1 ? `<span class="pipe-arrow">→</span>` : "";
    return `<div class="pipe-stage ${cls}">${name}</div>${arrow}`;
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
    return `<tr ${mint ? `data-coin="${esc(mint)}"` : ""}><td>${agent}</td><td>${coin}</td><td>${esc(side)}</td><td>${esc(entry)}</td><td>${esc(now)}</td><td>${pnl}</td></tr>`;
  }).join("");
  return `<div class="pos-wrap"><table class="pos"><thead><tr><th>Agent</th><th>Coin</th><th>Side</th><th>Entry</th><th>Now</th><th>P&amp;L</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function chatHtml(b) {
  const list = pickList(b, "chat");
  if (!list) return WAIT;
  if (!list.length) return `<div class="wait">No desk chat yet</div>`;
  return list.slice(0, 30).map((m) => {
    const name = m.name || m.agent || m.bot || m.from || "?";
    const initial = String(name).trim().charAt(0).toUpperCase() || "?";
    const msg = m.message || m.text || m.body || "";
    const t = m.created_at || m.ts || m.t || m.time;
    const tShow = t != null ? hhmm(Number(t) < 1e12 ? Number(t) : Number(t) / 1000) : "";
    return `<div class="chat-line"><div class="avatar" aria-hidden="true">${esc(initial)}</div>
      <div class="chat-body"><div class="chat-meta"><span class="chat-name">${esc(name)}</span>${tShow ? `<span class="chat-time">${esc(tShow)}</span>` : ""}</div>
      <div class="chat-msg">${esc(msg)}</div></div></div>`;
  }).join("");
}
function agentExtrasHtml(a, st) {
  const role = a.role || ROLE_MAP[String(a.name || "").toLowerCase()] || "";
  const state = a.state || (a.paused ? "off" : st) || "idle";
  const last = a.last || a.detail || agentLine(a);
  const conv = convPct(a.conviction);
  const convHtml = conv != null
    ? `<div class="conv"><div class="conv-meta"><span>Conviction</span><span>${conv}%</span></div><div class="conv-bar"><i style="width:${conv}%"></i></div></div>`
    : "";
  return `${role ? `<div class="agent-role">${esc(role)}</div>` : ""}
    <div style="margin-top:8px"><span class="pill state ${statePillClass(state)}">${esc(state)}</span></div>
    ${convHtml}
    ${last ? `<div class="agent-last">${esc(last)}</div>` : ""}`;
}

/* ---------- views ---------- */
function agentLine(a) { const d = (a.decisions || [])[0]; return d ? d.text : "no decisions yet"; }
function agentState(a, b) { const fresh = a.last_beat && Date.now() / 1000 - a.last_beat < 120; return a.paused ? "off" : fresh ? "ok" : "down"; }
function actRow(i) {
  const col = { scan_pass: GREEN, audit_pass: GREEN, verdict_pass: GREEN, signal: BLUE, exit: ORANGE, audit_fail: RED, verdict_fail: RED, exec_skip: ORANGE }[i.kind] || "#48484a";
  return `<div class="row" ${i.mint ? `data-coin="${esc(i.mint)}"` : ""}><div class="main"><div class="ic" style="background:${col}"></div><div><div class="tt">${esc(i.title)}</div><div class="dd">${esc(i.detail || i.kind)}</div></div></div><div class="tm">${hhmm(i.created_at)}</div></div>`;
}
function renderHome() {
  const b = B(), s = b.state, ch = b.chart || {}, run = s.agents.filter((a) => agentState(a, b) === "ok").length;
  const mult = ch.multiplier, el = $("#v-home");
  if (!$("#bal")) {
    el.innerHTML = `<div class="label">Portfolio</div>
      <div class="hero"><div class="bal" id="bal"></div><span class="pill paper" id="paperpill"></span></div>
      <div class="sub"><span id="pnl"></span><span class="pill mult" id="mult"></span></div>
      <div class="card" style="margin-top:8px"><div class="sec" style="margin:0 0 8px"><h2 style="font-size:16px">Desk cycle</h2></div><div id="pipeline"></div></div>
      <div class="chartwrap"><canvas class="ch" id="homechart"></canvas></div>
      <div class="ranges" id="ranges">${Object.keys(RANGE_S).map((r) => `<button data-r="${r}">${r}</button>`).join("")}</div>
      <div class="sec"><h2>Ideas for you</h2></div><div class="card" id="ideaswrap"></div>
      <div id="poswrap"></div>
      <div class="sec"><h2 id="agh"></h2></div><div class="car" id="car"></div>
      <div class="sec"><h2>Activity</h2><button data-go="activity">See all</button></div><div class="card list" id="homeact"></div>
      <div class="statusline" id="statusline"></div>`;
  }
  odo($("#bal"), money(s.stack_usd + (s.positions || []).filter((p) => p.status === "open").reduce((a, p) => a + p.size_usd * (p.pnl_pct || 0) / 100, 0)));
  const pl = $("#paperpill"); pl.textContent = s.mode; pl.className = "pill " + (s.mode === "PAPER" ? "paper" : "live");
  const pp = $("#pnl"); pp.textContent = pct(s.pnl_today_pct) + " today"; pp.className = s.pnl_today_pct >= 0 ? "green" : "red";
  const mp = $("#mult"); mp.textContent = (mult || 1).toFixed(2) + "x"; mp.className = "pill mult" + ((mult || 1) < 1 ? " down" : "");
  $("#ranges").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.r === range));
  const pipeEl = $("#pipeline"); if (pipeEl) pipeEl.innerHTML = pipelineHtml(b);
  const ideasEl = $("#ideaswrap"); if (ideasEl) ideasEl.innerHTML = ideasHtml(b);
  const open = (s.positions || []).filter((p) => p.status === "open");
  $("#poswrap").innerHTML = `<div class="sec"><h2>Paper positions</h2></div><div class="card">${paperTableHtml(b)}</div>` +
    (open.length ? `<div class="card list" style="margin-top:8px">${open.map((p) => `<div class="row" data-coin="${esc(p.mint)}"><div><div class="tt">${esc(p.name)}</div><div class="dd">${money(p.size_usd)} · stop ${px(p.stop)}${p.trail_active ? " · trail ON" : ""}</div></div><div class="${p.pnl_pct >= 0 ? "green" : "red"}">${pct(p.pnl_pct)}</div></div>`).join("")}</div>` : "");
  $("#agh").innerHTML = `Agents · <span class="${run === 5 ? "green" : "orange"}">${run} running</span>`;
  $("#car").innerHTML = s.agents.map((a) => `<div class="mini" data-go="agents"><div class="n"><span class="dot ${agentState(a, b) === "ok" ? "" : agentState(a, b)}"></span>${a.name}</div><div class="c">${a.today}</div><div class="l">${esc(agentLine(a))}</div></div>`).join("");
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
    const dec = (b.decisions && b.decisions[a.name] || a.decisions || []).slice(0, 20), st = agentState(a, b), all = openAgents[a.name], rows = all ? dec : dec.slice(0, 5);
    const lock = a.name === "risk" && hasPos;
    return `<div class="card"><div class="ac-h"><span class="dot ${st === "ok" ? "" : st}"></span><div class="nm">${a.name}</div><div class="cnt">today <b style="color:#fff">${a.today}</b></div>
      <button class="sw ${a.paused ? "" : "on"}" data-sw="${a.name}" ${lock ? "disabled" : ""} aria-label="${a.name} ${a.paused ? "paused" : "running"}"></button></div>
      ${agentExtrasHtml(a, st)}
      <div class="note">${a.paused ? "Paused" : st === "down" ? "No heartbeat" : "Running"} · ${esc(a.detail || "")}${lock ? " · cannot be paused while a position is open" : ""}</div>
      <div class="list">${rows.length ? rows.map((d) => decRow(d, a.name)).join("") : `<div class="empty">No decisions yet</div>`}</div>
      ${dec.length > 5 ? `<button class="more" data-more="${a.name}">${all ? "Show less" : `Show all ${dec.length}`}</button>` : ""}</div>`;
  }).join("") + `<div class="note">Pause/resume cannot call the desk directly from this page. Tapping a switch opens Telegram ${esc(b.links.bot_name)} with the command.</div>`;
}
function renderActivity() {
  const b = B(), items = b.activity.items || [];
  $("#v-activity").innerHTML = `<h1 class="t">Activity</h1><div class="card list">${items.length ? items.map(actRow).join("") : `<div class="empty">No activity yet</div>`}</div>
    <div class="sec"><h2>Desk chat</h2></div><div class="card">${chatHtml(b)}</div>
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
