/* Lukz Post — app.js */
const C = window.PP_CONFIG;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
const FN = `${C.SUPABASE_URL}/functions/v1`;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NETS = { instagram: "IG", facebook: "f", youtube: "▶", tiktok: "♪", linkedin: "in" };
const NET_NAME = { instagram: "Instagram", facebook: "Facebook Page", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn" };
const TYPES = { instagram: ["post", "reel", "story"], facebook: ["post", "reel", "story"], youtube: ["short", "video"], tiktok: ["video"], linkedin: ["post"] };
const DEFAULT_TYPE = { instagram: "reel", facebook: "post", youtube: "short", tiktok: "video", linkedin: "post" };

const S = { user: null, accounts: [], posts: [], media: [], settings: {}, tz: C.DEFAULT_TZ, calView: "month", calDate: new Date(), editing: null, pick: new Set() };

// ---------------------------------------------------------------- utils
function toast(msg, bad = false) { const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 3500); }
function fmtDT(iso) { if (!iso) return "—"; return new Intl.DateTimeFormat("en-GB", { timeZone: S.tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
function fmtDay(iso) { return new Intl.DateTimeFormat("en-GB", { timeZone: S.tz, weekday: "short", day: "2-digit", month: "short" }).format(new Date(iso)); }
function partsInTz(d) { const p = {}; new Intl.DateTimeFormat("en-GB", { timeZone: S.tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).forEach((x) => (p[x.type] = x.value)); return p; }
function dayKey(iso) { const p = partsInTz(new Date(iso)); return `${p.year}-${p.month}-${p.day}`; }
function localInputValue(iso) { const p = partsInTz(new Date(iso)); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
function tzOffsetMinutes(date) { const p = partsInTz(date); const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); return (asUTC - date.getTime()) / 60000; }
function fromLocalInput(v) { // "YYYY-MM-DDTHH:MM" in S.tz -> ISO
  const [d, t] = v.split("T"); const [y, m, dd] = d.split("-").map(Number); const [hh, mm] = t.split(":").map(Number);
  let guess = new Date(Date.UTC(y, m - 1, dd, hh, mm)); const off = tzOffsetMinutes(guess); guess = new Date(guess.getTime() - off * 60000);
  const off2 = tzOffsetMinutes(guess); if (off2 !== off) guess = new Date(Date.UTC(y, m - 1, dd, hh, mm) - off2 * 60000); return guess.toISOString();
}
function dayKeyFromParts(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function num(n) { if (n == null) return "—"; n = Number(n); return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n); }
const accById = (id) => S.accounts.find((a) => a.id === id);
const netIcon = (n) => `<span class="net ${n}" title="${NET_NAME[n]}">${NETS[n]}</span>`;
const nav = (h) => (location.hash = h);
async function fn(name, body = {}, qs = "") {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${FN}/${name}${qs}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: C.SUPABASE_ANON_KEY }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j;
}

// ---------------------------------------------------------------- data
async function loadAll() {
  const [a, p, m, s] = await Promise.all([
    sb.from("pp_accounts_safe").select("*").order("connected_at"),
    sb.from("pp_posts").select("*").order("scheduled_at", { ascending: false }).limit(500),
    sb.from("pp_media").select("*").order("created_at", { ascending: false }).limit(300),
    sb.from("pp_settings").select("key,value"),
  ]);
  S.accounts = a.data || []; S.posts = p.data || []; S.media = m.data || [];
  S.settings = Object.fromEntries((s.data || []).map((r) => [r.key, r.value]));
  S.tz = S.settings.prefs?.timezone || C.DEFAULT_TZ;
}

// ---------------------------------------------------------------- router
const routes = { dashboard: renderDashboard, calendar: renderCalendar, posts: renderPosts, media: renderMedia, analytics: renderAnalytics, accounts: renderAccounts, settings: renderSettings };
async function route() {
  const h = (location.hash || "#/dashboard").slice(2); const [page, query] = h.split("?");
  const fnr = routes[page] || renderDashboard;
  $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === page));
  $("#main").innerHTML = `<div class="empty">Loading…</div>`;
  await fnr(new URLSearchParams(query || ""));
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- auth
async function init() {
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("#loginError").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("#loginEmail").value.trim(), password: $("#loginPass").value });
    if (error) $("#loginError").textContent = error.message;
  });
  $("#logoutBtn").onclick = () => sb.auth.signOut();
  $("#newPostBtn").onclick = () => openComposer();
  $$("[data-close]").forEach((b) => (b.onclick = () => b.closest(".modal").classList.add("hidden")));
  sb.auth.onAuthStateChange(async (_e, session) => {
    S.user = session?.user || null;
    $("#login").classList.toggle("hidden", !!S.user); $("#shell").classList.toggle("hidden", !S.user);
    if (S.user) { $("#userEmail").textContent = S.user.email; await loadAll(); route(); }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("#login").classList.remove("hidden"); }
}
init();

// ---------------------------------------------------------------- dashboard
async function renderDashboard() {
  const now = Date.now();
  const upcoming = S.posts.filter((p) => p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at) > now).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 8);
  const recent = S.posts.filter((p) => ["published", "partial", "failed"].includes(p.status)).slice(0, 6);
  const week = S.posts.filter((p) => p.published_at && now - new Date(p.published_at) < 7 * 864e5).length;
  const followers = S.accounts.reduce((t, a) => t + (a.meta?.followers || a.meta?.subscribers || 0), 0);
  const failed = S.posts.filter((p) => p.status === "failed").length;
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Good ${new Date().getHours() < 12 ? "morning" : "day"} 👋</h1><p class="muted">Here's what's happening across your channels.</p></div><button class="btn primary" onclick="openComposer()">+ New post</button></div>
    <div class="grid g4">
      <div class="card stat"><span class="muted small">Connected channels</span><span class="v">${S.accounts.length}</span><a href="#/accounts" class="d link">Manage →</a></div>
      <div class="card stat"><span class="muted small">Scheduled</span><span class="v">${S.posts.filter((p) => p.status === "scheduled").length}</span><a href="#/calendar" class="d link">Open calendar →</a></div>
      <div class="card stat"><span class="muted small">Published last 7 days</span><span class="v">${week}</span><span class="d muted">${failed ? `<span class="down">${failed} failed</span>` : "All good"}</span></div>
      <div class="card stat"><span class="muted small">Total audience</span><span class="v">${num(followers)}</span><a href="#/analytics" class="d link">Analytics →</a></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Up next</h3>${upcoming.length ? upcoming.map(postRow).join("") : `<div class="empty">Nothing scheduled. <button class="link" onclick="openComposer()">Create a post</button></div>`}</div>
      <div class="card"><h3>Recently published</h3>${recent.length ? recent.map(postRow).join("") : `<div class="empty">No published posts yet.</div>`}</div>
    </div>
    ${S.accounts.length ? "" : `<div class="card" style="margin-top:16px"><h2>Get started</h2><p class="muted">1. Add your API credentials in <a class="link" href="#/settings">Settings</a> &nbsp;2. Connect channels in <a class="link" href="#/accounts">Accounts</a> &nbsp;3. Create your first post.</p></div>`}`;
}

function postRow(p) {
  const m = p.media?.[0];
  const thumb = m ? (m.type === "video" ? `<video src="${esc(m.url)}#t=0.5" muted preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="">`) : "Text";
  const nets = (p.targets || []).map((t) => accById(t.account_id)).filter(Boolean).map((a) => netIcon(a.network)).join("");
  return `<div class="post-row" onclick="openComposer('${p.id}')" style="cursor:pointer"><div class="thumb">${thumb}</div><div><div class="row gap"><span class="pill ${p.status}">${p.status}</span><span class="muted small">${fmtDT(p.scheduled_at || p.created_at)}</span><span class="row" style="gap:3px">${nets}</span></div><div class="txt">${esc(p.text || p.title || "(no caption)")}</div></div><div></div></div>`;
}

// ---------------------------------------------------------------- calendar
async function renderCalendar() {
  const d = S.calDate; const y = d.getFullYear(), m = d.getMonth();
  const monthName = d.toLocaleString("en-GB", { month: "long", year: "numeric" });
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Calendar</h1><p class="muted">Drag a post to another day to reschedule it.</p></div>
      <div class="cal-head"><button class="btn sm" id="calPrev">‹</button><strong id="calLabel">${monthName}</strong><button class="btn sm" id="calNext">›</button><button class="btn sm" id="calToday">Today</button>
      <select id="calView" style="width:auto"><option value="month" ${S.calView === "month" ? "selected" : ""}>Month</option><option value="week" ${S.calView === "week" ? "selected" : ""}>Week</option></select><button class="btn primary sm" onclick="openComposer()">+ New post</button></div></div>
    <div id="calBody"></div>`;
  const step = S.calView === "month" ? (n) => S.calDate.setMonth(m + n) : (n) => S.calDate.setDate(d.getDate() + 7 * n);
  $("#calPrev").onclick = () => { step(-1); renderCalendar(); }; $("#calNext").onclick = () => { step(1); renderCalendar(); };
  $("#calToday").onclick = () => { S.calDate = new Date(); renderCalendar(); }; $("#calView").onchange = (e) => { S.calView = e.target.value; renderCalendar(); };
  if (S.calView === "month") drawMonth(y, m); else drawWeek();
}
function postsByDay() { const map = {}; for (const p of S.posts) { if (!p.scheduled_at) continue; const k = dayKey(p.scheduled_at); (map[k] ||= []).push(p); } for (const k in map) map[k].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)); return map; }
function chip(p) {
  const nets = (p.targets || []).map((t) => accById(t.account_id)).filter(Boolean).map((a) => netIcon(a.network)).join("");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: S.tz, hour: "2-digit", minute: "2-digit" }).format(new Date(p.scheduled_at));
  return `<div class="chip ${p.status}" draggable="true" data-id="${p.id}" onclick="openComposer('${p.id}')" title="${esc(p.text)}"><span class="nets">${nets}</span><b>${time}</b> ${esc((p.text || p.title || "Post").slice(0, 40))}</div>`;
}
function drawMonth(y, m) {
  const by = postsByDay(); const first = new Date(y, m, 1); const start = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(y, m + 1, 0).getDate(); const prevDays = new Date(y, m, 0).getDate();
  const tp = partsInTz(new Date()); const todayKey = `${tp.year}-${tp.month}-${tp.day}`;
  let html = `<div class="cal">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x) => `<div class="dow">${x}</div>`).join("")}`;
  const cells = [];
  for (let i = start - 1; i >= 0; i--) cells.push({ y, m: m - 1, d: prevDays - i, other: true });
  for (let i = 1; i <= days; i++) cells.push({ y, m, d: i });
  while (cells.length % 7) cells.push({ y, m: m + 1, d: cells.length - start - days + 1, other: true });
  for (const c of cells) {
    const dt = new Date(c.y, c.m, c.d); const k = dayKeyFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    html += `<div class="day ${c.other ? "other" : ""} ${k === todayKey ? "today" : ""}" data-day="${k}"><div class="dn"><span>${dt.getDate()}</span><span class="add" onclick="openComposer(null,'${k}')">+</span></div>${(by[k] || []).map(chip).join("")}</div>`;
  }
  $("#calBody").innerHTML = html + "</div>"; wireDnD();
}
function drawWeek() {
  const by = postsByDay(); const d = new Date(S.calDate); const dow = (d.getDay() + 6) % 7; const mon = new Date(d); mon.setDate(d.getDate() - dow);
  const days = [...Array(7)].map((_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x; });
  $("#calLabel").textContent = `${days[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  let html = `<div class="week"><div></div>${days.map((x) => `<div class="dow">${x.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</div>`).join("")}`;
  for (let h = 6; h < 24; h++) {
    html += `<div class="hr">${String(h).padStart(2, "0")}:00</div>`;
    for (const x of days) {
      const k = dayKeyFromParts(x.getFullYear(), x.getMonth() + 1, x.getDate());
      const items = (by[k] || []).filter((p) => +partsInTz(new Date(p.scheduled_at)).hour === h);
      html += `<div class="slot" data-day="${k}" data-hour="${h}">${items.map(chip).join("")}</div>`;
    }
  }
  $("#calBody").innerHTML = html + "</div>"; wireDnD();
}
function wireDnD() {
  $$(".chip[draggable]").forEach((c) => c.addEventListener("dragstart", (e) => e.dataTransfer.setData("id", c.dataset.id)));
  $$("[data-day]").forEach((cell) => {
    cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("drop"); });
    cell.addEventListener("dragleave", () => cell.classList.remove("drop"));
    cell.addEventListener("drop", async (e) => {
      e.preventDefault(); cell.classList.remove("drop"); const id = e.dataTransfer.getData("id"); const p = S.posts.find((x) => x.id === id); if (!p) return;
      if (["published", "partial", "publishing"].includes(p.status)) return toast("Published posts can't be moved", true);
      const old = partsInTz(new Date(p.scheduled_at)); const hour = cell.dataset.hour != null ? String(cell.dataset.hour).padStart(2, "0") : old.hour;
      const iso = fromLocalInput(`${cell.dataset.day}T${hour}:${old.minute}`);
      const { error } = await sb.from("pp_posts").update({ scheduled_at: iso }).eq("id", id); if (error) return toast(error.message, true);
      p.scheduled_at = iso; toast("Rescheduled to " + fmtDT(iso)); renderCalendar();
    });
  });
}

// ---------------------------------------------------------------- posts list
async function renderPosts(q) {
  const f = q.get("f") || "all";
  const list = S.posts.filter((p) => f === "all" || p.status === f);
  const tabs = ["all", "scheduled", "draft", "published", "failed"].map((t) => `<a class="btn sm ${f === t ? "primary" : ""}" href="#/posts?f=${t}">${t[0].toUpperCase() + t.slice(1)}</a>`).join(" ");
  $("#main").innerHTML = `<div class="page-head"><div><h1>Posts</h1></div><div class="row gap wrap">${tabs}<button class="btn primary sm" onclick="openComposer()">+ New post</button></div></div>
    <div class="card">${list.length ? list.map(postRowFull).join("") : `<div class="empty">No posts here.</div>`}</div>`;
}
function postRowFull(p) {
  const results = Object.entries(p.results || {}).map(([aid, r]) => { const a = accById(aid); if (!a) return ""; return `<span class="row" style="gap:4px">${netIcon(a.network)}<span class="pill ${r.status === "processing" ? "publishing" : r.status}">${r.status}</span>${r.url ? `<a class="link small" href="${esc(r.url)}" target="_blank">open</a>` : ""}${r.error ? `<span class="small down" title="${esc(r.error)}">${esc(r.error.slice(0, 60))}</span>` : ""}</span>`; }).join(" ");
  return postRow(p).replace("<div></div></div>", `<div class="row gap wrap" style="justify-content:flex-end" onclick="event.stopPropagation()">${results}<button class="btn sm" onclick="duplicatePost('${p.id}')">Duplicate</button>${p.status === "failed" || p.status === "partial" ? `<button class="btn sm" onclick="retryPost('${p.id}')">Retry</button>` : ""}<button class="btn sm danger-text" onclick="deletePost('${p.id}')">Delete</button></div></div>`);
}
async function duplicatePost(id) { const p = S.posts.find((x) => x.id === id); const { id: _i, created_at, updated_at, results, published_at, error, ...rest } = p; const { data, error: e } = await sb.from("pp_posts").insert({ ...rest, status: "draft", scheduled_at: null }).select().single(); if (e) return toast(e.message, true); S.posts.unshift(data); toast("Duplicated as draft"); openComposer(data.id); }
async function retryPost(id) { const p = S.posts.find((x) => x.id === id); const results = {}; for (const [k, r] of Object.entries(p.results || {})) if (r.status === "published") results[k] = r; await sb.from("pp_posts").update({ results, status: "scheduled", scheduled_at: new Date().toISOString(), error: null }).eq("id", id); toast("Retrying now…"); try { await fn("pp-publish", { post_id: id }); } catch (e) { toast(e.message, true); } await loadAll(); route(); }
async function deletePost(id) { if (!confirm("Delete this post?")) return; const { error } = await sb.from("pp_posts").delete().eq("id", id); if (error) return toast(error.message, true); S.posts = S.posts.filter((p) => p.id !== id); $("#composer").classList.add("hidden"); toast("Deleted"); route(); }

// ---------------------------------------------------------------- media
async function renderMedia() {
  $("#main").innerHTML = `<div class="page-head"><div><h1>Media library</h1><p class="muted">Images and videos you can use in posts. Stored in your Supabase bucket.</p></div><label class="btn primary file-btn">Upload files<input type="file" id="mediaUpload" multiple accept="image/*,video/*" hidden></label></div>
    <div class="drop" id="dropZone">Drop images or videos here<div class="progress hidden" id="upProg"><div></div></div></div>
    <div class="media-grid" style="margin-top:16px" id="mediaGrid"></div>`;
  drawMediaGrid();
  $("#mediaUpload").onchange = (e) => uploadFiles([...e.target.files]);
  const dz = $("#dropZone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); }); dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); uploadFiles([...e.dataTransfer.files]); });
}
function mediaTile(m, sel = false, onclick = "") {
  const inner = m.type === "video" ? `<video src="${esc(m.url)}#t=0.5" muted preload="metadata"></video>` : `<img src="${esc(m.url)}" loading="lazy" alt="">`;
  return `<div class="media-item ${sel ? "sel" : ""}" data-id="${m.id}" ${onclick}><span class="tag">${m.type}${m.size ? " · " + (m.size / 1048576).toFixed(1) + "MB" : ""}</span>${inner}<button class="del" onclick="event.stopPropagation();deleteMedia('${m.id}')">✕</button></div>`;
}
function drawMediaGrid() { $("#mediaGrid").innerHTML = S.media.length ? S.media.map((m) => mediaTile(m, false, `onclick="navigator.clipboard.writeText('${esc(m.url)}');toast('Link copied')"`)).join("") : `<div class="empty">No media yet — upload something.</div>`; }
async function uploadFiles(files, after) {
  const prog = $("#upProg"); if (prog) prog.classList.remove("hidden");
  let done = 0; const added = [];
  for (const f of files) {
    const type = f.type.startsWith("video") ? "video" : "image";
    const path = `${S.user.id}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await sb.storage.from("pp-media").upload(path, f, { contentType: f.type, upsert: false });
    if (error) { toast(`${f.name}: ${error.message}`, true); continue; }
    const url = sb.storage.from("pp-media").getPublicUrl(path).data.publicUrl;
    const { data } = await sb.from("pp_media").insert({ name: f.name, path, url, type, mime: f.type, size: f.size }).select().single();
    if (data) { S.media.unshift(data); added.push(data); }
    done++; if (prog) prog.firstElementChild.style.width = `${Math.round((done / files.length) * 100)}%`;
  }
  if (prog) setTimeout(() => prog.classList.add("hidden"), 600);
  if ($("#mediaGrid")) drawMediaGrid();
  toast(`${done} file${done === 1 ? "" : "s"} uploaded`); if (after) after(added);
}
async function deleteMedia(id) { const m = S.media.find((x) => x.id === id); if (!m || !confirm("Delete this file?")) return; await sb.storage.from("pp-media").remove([m.path]); await sb.from("pp_media").delete().eq("id", id); S.media = S.media.filter((x) => x.id !== id); if ($("#mediaGrid")) drawMediaGrid(); if (!$("#picker").classList.contains("hidden")) drawPicker(); }

// ---------------------------------------------------------------- analytics
let charts = [];
async function renderAnalytics() {
  charts.forEach((c) => c.destroy()); charts = [];
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [{ data: stats }, { data: ps }] = await Promise.all([
    sb.from("pp_account_stats").select("*").gte("day", since).order("day"),
    sb.from("pp_post_stats").select("*").order("fetched_at", { ascending: false }).limit(300),
  ]);
  const byAcc = {}; for (const s of stats || []) (byAcc[s.account_id] ||= []).push(s);
  const cards = S.accounts.map((a) => { const rows = byAcc[a.id] || []; const last = rows.at(-1); const first = rows[0]; const delta = last && first ? (last.followers || 0) - (first.followers || 0) : 0;
    return `<div class="card stat"><div class="row gap">${a.avatar_url ? `<img class="avatar-sm" src="${esc(a.avatar_url)}">` : netIcon(a.network)}<span class="small"><b>${esc(a.handle || a.name)}</b> · ${NET_NAME[a.network]}</span></div><span class="v">${num(last?.followers ?? a.meta?.followers ?? a.meta?.subscribers)}</span><span class="d ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : ""}${delta} followers · 30d</span><span class="small muted">Reach ${num(last?.reach)} · Views ${num(last?.views)} · Engagement ${num(last?.engagement)}</span></div>`; }).join("");
  const postsWithStats = (ps || []).map((s) => ({ s, p: S.posts.find((p) => p.id === s.post_id), a: accById(s.account_id) })).filter((x) => x.p && x.a).sort((x, y) => (y.s.views || 0) + (y.s.likes || 0) * 3 - ((x.s.views || 0) + (x.s.likes || 0) * 3));
  const bt = bestTimes(ps || []);
  $("#main").innerHTML = `<div class="page-head"><div><h1>Analytics</h1><p class="muted">Audience, reach and post performance across channels.</p></div><button class="btn" id="syncBtn">↻ Sync now</button></div>
    <div class="grid g4">${cards || `<div class="card empty">Connect a channel to see analytics.</div>`}</div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Followers · last 30 days</h3><canvas id="chFollowers"></canvas></div><div class="card"><h3>Best times to post</h3><p class="muted small">From engagement on your published posts${bt.fromData ? "" : " (defaults until you have data)"}.</p>${bt.list.map((b) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${b.label}</span><b>${b.score}</b></div>`).join("")}</div></div>
    <div class="card" style="margin-top:16px"><h3>Top posts</h3>${postsWithStats.length ? `<table><tr><th>Post</th><th>Channel</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Reach</th></tr>${postsWithStats.slice(0, 25).map(({ s, p, a }) => `<tr><td>${esc((p.text || p.title || "").slice(0, 60))}<br><span class="muted tiny">${fmtDT(p.published_at)}</span></td><td>${netIcon(a.network)} ${esc(a.handle)}</td><td>${num(s.views)}</td><td>${num(s.likes)}</td><td>${num(s.comments)}</td><td>${num(s.shares)}</td><td>${num(s.saves)}</td><td>${num(s.reach)}</td></tr>`).join("")}</table>` : `<div class="empty">No post metrics yet — they appear ~24h after publishing (or press Sync now).</div>`}</div>`;
  $("#syncBtn").onclick = async () => { $("#syncBtn").disabled = true; try { const r = await fn("pp-analytics"); toast(`Synced ${r.accounts.length} channels, ${r.posts_updated} posts`); await loadAll(); renderAnalytics(); } catch (e) { toast(e.message, true); } };
  const labels = [...new Set((stats || []).map((s) => s.day))].sort();
  const datasets = S.accounts.map((a, i) => ({ label: `${a.handle || a.name}`, data: labels.map((d) => (byAcc[a.id] || []).find((s) => s.day === d)?.followers ?? null), borderColor: ["#EC4096", "#2563eb", "#16a34a", "#d97706", "#7c3aed"][i % 5], tension: .3, spanGaps: true }));
  if (labels.length) charts.push(new Chart($("#chFollowers"), { type: "line", data: { labels, datasets }, options: { plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: false } } } }));
  else $("#chFollowers").replaceWith(Object.assign(document.createElement("div"), { className: "empty", textContent: "Follower history starts collecting from your first sync." }));
}
function bestTimes(ps) {
  const DEF = [["Tue", 9], ["Wed", 13], ["Thu", 18], ["Fri", 20], ["Sun", 19]];
  const scores = {};
  for (const s of ps) { const p = S.posts.find((x) => x.id === s.post_id); if (!p?.published_at) continue; const d = new Date(p.published_at); const pt = partsInTz(d); const dow = new Intl.DateTimeFormat("en-GB", { timeZone: S.tz, weekday: "short" }).format(d); const k = `${dow} ${pt.hour}:00`; const e = (s.likes || 0) * 3 + (s.comments || 0) * 5 + (s.shares || 0) * 4 + (s.saves || 0) * 4 + (s.views || 0) * 0.05; scores[k] = (scores[k] || 0) + e; }
  const list = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, v]) => ({ label, score: Math.round(v) }));
  if (list.length >= 3) return { fromData: true, list };
  return { fromData: false, list: DEF.map(([d, h]) => ({ label: `${d} ${String(h).padStart(2, "0")}:00`, score: "·" })) };
}

// ---------------------------------------------------------------- accounts
async function renderAccounts(q) {
  if (q.get("connected")) toast(`${NET_NAME[q.get("connected")] || q.get("connected")} connected 🎉`); if (q.get("error")) toast(decodeURIComponent(q.get("error")), true);
  if (q.get("connected") || q.get("error")) { history.replaceState(null, "", "#/accounts"); await loadAll(); }
  const creds = S.settings.credentials || {};
  const ready = { instagram: !!creds.meta_app_id, facebook: !!creds.meta_app_id, youtube: !!creds.google_client_id, tiktok: !!creds.tiktok_client_key, linkedin: !!creds.linkedin_client_id };
  $("#main").innerHTML = `<div class="page-head"><div><h1>Accounts</h1><p class="muted">Connect the channels you publish to. Tokens are stored encrypted in your own database.</p></div></div>
    <div class="card"><h3>Connected</h3>${S.accounts.length ? S.accounts.map((a) => `<div class="acct">${a.avatar_url ? `<img class="avatar" src="${esc(a.avatar_url)}">` : `<span class="avatar"></span>`}<div class="grow"><div class="row gap">${netIcon(a.network)}<b>${esc(a.name || a.handle)}</b><span class="muted small">@${esc(a.handle)}</span></div><div class="small muted">${NET_NAME[a.network]} · connected ${fmtDay(a.connected_at)}${a.token_expires_at ? ` · token until ${fmtDay(a.token_expires_at)}` : ""}${a.last_error ? `<br><span class="down">⚠ ${esc(a.last_error)}</span>` : ""}</div></div><button class="btn sm" onclick="connect('${a.network}')">Reconnect</button><button class="btn sm danger-text" onclick="disconnect('${a.id}')">Remove</button></div>`).join("") : `<div class="empty">No channels connected yet.</div>`}</div>
    <div class="card" style="margin-top:16px"><h3>Add a channel</h3><div class="connect-grid">${Object.keys(NET_NAME).map((n) => `<div class="connect" onclick="connect('${n}')">${netIcon(n)}<span>${NET_NAME[n]}</span>${ready[n] ? "" : `<span class="muted tiny" style="margin-left:auto">needs keys</span>`}</div>`).join("")}</div><p class="muted small" style="margin-top:12px">Each platform needs a one-time developer app so Lukz Post can post on your behalf — the step-by-step is in <a class="link" href="#/settings">Settings</a>.</p></div>`;
}
async function connect(network) {
  try { const r = await fn("pp-oauth", { network, redirect_to: location.origin + location.pathname }, "?action=start"); location.href = r.url; }
  catch (e) { toast(e.message, true); if (/Settings/.test(e.message)) setTimeout(() => nav("#/settings"), 1200); }
}
async function disconnect(id) { if (!confirm("Remove this channel? Scheduled posts to it will fail.")) return; await sb.from("pp_accounts").delete().eq("id", id); await loadAll(); renderAccounts(new URLSearchParams()); }

// ---------------------------------------------------------------- settings
async function renderSettings() {
  const c = S.settings.credentials || {}; const prefs = S.settings.prefs || {};
  const redirect = `${FN}/pp-oauth?action=callback`;
  const { data: logs } = await sb.from("pp_logs").select("*").order("created_at", { ascending: false }).limit(40);
  const field = (k, label, ph = "") => `<label>${label}<input id="c_${k}" type="${/secret/.test(k) ? "password" : "text"}" value="${esc(c[k] || "")}" placeholder="${ph}" autocomplete="off"></label>`;
  $("#main").innerHTML = `<div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="grid g2">
      <div class="card"><h3>Preferences</h3><label>Timezone<select id="p_tz">${["Asia/Dubai", "Asia/Kolkata", "Asia/Riyadh", "Europe/London", "Europe/Madrid", "America/New_York", "UTC"].map((z) => `<option ${(prefs.timezone || C.DEFAULT_TZ) === z ? "selected" : ""}>${z}</option>`).join("")}</select></label>
        <label>Default post time<input id="p_time" type="time" value="${esc(prefs.default_time || "18:00")}"></label><button class="btn primary" id="savePrefs" style="margin-top:12px">Save preferences</button>
        <h3 style="margin-top:22px">Change password</h3><label>New password<input id="pw1" type="password" autocomplete="new-password" minlength="8"></label><label>Repeat new password<input id="pw2" type="password" autocomplete="new-password"></label><button class="btn" id="savePw" style="margin-top:12px">Update password</button></div>
      <div class="card"><h3>OAuth redirect URL</h3><p class="muted small">Paste this as the redirect / callback URL in every developer app below.</p><div class="copy"><span>${redirect}</span><button class="btn sm" onclick="navigator.clipboard.writeText('${redirect}');toast('Copied')">Copy</button></div>
        <p class="muted small" style="margin-top:10px">Scheduler runs every minute · Analytics sync daily 06:15 ${esc(prefs.timezone || C.DEFAULT_TZ)}</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>API credentials</h3><p class="muted small">Saved to your private settings table (only your login can read them).</p>
      <div class="grid g2">
        <div><h4>Meta (Instagram + Facebook)</h4>${field("meta_app_id", "App ID", "1234567890")}${field("meta_app_secret", "App secret")}</div>
        <div><h4>Google (YouTube)</h4>${field("google_client_id", "OAuth client ID", "xxxx.apps.googleusercontent.com")}${field("google_client_secret", "Client secret")}</div>
        <div><h4>TikTok</h4>${field("tiktok_client_key", "Client key")}${field("tiktok_client_secret", "Client secret")}</div>
        <div><h4>LinkedIn</h4>${field("linkedin_client_id", "Client ID")}${field("linkedin_client_secret", "Client secret")}</div>
      </div><button class="btn primary" id="saveCreds" style="margin-top:12px">Save credentials</button></div>
    <div class="card" style="margin-top:16px"><h3>Setup guides</h3>
      <details><summary>Instagram &amp; Facebook (Meta app) — about 15 minutes</summary><ol>
        <li>Your Instagram must be a <b>Professional</b> account (Business or Creator) linked to a <b>Facebook Page</b> (Instagram app → Settings → Business tools → Connect a Facebook Page).</li>
        <li>Go to <a class="link" href="https://developers.facebook.com/apps" target="_blank">developers.facebook.com/apps</a> → <b>Create App</b> → use case <i>Other</i> → type <b>Business</b> → name it "Lukz Post".</li>
        <li>In the app dashboard add the products <b>Facebook Login for Business</b> and <b>Instagram Graph API</b>.</li>
        <li>Facebook Login → Settings → <b>Valid OAuth Redirect URIs</b>: paste the redirect URL above. Save.</li>
        <li>App settings → Basic: copy <b>App ID</b> and <b>App Secret</b> into the fields here and save.</li>
        <li>While the app is in <b>Development</b> mode only you (the app admin) can connect — which is all you need. Add your personal Facebook account under App roles → Administrators if it isn't already.</li>
        <li>Back in Lukz Post → Accounts → <b>Instagram</b>. Approve all permissions, select your Page(s). Done.</li></ol></details>
      <details><summary>YouTube (Google Cloud OAuth) — about 10 minutes</summary><ol>
        <li>Open <a class="link" href="https://console.cloud.google.com/" target="_blank">console.cloud.google.com</a> → New project "Lukz Post".</li>
        <li>APIs &amp; Services → Library → enable <b>YouTube Data API v3</b> and <b>YouTube Analytics API</b>.</li>
        <li>APIs &amp; Services → OAuth consent screen → External → fill name/email → add scopes <code>youtube.upload</code>, <code>youtube.readonly</code>, <code>yt-analytics.readonly</code> → add your Google account as a <b>Test user</b>.</li>
        <li>Credentials → Create credentials → <b>OAuth client ID</b> → Web application → Authorized redirect URI: paste the redirect URL above.</li>
        <li>Copy Client ID + Client secret here, save, then Accounts → <b>YouTube</b>.</li>
        <li>Note: until Google verifies the app, uploads from "testing" apps are set to <b>private</b> by YouTube. You can make the video public in YouTube Studio, or request verification (free, a few days).</li></ol></details>
      <details><summary>TikTok — needs app review</summary><ol>
        <li><a class="link" href="https://developers.tiktok.com/" target="_blank">developers.tiktok.com</a> → Manage apps → Connect an app → add <b>Login Kit</b> and <b>Content Posting API</b>.</li>
        <li>Redirect URI: paste the redirect URL above. Scopes: user.info.basic, video.publish, video.upload.</li>
        <li>Submit for review (TikTok requires it before posting works). Until approved, posts go to your <i>private</i> drafts.</li>
        <li>Copy Client key + secret here, then Accounts → <b>TikTok</b>.</li></ol></details>
      <details><summary>LinkedIn — about 10 minutes</summary><ol>
        <li><a class="link" href="https://www.linkedin.com/developers/apps" target="_blank">linkedin.com/developers/apps</a> → Create app (needs a LinkedIn Page to associate).</li>
        <li>Products → add <b>Share on LinkedIn</b> and <b>Sign In with LinkedIn using OpenID Connect</b>.</li>
        <li>Auth → Authorized redirect URLs: paste the redirect URL above. Copy Client ID + secret here.</li>
        <li>Accounts → <b>LinkedIn</b>. Tokens last 60 days; reconnect when prompted.</li></ol></details>
    </div>
    <div class="card" style="margin-top:16px"><h3>Activity log</h3>${(logs || []).length ? logs.map((l) => `<div class="log ${l.level}">${fmtDT(l.created_at)} · ${esc(l.message)}${l.detail?.error ? ` — ${esc(l.detail.error)}` : ""}</div>`).join("") : `<div class="empty">Nothing yet.</div>`}</div>`;
  $("#savePrefs").onclick = async () => { const value = { timezone: $("#p_tz").value, default_time: $("#p_time").value }; const { error } = await sb.from("pp_settings").upsert({ key: "prefs", value, owner: S.user.id }); if (error) return toast(error.message, true); S.settings.prefs = value; S.tz = value.timezone; toast("Preferences saved"); };
  $("#savePw").onclick = async () => { const a = $("#pw1").value, b = $("#pw2").value; if (a.length < 8) return toast("Use at least 8 characters", true); if (a !== b) return toast("Passwords don't match", true); const { error } = await sb.auth.updateUser({ password: a }); if (error) return toast(error.message, true); $("#pw1").value = $("#pw2").value = ""; toast("Password updated"); };
  $("#saveCreds").onclick = async () => { const value = {}; ["meta_app_id", "meta_app_secret", "google_client_id", "google_client_secret", "tiktok_client_key", "tiktok_client_secret", "linkedin_client_id", "linkedin_client_secret"].forEach((k) => (value[k] = $(`#c_${k}`).value.trim())); const { error } = await sb.from("pp_settings").upsert({ key: "credentials", value, owner: S.user.id }); if (error) return toast(error.message, true); S.settings.credentials = value; toast("Credentials saved"); };
}

// ---------------------------------------------------------------- composer
let draft = null;
function openComposer(id = null, dayKeyStr = null) {
  const p = id ? S.posts.find((x) => x.id === id) : null; S.editing = p || null;
  draft = p ? JSON.parse(JSON.stringify(p)) : { text: "", title: "", first_comment: "", media: [], targets: S.accounts.map((a) => ({ account_id: a.id, type: DEFAULT_TYPE[a.network] })), scheduled_at: null };
  if (!p && dayKeyStr) draft.scheduled_at = fromLocalInput(`${dayKeyStr}T${S.settings.prefs?.default_time || "18:00"}`);
  $("#composerTitle").textContent = p ? "Edit post" : "New post";
  $("#postText").value = draft.text || ""; $("#postTitle").value = draft.title || ""; $("#firstComment").value = draft.first_comment || "";
  $("#postWhen").value = draft.scheduled_at ? localInputValue(draft.scheduled_at) : "";
  $("#tzLabel").textContent = S.tz; $("#deletePostBtn").classList.toggle("hidden", !p);
  const locked = p && ["published", "partial", "publishing"].includes(p.status);
  $("#scheduleBtn").disabled = locked; $("#publishNowBtn").disabled = locked; $("#saveDraftBtn").disabled = locked;
  $("#composerStatus").innerHTML = p ? `<span class="pill ${p.status}">${p.status}</span> ${locked ? "Published posts can't be edited." : ""}` : "";
  drawTargets(); drawPostMedia(); drawBestTimes(); preview();
  $("#composer").classList.remove("hidden");
}
function drawTargets() {
  $("#targetList").innerHTML = S.accounts.length ? S.accounts.map((a) => { const t = draft.targets.find((x) => x.account_id === a.id);
    return `<div class="target ${t ? "on" : ""}" data-id="${a.id}">${a.avatar_url ? `<img class="avatar-sm" src="${esc(a.avatar_url)}">` : netIcon(a.network)}<span class="small"><b>${esc(a.handle || a.name)}</b></span>${t ? `<select data-type="${a.id}">${TYPES[a.network].map((x) => `<option ${t.type === x ? "selected" : ""}>${x}</option>`).join("")}</select>` : ""}</div>`; }).join("") : `<span class="muted small">No channels yet — <a class="link" href="#/accounts" onclick="document.getElementById('composer').classList.add('hidden')">connect one</a>.</span>`;
  $$(".target").forEach((el) => el.addEventListener("click", (e) => { if (e.target.tagName === "SELECT" || e.target.tagName === "OPTION") return; const id = el.dataset.id; const i = draft.targets.findIndex((x) => x.account_id === id); if (i >= 0) draft.targets.splice(i, 1); else draft.targets.push({ account_id: id, type: DEFAULT_TYPE[accById(id).network] }); drawTargets(); preview(); }));
  $$("[data-type]").forEach((s) => s.addEventListener("change", () => { draft.targets.find((x) => x.account_id === s.dataset.type).type = s.value; preview(); }));
}
function drawPostMedia() {
  $("#postMedia").innerHTML = draft.media.map((m, i) => `<div class="mi">${m.type === "video" ? `<video src="${esc(m.url)}#t=0.5" muted preload="metadata"></video>` : `<img src="${esc(m.url)}">`}<button class="rm" data-i="${i}">✕</button></div>`).join("");
  $$("#postMedia .rm").forEach((b) => (b.onclick = () => { draft.media.splice(+b.dataset.i, 1); drawPostMedia(); preview(); }));
}
function drawBestTimes() {
  const bt = bestTimes([]); const base = $("#postWhen").value ? $("#postWhen").value.slice(0, 10) : (() => { const p = partsInTz(new Date()); return `${p.year}-${p.month}-${p.day}`; })();
  const slots = ["09:00", "13:00", "18:00", "20:30"].map((t) => `<button class="chip-t" data-t="${t}">${t}</button>`).join("");
  $("#bestTimes").innerHTML = `<span class="muted small" style="align-self:center">Suggested:</span>${slots}<button class="chip-t" data-t="tomorrow">Tomorrow 18:00</button>`;
  $$("#bestTimes .chip-t").forEach((b) => (b.onclick = () => { if (b.dataset.t === "tomorrow") { const d = new Date(Date.now() + 864e5); const p = partsInTz(d); $("#postWhen").value = `${p.year}-${p.month}-${p.day}T18:00`; } else $("#postWhen").value = `${base}T${b.dataset.t}`; }));
}
function preview() {
  const first = draft.targets[0] && accById(draft.targets[0].account_id);
  $("#pvHandle").textContent = first ? first.handle || first.name : "your_handle";
  $("#pvAvatar").outerHTML = first?.avatar_url ? `<img class="avatar-sm" id="pvAvatar" src="${esc(first.avatar_url)}">` : `<span class="avatar-sm" id="pvAvatar"></span>`;
  const m = draft.media[0]; $("#pvMedia").innerHTML = m ? (m.type === "video" ? `<video src="${esc(m.url)}" muted autoplay loop playsinline></video>` : `<img src="${esc(m.url)}">`) : `<span class="muted">Media preview</span>`;
  $("#pvCaption").textContent = $("#postText").value; $("#charCount").textContent = `${$("#postText").value.length} / 2200`;
}
$("#postText").addEventListener("input", preview);
$("#composerUpload").addEventListener("change", (e) => uploadFiles([...e.target.files], (added) => { draft.media.push(...added.map(({ url, type, path, name }) => ({ url, type, path, name }))); drawPostMedia(); preview(); }));
$("#pickMediaBtn").onclick = () => { S.pick = new Set(); drawPicker(); $("#picker").classList.remove("hidden"); };
function drawPicker() { $("#pickerGrid").innerHTML = S.media.length ? S.media.map((m) => mediaTile(m, S.pick.has(m.id), `onclick="togglePick('${m.id}')"`)).join("") : `<div class="empty">Library is empty — upload from the composer.</div>`; }
function togglePick(id) { S.pick.has(id) ? S.pick.delete(id) : S.pick.add(id); drawPicker(); }
$("#pickerDone").onclick = () => { for (const id of S.pick) { const m = S.media.find((x) => x.id === id); if (m && !draft.media.some((x) => x.url === m.url)) draft.media.push({ url: m.url, type: m.type, path: m.path, name: m.name }); } $("#picker").classList.add("hidden"); drawPostMedia(); preview(); };
$("#deletePostBtn").onclick = () => S.editing && deletePost(S.editing.id);

function collect() {
  draft.text = $("#postText").value; draft.title = $("#postTitle").value.trim(); draft.first_comment = $("#firstComment").value.trim();
  draft.scheduled_at = $("#postWhen").value ? fromLocalInput($("#postWhen").value) : null;
}
function validate(forPublish) {
  if (forPublish && !draft.targets.length) return "Pick at least one channel";
  for (const t of draft.targets) { const a = accById(t.account_id); if (!a) continue;
    const hasVideo = draft.media.some((m) => m.type === "video"); const hasMedia = draft.media.length > 0;
    if (["instagram", "tiktok", "youtube"].includes(a.network) && !hasMedia) return `${NET_NAME[a.network]} needs media`;
    if (["youtube", "tiktok"].includes(a.network) && !hasVideo) return `${NET_NAME[a.network]} needs a video`;
    if (a.network === "instagram" && t.type === "reel" && !hasVideo) return "An Instagram Reel needs a video";
  }
  return null;
}
async function savePost(status) {
  collect(); const v = validate(status !== "draft"); if (v) return toast(v, true);
  if (status === "scheduled" && !draft.scheduled_at) return toast("Pick a date and time", true);
  if (status === "scheduled" && new Date(draft.scheduled_at) < Date.now() - 60000) return toast("That time is in the past", true);
  const row = { text: draft.text, title: draft.title, first_comment: draft.first_comment, media: draft.media, targets: draft.targets, scheduled_at: draft.scheduled_at, timezone: S.tz, status: status === "now" ? "scheduled" : status, results: {}, error: null };
  let data, error;
  if (S.editing) ({ data, error } = await sb.from("pp_posts").update(row).eq("id", S.editing.id).select().single());
  else ({ data, error } = await sb.from("pp_posts").insert(row).select().single());
  if (error) return toast(error.message, true);
  if (status === "now") {
    $("#composerStatus").textContent = "Publishing…"; $("#publishNowBtn").disabled = true;
    try { const r = await fn("pp-publish", { post_id: data.id }); toast(r.status === "published" ? "Published 🎉" : r.status === "publishing" ? "Publishing — video is processing, check back in a minute" : `Finished with status: ${r.status}`); }
    catch (e) { toast(e.message, true); } finally { $("#publishNowBtn").disabled = false; }
  } else toast(status === "draft" ? "Draft saved" : `Scheduled for ${fmtDT(draft.scheduled_at)}`);
  $("#composer").classList.add("hidden"); await loadAll(); route();
}
$("#saveDraftBtn").onclick = () => savePost("draft"); $("#scheduleBtn").onclick = () => savePost("scheduled"); $("#publishNowBtn").onclick = () => savePost("now");
