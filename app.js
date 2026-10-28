"use strict";
/* Local SEO Toolkit — frontend. All DataForSEO calls go through this
   app's own server (/api/*), credentials per-request, never stored
   server-side. Profile + (opt-in) key live only in this browser. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : esc(n));

const COUNTRIES = [
  ["United States", 2840], ["United Kingdom", 2826], ["Canada", 2124], ["Australia", 2036],
  ["Ireland", 2372], ["New Zealand", 2554], ["Germany", 2276], ["France", 2250], ["Spain", 2724],
  ["Italy", 2380], ["Netherlands", 2528], ["Belgium", 2056], ["Switzerland", 2756], ["Austria", 2040],
  ["Portugal", 2620], ["Poland", 2616], ["Sweden", 2752], ["Norway", 2578], ["Denmark", 2208],
  ["Finland", 2246], ["Mexico", 2484], ["Brazil", 2076], ["Argentina", 2032], ["Chile", 2152],
  ["Colombia", 2170], ["India", 2356], ["Pakistan", 2586], ["Bangladesh", 2050], ["Philippines", 2608],
  ["Indonesia", 2360], ["Malaysia", 2458], ["Singapore", 2702], ["Thailand", 2764], ["Vietnam", 2704],
  ["Japan", 2392], ["South Korea", 2410], ["United Arab Emirates", 2784], ["Saudi Arabia", 2682],
  ["South Africa", 2710], ["Nigeria", 2566], ["Egypt", 2818], ["Turkey", 2792], ["Israel", 2376],
];

function creds() { return { login: $("dfsLogin").value.trim(), password: $("dfsPassword").value }; }
function locCode() { const c = parseInt($("bizLocCode").value, 10); if (isFinite(c) && c > 0) return c; return parseInt($("bizCountry").value, 10) || 2840; }
function lang() { return ($("bizLang").value || "en").trim() || "en"; }
function domainOf(v) { try { return new URL(v.startsWith("http") ? v : "https://" + v).hostname.replace(/^www\./, ""); } catch { return String(v || "").replace(/^www\./, "").split("/")[0]; } }
function profileDomain() { return domainOf($("bizWebsite").value || ""); }

function progress(id, on) { $(id).classList.toggle("hidden", !on); }
function setStatus(id, msg, cls) { const el = $(id); el.textContent = msg; el.className = "status" + (cls ? " " + cls : ""); }

async function postJson(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
/* One DataForSEO call via the server proxy. payload = ONE task object
   (Live endpoints accept exactly one task per POST). */
async function dfs(apiPath, task, method) {
  const body = { ...creds(), path: apiPath, method: method || "POST", payload: task ? [task] : [] };
  const out = await postJson("/api/dfs", body);
  if (!out.ok) throw new Error(out.error || "DataForSEO request failed.");
  return out.data;
}
function firstTask(data) { return data && Array.isArray(data.tasks) ? data.tasks[0] : null; }
function firstResult(data) { const t = firstTask(data); return t && Array.isArray(t.result) ? t.result[0] : null; }
function itemsOf(data) { const r = firstResult(data); return r && Array.isArray(r.items) ? r.items : []; }
function rawDetails(data) { return `<details><summary>Raw DataForSEO response</summary><pre class="raw">${esc(JSON.stringify(data, null, 2).slice(0, 20000))}</pre></details>`; }
function table(cols, rows) {
  if (!rows.length) return "<p class='hint'>No rows returned.</p>";
  return "<table><thead><tr>" + cols.map((c) => `<th>${esc(c.label)}</th>`).join("") + "</tr></thead><tbody>" +
    rows.map((r) => "<tr>" + cols.map((c) => `<td>${c.html ? c.html(r) : esc(r[c.key])}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
}
function cards(list) { return "<div class='cards'>" + list.map((c) => `<div class="card"><h4>${esc(c.t)}</h4>${c.big != null ? `<div class="big">${esc(c.big)}</div>` : ""}<p>${esc(c.d || "")}</p></div>`).join("") + "</div>"; }
async function run(boxId, progId, fn) {
  progress(progId, true); $(boxId).innerHTML = "";
  try { await fn(); } catch (e) { $(boxId).innerHTML = `<p class="status err">⚠️ ${esc(e.message)}</p>`; }
  finally { progress(progId, false); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Poll a task_get-style GET endpoint until the task is ready or we give up. */
async function pollTask(apiPath, tries, delayMs, boxId) {
  for (let i = 0; i < tries; i++) {
    const data = await dfs(apiPath, null, "GET");
    const t = firstTask(data);
    if (t && t.status_code === 20000 && Array.isArray(t.result) && t.result.length) return data;
    if (t && typeof t.status_code === "number" && t.status_code >= 40000) throw new Error(t.status_code + ": " + (t.status_message || "task failed"));
    if (boxId) $(boxId).innerHTML = `<p class="hint">Task is still running on DataForSEO… check ${i + 1}/${tries}. You can leave this tab open.</p>`;
    await sleep(delayMs);
  }
  throw new Error("The task is taking longer than this panel waits. DataForSEO keeps it — re-run the same request shortly and it usually returns from their cache.");
}

/* ---------------- Tabs ---------------- */
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + b.dataset.tab));
  if (b.dataset.tab === "maps") setTimeout(() => { if (map) map.invalidateSize(); }, 60);
});

/* ---------------- Setup ---------------- */
function fillCountries() { $("bizCountry").innerHTML = COUNTRIES.map(([n, c]) => `<option value="${c}">${esc(n)} (${c})</option>`).join(""); }
fillCountries();
function saveProfile() {
  const p = { website: $("bizWebsite").value, name: $("bizName").value, city: $("bizCity").value, area: $("bizArea").value, country: $("bizCountry").value, loc: $("bizLocCode").value, lang: $("bizLang").value, keyword: $("bizKeyword").value };
  localStorage.setItem("lst_profile", JSON.stringify(p));
  if ($("rememberKey").checked) localStorage.setItem("lst_key", JSON.stringify(creds())); else localStorage.removeItem("lst_key");
  syncFromProfile(); setStatus("profileSaved", "Saved in this browser ✓", "ok");
}
function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem("lst_profile") || "null");
    if (p) { $("bizWebsite").value = p.website || ""; $("bizName").value = p.name || ""; $("bizCity").value = p.city || ""; $("bizArea").value = p.area || ""; if (p.country) $("bizCountry").value = p.country; $("bizLocCode").value = p.loc || ""; $("bizLang").value = p.lang || "en"; $("bizKeyword").value = p.keyword || ""; }
    const k = JSON.parse(localStorage.getItem("lst_key") || "null");
    if (k) { $("dfsLogin").value = k.login || ""; $("dfsPassword").value = k.password || ""; $("rememberKey").checked = true; }
  } catch {}
  syncFromProfile();
}
function syncFromProfile() {
  $("mapBiz").value = $("bizName").value; $("mapCity").value = $("bizCity").value; $("mapArea").value = $("bizArea").value; $("mapKeyword").value = $("bizKeyword").value;
  $("rankDomain").value = profileDomain(); $("blDomain").value = profileDomain(); $("domDomain").value = profileDomain();
  $("auditUrl").value = $("bizWebsite").value; $("aiKeyword").value = $("bizName").value;
  const kw = $("bizKeyword").value; if (kw && !$("rankKeywords").value) $("rankKeywords").value = kw;
  if ($("bizName").value && !$("kwSeeds").value) $("kwSeeds").value = $("bizName").value;
}
$("btnSaveProfile").addEventListener("click", saveProfile);
$("btnTest").addEventListener("click", async () => {
  setStatus("testResult", "Testing…");
  const out = await postJson("/api/test", creds());
  if (out.ok) {
    setStatus("testResult", "Connected ✓", "ok");
    $("connBadge").textContent = "Connected to DataForSEO"; $("connBadge").className = "badge badge-on";
    try {
      const data = await dfs("/v3/appendix/user_data", null, "GET");
      const r = firstResult(data) || {}; const money = (r.money && r.money.balance) != null ? r.money.balance : (r.balance != null ? r.balance : null);
      $("accountInfo").innerHTML = cards([
        { t: "Account balance", big: money != null ? "$" + money : "—", d: "Your DataForSEO balance. Each tool run spends from this." },
        { t: "API login", d: creds().login },
        { t: "Pricing", d: "Pay-as-you-go per request on your own DataForSEO account. This toolkit charges nothing." },
      ]);
    } catch {}
  } else { setStatus("testResult", out.error || "Connection failed.", "err"); $("connBadge").textContent = "Not connected"; $("connBadge").className = "badge badge-off"; }
});
loadProfile();

/* ---------------- Maps Rank Tracker ---------------- */
let map = null, gridLayer = null, selectedBiz = null;
function initMap() {
  if (map || typeof L === "undefined") return;
  map = L.map("map").setView([20, 0], 2);
  const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 });
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Imagery © Esri", maxZoom: 19 });
  carto.addTo(map); L.control.layers({ "Street (CARTO)": carto, "Satellite (Esri)": sat }).addTo(map);
  gridLayer = L.layerGroup().addTo(map);
}
initMap();
function gridPoints(center, size, spacingMi) {
  const half = (size - 1) / 2, pts = [];
  const latStep = spacingMi / 69.0, lngStep = spacingMi / (69.0 * Math.cos(center.lat * Math.PI / 180));
  for (let r = half; r >= -half; r--) for (let c = -half; c <= half; c++) pts.push({ lat: center.lat + r * latStep, lng: center.lng + c * lngStep });
  return pts;
}
function drawGridPreview() {
  if (!map || !selectedBiz || selectedBiz.lat == null) return;
  gridLayer.clearLayers();
  const size = parseInt($("mapGrid").value, 10), spacing = parseFloat($("mapSpacing").value);
  L.marker([selectedBiz.lat, selectedBiz.lng]).addTo(gridLayer).bindPopup("★ " + esc(selectedBiz.title));
  gridPoints(selectedBiz, size, spacing).forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 4, color: "#2ea6ff" }).addTo(gridLayer));
  map.setView([selectedBiz.lat, selectedBiz.lng], size >= 9 || spacing >= 3 ? 10 : 12);
  $("mapScanInfo").textContent = `${size}×${size} = ${size * size} points × 1 Live request each`;
}
["mapGrid", "mapSpacing"].forEach((id) => $(id).addEventListener("change", drawGridPreview));

$("btnMapSearch").addEventListener("click", () => run("mapResults", "mapSearchProgress", async () => {
  const out = await postJson("/api/business/search", { ...creds(), business: $("mapBiz").value, city: $("mapCity").value, state: $("mapArea").value, language_code: lang() });
  if (!out.ok) throw new Error(out.error || "Search failed.");
  initMap();
  $("mapResults").innerHTML = "<div class='cards'>" + out.results.map((r, i) =>
    `<div class="card"><h4>${esc(r.title)}</h4><p>${esc(r.category || "")}${r.address ? "<br>" + esc(r.address) : ""}</p><p>${r.rating != null ? "⭐ " + r.rating + " (" + fmt(r.ratingCount) + " reviews)" : "No rating shown"}</p><button data-pick="${i}">Use this business</button></div>`).join("") + "</div>";
  window._mapResults = out.results;
  $("mapResults").querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    selectedBiz = window._mapResults[parseInt(b.dataset.pick, 10)];
    if (selectedBiz.lat == null) { $("mapScanInfo").textContent = "That listing came back without coordinates — pick a listing with a street address, or search again."; return; }
    $("btnMapScan").disabled = false; drawGridPreview();
    $("mapScanInfo").textContent = `Selected: ${selectedBiz.title} — grid preview loaded.`;
  }));
}));

function rankClass(r) { if (r == null) return "rnf"; if (r === 1) return "r1"; if (r <= 3) return "r3"; if (r <= 10) return "r10"; return "r20"; }
$("btnMapScan").addEventListener("click", () => run("mapTable", "mapScanProgress", async () => {
  if (!selectedBiz) throw new Error("Pick your business first.");
  const out = await postJson("/api/maps/scan", { ...creds(), business: selectedBiz, keyword: $("mapKeyword").value, gridSize: parseInt($("mapGrid").value, 10), spacingMiles: parseFloat($("mapSpacing").value), language_code: lang() });
  if (!out.ok) throw new Error(out.error || "Scan failed.");
  const s = out.summary;
  $("mapSummary").innerHTML = cards([
    { t: "Found in grid", big: `${s.found} / ${s.total}`, d: "Points where your business appears" },
    { t: "Average rank", big: s.avgRank != null ? s.avgRank : "—", d: "Across points where found" },
    { t: "Best / worst", big: s.best != null ? `${s.best} / ${s.worst}` : "—", d: "" },
    { t: "In top 3", big: s.top3Pct + "%", d: "Share of grid points" },
    { t: "In top 10", big: s.top10Pct + "%", d: "Share of grid points" },
  ]);
  if (map) {
    gridLayer.clearLayers();
    L.marker([selectedBiz.lat, selectedBiz.lng]).addTo(gridLayer).bindPopup("★ " + esc(selectedBiz.title));
    out.points.forEach((p) => {
      const label = p.error ? "!" : (p.found ? String(p.rank) : "—");
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: `<span class="rankpin ${rankClass(p.found ? p.rank : null)}">${label}</span>`, iconSize: [30, 24] }) }).addTo(gridLayer)
        .bindPopup(p.error ? esc(p.error) : (p.found ? `Rank #${p.rank} · matched by ${esc(p.matchedBy)} · ${p.itemsCount} listings checked` : `Not in top results · ${p.itemsCount != null ? p.itemsCount + " listings checked" : ""}<br>Top: ${esc((p.topTitles || []).join(" · "))}`));
    });
  }
  $("mapTable").innerHTML = table(
    [{ label: "Point", key: "i" }, { label: "Rank", key: "r" }, { label: "Listings checked", key: "n" }, { label: "Matched by", key: "m" }, { label: "Top result there", key: "top" }],
    out.points.map((p, i) => ({ i: i + 1, r: p.error ? "Error" : (p.found ? "#" + p.rank : "Not found"), n: p.itemsCount != null ? p.itemsCount : "—", m: p.matchedBy || "—", top: (p.topTitles || [])[0] || "—" }))
  );
}));

/* ---------------- Rank Tracker (organic + Labs) ---------------- */
$("btnRankCheck").addEventListener("click", () => run("rankResults", "rankProgress", async () => {
  const kws = $("rankKeywords").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const dom = domainOf($("rankDomain").value);
  if (!kws.length) throw new Error("Enter at least one keyword.");
  const rows = [];
  for (const kw of kws) {
    const data = await dfs("/v3/serp/google/organic/live/advanced", { keyword: kw, location_code: locCode(), language_code: lang(), depth: 100 });
    const items = itemsOf(data).filter((i) => i.type === "organic" || i.domain);
    const mine = items.find((i) => domainOf(i.domain || i.url || "") === dom);
    rows.push({ keyword: kw, position: mine ? (mine.rank_group || mine.rank_absolute) : "Not in top 100", url: mine ? (mine.url || "") : "—", top: items[0] ? domainOf(items[0].domain || items[0].url || "") : "—" });
    $("rankResults").innerHTML = table([{ label: "Keyword", key: "keyword" }, { label: "Your position", key: "position" }, { label: "Your ranking page", key: "url" }, { label: "#1 domain", key: "top" }], rows);
  }
}));
document.querySelectorAll(".labsBtn").forEach((b) => b.addEventListener("click", () => run("labsResults", "labsProgress", async () => {
  const dom = domainOf($("rankDomain").value); if (!dom) throw new Error("Enter your domain first.");
  const base = { target: dom, location_code: locCode(), language_code: lang() };
  if (b.dataset.labs === "overview") {
    const data = await dfs("/v3/dataforseo_labs/google/domain_rank_overview/live", { ...base, limit: 1 });
    const r = firstResult(data) || {}; const m = (r.metrics && r.metrics.organic) || {};
    $("labsResults").innerHTML = cards([
      { t: "Estimated traffic (organic)", big: fmt(Math.round(m.etv || 0)), d: "Monthly visits estimated by Labs" },
      { t: "Ranked keywords", big: fmt(m.count || 0), d: "Keywords with a page in Google results" },
      { t: "Top 3 keywords", big: fmt((m.pos_1_3 || 0)), d: "" }, { t: "Top 10 keywords", big: fmt((m.pos_1_10 || 0)), d: "" },
      { t: "Top 100 keywords", big: fmt((m.pos_1_100 || 0)), d: "" },
    ]) + rawDetails(data);
  } else if (b.dataset.labs === "ranked") {
    const data = await dfs("/v3/dataforseo_labs/google/ranked_keywords/live", { ...base, limit: 100, order_by: ["ranked_serp_element.serp_item.rank_group,asc"] });
    const rows = itemsOf(data).map((i) => { const se = i.ranked_serp_element && i.ranked_serp_element.serp_item || {}; return { kw: i.keyword_data && i.keyword_data.keyword, pos: se.rank_group, vol: i.keyword_data && i.keyword_data.keyword_info && i.keyword_data.keyword_info.search_volume, page: se.relative_url || se.url || "" }; });
    $("labsResults").innerHTML = "<h3>Ranked keywords</h3>" + table([{ label: "Keyword", key: "kw" }, { label: "Position", key: "pos" }, { label: "Search volume", key: "vol" }, { label: "Ranking page", key: "page" }], rows) + rawDetails(data);
  } else if (b.dataset.labs === "toppages") {
    const data = await dfs("/v3/dataforseo_labs/google/ranked_keywords/live", { ...base, limit: 1000, order_by: ["ranked_serp_element.serp_item.rank_group,asc"] });
    const byPage = {};
    itemsOf(data).forEach((i) => { const se = i.ranked_serp_element && i.ranked_serp_element.serp_item || {}; const pg = se.relative_url || se.url || "?"; byPage[pg] = byPage[pg] || { page: pg, kws: 0, best: 999, etv: 0 }; byPage[pg].kws++; byPage[pg].best = Math.min(byPage[pg].best, se.rank_group || 999); });
    const rows = Object.values(byPage).sort((a, b2) => b2.kws - a.kws).slice(0, 50);
    $("labsResults").innerHTML = "<h3>Top ranking pages (grouped from ranked keywords)</h3>" + table([{ label: "Page", key: "page" }, { label: "Keywords ranking", key: "kws" }, { label: "Best position", key: "best" }], rows) + rawDetails(data);
  } else {
    const data = await dfs("/v3/dataforseo_labs/google/keywords_for_site/live", { ...base, limit: 100 });
    const rows = itemsOf(data).map((i) => ({ kw: i.keyword, vol: i.keyword_info && i.keyword_info.search_volume, comp: i.keyword_info && i.keyword_info.competition_level, cpc: i.keyword_info && i.keyword_info.cpc }));
    $("labsResults").innerHTML = "<h3>Keyword opportunities for this site (new-keyword ideas)</h3>" + table([{ label: "Keyword", key: "kw" }, { label: "Volume", key: "vol" }, { label: "Competition", key: "comp" }, { label: "CPC $", key: "cpc" }], rows) + rawDetails(data);
  }
})));

/* ---------------- Keywords ---------------- */
function kwSeeds() { return $("kwSeeds").value.split("\n").map((s) => s.trim()).filter(Boolean); }
$("btnKwVolume").addEventListener("click", () => run("kwResults", "kwProgress", async () => {
  const data = await dfs("/v3/keywords_data/google_ads/search_volume/live", { keywords: kwSeeds(), location_code: locCode(), language_code: lang() });
  const rows = itemsOf(data).map((i) => ({ kw: i.keyword, vol: i.search_volume, cpc: i.cpc, comp: i.competition_level || i.competition, trend: Array.isArray(i.monthly_searches) ? i.monthly_searches.slice(-3).map((m) => m.search_volume).join(" → ") : "" }));
  $("kwResults").innerHTML = table([{ label: "Keyword", key: "kw" }, { label: "Search volume", key: "vol" }, { label: "CPC $", key: "cpc" }, { label: "Competition", key: "comp" }, { label: "Recent months", key: "trend" }], rows) + rawDetails(data);
}));
$("btnKwIdeas").addEventListener("click", () => run("kwResults", "kwProgress", async () => {
  const data = await dfs("/v3/dataforseo_labs/google/keyword_suggestions/live", { keyword: kwSeeds()[0] || "", location_code: locCode(), language_code: lang(), limit: 100 });
  const rows = itemsOf(data).map((i) => ({ kw: i.keyword, vol: i.keyword_info && i.keyword_info.search_volume, cpc: i.keyword_info && i.keyword_info.cpc, comp: i.keyword_info && i.keyword_info.competition_level }));
  $("kwResults").innerHTML = table([{ label: "Suggestion", key: "kw" }, { label: "Volume", key: "vol" }, { label: "CPC $", key: "cpc" }, { label: "Competition", key: "comp" }], rows) + rawDetails(data);
}));
$("btnKwIntent").addEventListener("click", () => run("kwResults", "kwProgress", async () => {
  const data = await dfs("/v3/dataforseo_labs/google/search_intent/live", { keywords: kwSeeds(), location_code: locCode(), language_code: lang() });
  const rows = itemsOf(data).map((i) => ({ kw: i.keyword, intent: i.search_intent_info && i.search_intent_info.main_intent, label: i.search_intent_info && (i.search_intent_info.foreign_intent || []).join(", ") }));
  $("kwResults").innerHTML = table([{ label: "Keyword", key: "kw" }, { label: "Main intent", key: "intent" }, { label: "Also", key: "label" }], rows) + rawDetails(data);
}));

/* ---------------- Site & Content Audit ---------------- */
$("btnInstantPage").addEventListener("click", () => run("auditResults", "auditProgress", async () => {
  const url = $("auditUrl").value.trim(); if (!url) throw new Error("Enter a URL first.");
  const data = await dfs("/v3/on_page/instant_pages", { url, enable_javascript: true, load_resources: true, enable_browser_rendering: false });
  const r = firstResult(data) || {}; const item = (r.items || [])[0] || {};
  const meta = item.meta || {}; const pm = item.page_metrics || {};
  const checks = pm.checks || {};
  $("auditResults").innerHTML = cards([
    { t: "On-page score", big: item.onpage_score != null ? Math.round(item.onpage_score) : "—", d: url },
    { t: "Title", d: meta.title || "—" },
    { t: "Description", d: (meta.description || "—").slice(0, 220) },
    { t: "H1", d: ((meta.h1 || [])[0] || "—") },
    { t: "Words / links", big: (meta.content && meta.content.plain_text_word_count) || 0, d: `Internal links: ${pm.links_internal ?? "—"} · External: ${pm.links_external ?? "—"}` },
    { t: "Load / size", d: `DOM complete: ${pm.onpage_timing && pm.onpage_timing.duration_time ? Math.round(pm.onpage_timing.duration_time) + " ms" : "—"} · Broken links: ${pm.broken_links ?? "—"} · Broken resources: ${pm.broken_resources ?? "—"}` },
  ]) + (Object.keys(checks).length ? table([{ label: "Check", key: "k" }, { label: "Passed", key: "v" }], Object.entries(checks).map(([k, v]) => ({ k, v: v ? "✅ yes" : "❌ no" }))) : "") + rawDetails(data);
}));
$("btnStartCrawl").addEventListener("click", () => run("auditResults", "auditProgress", async () => {
  const url = $("auditUrl").value.trim(); if (!url) throw new Error("Enter your site URL first.");
  const maxPages = Math.min(1000, Math.max(1, parseInt($("auditMaxPages").value, 10) || 25));
  const post = await dfs("/v3/on_page/task_post", { start_url: url, max_crawl_pages: maxPages, load_resources: true, enable_javascript: false, calculate_keyword_density: false });
  const t = firstTask(post); const id = t && t.id; if (!id) throw new Error("DataForSEO did not return a crawl task id.");
  $("auditResults").innerHTML = `<p class="hint">Crawl started (task ${esc(id)}). Polling its summary…</p>`;
  let summary = null;
  for (let i = 0; i < 30; i++) {
    await sleep(10000);
    const data = await dfs("/v3/on_page/summary/" + id, null, "GET");
    const r = firstResult(data);
    const st = r && r.crawl_progress && r.crawl_progress.status;
    $("auditResults").innerHTML = `<p class="hint">Crawl status: ${esc(st || "…")} · pages crawled so far: ${r && r.crawl_progress ? (r.crawl_progress.pages_crawled || 0) : 0} (check ${i + 1}/30)</p>`;
    if (st === "finished") { summary = r; break; }
  }
  const pagesData = await dfs("/v3/on_page/pages", { id, limit: 100, order_by: ["meta.onpage_score,desc"] });
  const rows = itemsOf(pagesData).map((p) => ({ url: p.url, score: p.meta && p.meta.onpage_score != null ? Math.round(p.meta.onpage_score) : (p.onpage_score != null ? Math.round(p.onpage_score) : "—"), title: (p.meta && p.meta.title) || "", status: p.status_code, issues: p.page_metrics ? (p.page_metrics.broken_links || 0) + (p.page_metrics.broken_resources || 0) : "—" }));
  $("auditResults").innerHTML = (summary ? cards([{ t: "Pages crawled", big: summary.page_metrics ? summary.page_metrics.pages_in_queue + summary.crawl_progress.pages_crawled : summary.crawl_progress.pages_crawled, d: "Full-site crawl via On-Page API" }, { t: "Avg on-page score", big: summary.page_metrics && summary.page_metrics.onpage_score != null ? Math.round(summary.page_metrics.onpage_score) : "—", d: "" }]) : "<p class='hint'>Crawl is still running on DataForSEO — the pages below are what is ready so far.</p>")
    + table([{ label: "Page", key: "url" }, { label: "Score", key: "score" }, { label: "Title", key: "title" }, { label: "HTTP", key: "status" }, { label: "Broken links/resources", key: "issues" }], rows) + rawDetails(pagesData);
}));
$("btnContentSearch").addEventListener("click", () => run("auditResults", "auditProgress", async () => {
  const kw = $("bizName").value.trim() || $("aiKeyword").value.trim(); if (!kw) throw new Error("Set your business/brand name in Setup first.");
  const data = await dfs("/v3/content_analysis/search/live", { keyword: kw, search_mode: "one_domain", target_domain: profileDomain() || undefined, order_by: ["content_info.sentiment_connotations.positive,desc"], limit: 50 });
  const rows = itemsOf(data).map((i) => ({ title: i.page_category && i.url ? i.url : (i.url || i.title || ""), url: i.url, lang: i.language, sentiment: i.content_info && i.content_info.sentiment_connotations ? "👍 " + (i.content_info.sentiment_connotations.positive || 0) + " / 👎 " + (i.content_info.sentiment_connotations.negative || 0) : "", rating: i.aggregate_rating ? (i.aggregate_rating.value + " (" + i.aggregate_rating.votes_count + ")") : "" }));
  $("auditResults").innerHTML = "<h3>Web content mentioning your brand</h3>" + table([{ label: "Page", key: "url" }, { label: "Language", key: "lang" }, { label: "Sentiment (+ / −)", key: "sentiment" }, { label: "Aggregate rating", key: "rating" }], rows) + rawDetails(data);
}));
$("btnContentSummary").addEventListener("click", () => run("auditResults", "auditProgress", async () => {
  const dom = profileDomain(); if (!dom) throw new Error("Set your website URL in Setup first.");
  const data = await dfs("/v3/content_analysis/summary/live", { target_domain: dom });
  const r = firstResult(data) || {};
  $("auditResults").innerHTML = cards([
    { t: "Pages analysed", big: fmt(r.total_count || 0), d: dom },
    { t: "Average rating found", big: r.rating && r.rating.value != null ? r.rating.value : "—", d: "Aggregate across analysed pages" },
    { t: "Sentiment", d: r.sentiment_connotations ? `Positive ${r.sentiment_connotations.positive || 0} · Negative ${r.sentiment_connotations.negative || 0} · Neutral ${r.sentiment_connotations.neutral || 0}` : "—" },
    { t: "Top categories", d: ((r.top_categories || []).slice(0, 5).map((c) => (c.relative_url || c.category || "")).filter(Boolean).join(", ") || "See raw data") },
  ]) + rawDetails(data);
}));

/* ---------------- Backlinks ---------------- */
function blTarget() { const d = domainOf($("blDomain").value); if (!d) throw new Error("Enter a domain first."); return d; }
$("btnBlSummary").addEventListener("click", () => run("blResults", "blProgress", async () => {
  const data = await dfs("/v3/backlinks/summary/live", { target: blTarget(), include_subdomains: true });
  const r = firstResult(data) || {};
  $("blResults").innerHTML = cards([
    { t: "DataForSEO rank", big: fmt(r.rank || 0), d: "0–1000 authority-style rank" },
    { t: "Backlinks", big: fmt(r.backlinks || 0), d: `Live: ${fmt(r.backlinks_spam_score != null ? "" : "")}${fmt(r.referring_pages || 0)} referring pages` },
    { t: "Referring domains", big: fmt(r.referring_domains || 0), d: `Main domains: ${fmt(r.referring_main_domains || 0)}` },
    { t: "Broken backlinks", big: fmt(r.broken_backlinks || 0), d: "" },
    { t: "Dofollow / nofollow", big: `${fmt(r.referring_links_tld ? "" : "")}${fmt(r.dofollow_backlinks || 0)} / ${fmt(r.nofollow_backlinks || 0)}`, d: "" },
    { t: "Spam score", big: r.backlinks_spam_score != null ? r.backlinks_spam_score : "—", d: "Lower is better" },
  ]) + rawDetails(data);
}));
$("btnBlList").addEventListener("click", () => run("blResults", "blProgress", async () => {
  const data = await dfs("/v3/backlinks/backlinks/live", { target: blTarget(), limit: 100, order_by: ["rank,desc"], include_subdomains: true });
  const rows = itemsOf(data).map((i) => ({ from: i.url_from, to: i.url_to, anchor: i.anchor, rank: i.rank, dofollow: i.dofollow ? "dofollow" : "nofollow" }));
  $("blResults").innerHTML = table([{ label: "Linking page", key: "from" }, { label: "Anchor", key: "anchor" }, { label: "Rank", key: "rank" }, { label: "Type", key: "dofollow" }, { label: "Your page", key: "to" }], rows) + rawDetails(data);
}));
$("btnBlRef").addEventListener("click", () => run("blResults", "blProgress", async () => {
  const data = await dfs("/v3/backlinks/referring_domains/live", { target: blTarget(), limit: 100, order_by: ["rank,desc"], include_subdomains: true });
  const rows = itemsOf(data).map((i) => ({ dom: i.domain, rank: i.rank, backlinks: i.backlinks_count, first: i.first_visited }));
  $("blResults").innerHTML = table([{ label: "Referring domain", key: "dom" }, { label: "Rank", key: "rank" }, { label: "Backlinks", key: "backlinks" }, { label: "First seen", key: "first" }], rows) + rawDetails(data);
}));
$("btnBlAnchors").addEventListener("click", () => run("blResults", "blProgress", async () => {
  const data = await dfs("/v3/backlinks/anchors/live", { target: blTarget(), limit: 100, include_subdomains: true });
  const rows = itemsOf(data).map((i) => ({ anchor: i.anchor, backlinks: i.backlinks, domains: i.referring_domains }));
  $("blResults").innerHTML = table([{ label: "Anchor text", key: "anchor" }, { label: "Backlinks", key: "backlinks" }, { label: "Referring domains", key: "domains" }], rows) + rawDetails(data);
}));

/* ---------------- Reputation & GBP ---------------- */
function bizKeywordStr() { const n = $("bizName").value.trim() || (selectedBiz && selectedBiz.title) || ""; if (!n) throw new Error("Set your business name in Setup (or pick it in the Maps tab) first."); return n; }
$("btnRepListing").addEventListener("click", () => run("repResults", "repProgress", async () => {
  const name = bizKeywordStr();
  const data = await dfs("/v3/business_data/business_listings/search/live", { title: name, location_code: locCode(), limit: 10 });
  const rows = itemsOf(data);
  if (!rows.length) { $("repResults").innerHTML = "<p class='hint'>No listing matched that name in this country. Check the name/country in Setup.</p>" + rawDetails(data); return; }
  $("repResults").innerHTML = rows.map((i) => { const r = i.rating || {}; return `<div class="card" style="margin-bottom:10px"><h4>${esc(i.title)}</h4><p>${esc(i.category || "")}<br>${esc(i.address || "")}<br>${esc(i.phone || "")}<br>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.url)}</a>` : ""}</p><p>⭐ ${r.value != null ? r.value : "—"} (${fmt(r.votes_count || 0)} reviews) · Place ID: ${esc(i.place_id || "—")}<br>Photos: ${i.total_photos != null ? i.total_photos : "—"} · Claimed: ${i.is_claimed != null ? (i.is_claimed ? "yes" : "no") : "—"}</p></div>`; }).join("") + rawDetails(data);
}));
$("btnRepRatings").addEventListener("click", () => run("repResults", "repProgress", async () => {
  const data = await dfs("/v3/content_analysis/rating_distribution/live", { keyword: bizKeywordStr(), location_code: locCode(), language_code: lang(), search_mode: "one_domain", target_domain: profileDomain() || undefined });
  const r = firstResult(data) || {}; const metrics = r.metrics || {};
  const dist = [];
  ["positive", "negative", "neutral"].forEach((k) => { if (metrics[k]) dist.push({ band: k, count: metrics[k].aggregate_rating ? metrics[k].aggregate_rating.votes_count : (metrics[k].items_count || 0), avg: metrics[k].aggregate_rating ? metrics[k].aggregate_rating.value : "" }); });
  $("repResults").innerHTML = "<h3>Rating distribution for content about your business</h3>" + table([{ label: "Sentiment band", key: "band" }, { label: "Items", key: "count" }, { label: "Average rating", key: "avg" }], dist) + rawDetails(data);
}));
$("btnRepSentiment").addEventListener("click", () => run("repResults", "repProgress", async () => {
  const data = await dfs("/v3/content_analysis/sentiment_analysis/live", { keyword: bizKeywordStr(), location_code: locCode(), language_code: lang(), search_mode: "one_domain", target_domain: profileDomain() || undefined });
  const r = firstResult(data) || {};
  $("repResults").innerHTML = cards([
    { t: "Pages analysed", big: fmt(r.total_count || 0), d: "" },
    { t: "Positive connotations", big: fmt(r.sentiment_connotations ? (r.sentiment_connotations.positive || 0) : 0), d: "" },
    { t: "Negative connotations", big: fmt(r.sentiment_connotations ? (r.sentiment_connotations.negative || 0) : 0), d: "" },
    { t: "Neutral", big: fmt(r.sentiment_connotations ? (r.sentiment_connotations.neutral || 0) : 0), d: "" },
  ]) + rawDetails(data);
}));
$("btnRepReviews").addEventListener("click", () => run("repResults", "repProgress", async () => {
  const post = await dfs("/v3/reviews/google/task_post", { keyword: bizKeywordStr(), location_code: locCode(), language_code: lang(), depth: 20 });
  const t = firstTask(post); const id = t && t.id; if (!id) throw new Error("DataForSEO did not return a reviews task id.");
  const data = await pollTask("/v3/reviews/google/task_get/" + id, 18, 10000, "repResults");
  const r = firstResult(data) || {}; const items = (r.items || []).map((i) => ({ author: i.profile_name, rating: i.rating ? i.rating.value : "", date: i.time_ago || i.timestamp, text: (i.review_text || "").slice(0, 280), response: i.owner_answer ? "✅ owner replied" : "— no reply yet" }));
  $("repResults").innerHTML = cards([{ t: "Business", big: esc(r.title || bizKeywordStr()), d: "" }, { t: "Rating", big: r.rating ? r.rating.value : "—", d: (r.reviews_count || r.rating ? fmt((r.rating && r.rating.votes_count) || 0) : "") + " reviews" }, { t: "Reviews fetched", big: items.length, d: "Most recent first — reply to the ones with no owner reply" }])
    + table([{ label: "Author", key: "author" }, { label: "⭐", key: "rating" }, { label: "When", key: "date" }, { label: "Review", key: "text" }, { label: "Owner response", key: "response" }], items) + rawDetails(data);
}));

/* ---------------- AI Optimization ---------------- */
$("btnAiMentions").addEventListener("click", () => run("aiResults", "aiProgress", async () => {
  const kw = $("aiKeyword").value.trim(); if (!kw) throw new Error("Enter a brand or keyword first.");
  const data = await dfs("/v3/ai_optimization/llm_mentions/search/live", { keyword: kw, location_code: locCode(), language_code: lang(), limit: 50 });
  let rows = itemsOf(data).map((i) => ({ platform: i.platform || i.ai_model || "", question: (i.question || i.prompt || "").slice(0, 160), mentions: i.mentions_count != null ? i.mentions_count : (Array.isArray(i.mentions) ? i.mentions.length : ""), domain: i.domain || profileDomain() }));
  const plat = $("aiPlatform").value; if (plat) rows = rows.filter((r) => String(r.platform).toLowerCase().includes(plat.replace("_", " ")) || String(r.platform).toLowerCase().includes(plat));
  $("aiResults").innerHTML = table([{ label: "AI platform", key: "platform" }, { label: "Question / prompt", key: "question" }, { label: "Mentions", key: "mentions" }], rows) + rawDetails(data);
}));
$("btnAiTopDomains").addEventListener("click", () => run("aiResults", "aiProgress", async () => {
  const kw = $("aiKeyword").value.trim(); if (!kw) throw new Error("Enter a brand or keyword first.");
  const data = await dfs("/v3/ai_optimization/llm_mentions/top_domains/live", { keyword: kw, location_code: locCode(), language_code: lang(), limit: 50 });
  const rows = itemsOf(data).map((i) => ({ domain: i.domain, mentions: i.mentions_count, share: i.share_of_voice != null ? i.share_of_voice : "" }));
  $("aiResults").innerHTML = table([{ label: "Domain cited in AI answers", key: "domain" }, { label: "Mentions", key: "mentions" }, { label: "Share of voice", key: "share" }], rows) + rawDetails(data);
}));

/* ---------------- Domain Analytics ---------------- */
$("btnDomWhois").addEventListener("click", () => run("domResults", "domProgress", async () => {
  const d = domainOf($("domDomain").value); if (!d) throw new Error("Enter a domain first.");
  const data = await dfs("/v3/domain_analytics/whois/overview/live", { target: d });
  const r = firstResult(data) || {}; const items = (r.items || [])[0] || r;
  $("domResults").innerHTML = cards([
    { t: "Domain", big: d, d: "" },
    { t: "Registrar", d: items.registrar || "—" },
    { t: "Created / expires", d: `${items.created_datetime || "—"} → ${items.expiration_datetime || items.expired_datetime || "—"}` },
    { t: "Registered", d: items.registered_domain ? "yes" : "see raw data" },
  ]) + rawDetails(data);
}));
$("btnDomTech").addEventListener("click", () => run("domResults", "domProgress", async () => {
  const d = domainOf($("domDomain").value); if (!d) throw new Error("Enter a domain first.");
  const data = await dfs("/v3/domain_analytics/technologies/domain_technologies/live", { target: d });
  const r = firstResult(data) || {}; const techs = r.technologies || {};
  const rows = [];
  Object.entries(techs).forEach(([cat, groups]) => { if (groups && typeof groups === "object") Object.values(groups).flat().forEach((t) => { if (t && t.name) rows.push({ cat, tech: t.name, ver: t.version || "" }); }); });
  $("domResults").innerHTML = (rows.length ? table([{ label: "Category", key: "cat" }, { label: "Technology", key: "tech" }, { label: "Version", key: "ver" }], rows) : "<p class='hint'>No technology list parsed — see raw data below.</p>") + rawDetails(data);
}));
