// Local SEO Toolkit (BYO DataForSEO key) — open source, self-hosted
// Same engine as the Pearce Studios Rank Checker:
//   POST /api/rank/test   — validate a visitor's own DataForSEO credentials
//   POST /api/rank/search — find a business via DataForSEO Google Maps API
//   POST /api/rank/scan   — geo-grid rank scan (3x3-13x13) via DataForSEO
//   GET  /tiles/z/x/y.png — OpenStreetMap tile proxy (identifying UA + cache)
// Visitors' DataForSEO credentials are used per-request only and are
// NEVER stored, logged, or sent anywhere except DataForSEO.
// Host variables:
//   PORT     (set automatically by Railway)
//   TILE_UA  (optional) identifying User-Agent for the OSM tile proxy,
//            e.g. "YourBrand/1.0 (https://yourdomain.com; you@yourdomain.com)"
//            Set this once your domain is live — OSM asks apps to identify themselves.

const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const DFS_BASE = "https://api.dataforseo.com";
const GEO_UA = process.env.TILE_UA || "MapsGridRankTracker/1.0 (standalone rank tracker)";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readJsonBody(req, limit) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > (limit || 64 * 1024)) req.destroy();
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

/* ---------------- Rank Checker (DataForSEO, visitor's own key) ---------------- */

function dfsAuth(login, password) {
  return "Basic " + Buffer.from(login + ":" + password).toString("base64");
}

async function dfsMapsLive(login, password, tasks, signal) {
  const res = await fetch(DFS_BASE + "/v3/serp/google/maps/live/advanced", {
    method: "POST",
    headers: {
      Authorization: dfsAuth(login, password),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tasks),
    signal,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { httpStatus: res.status, data };
}

function dfsCredsError(httpStatus, data) {
  if (httpStatus === 401 || (data && data.status_code === 40100)) {
    return "DataForSEO rejected those credentials (401 Unauthorized). Check your API login and password.";
  }
  if (data && data.status_message && data.status_code >= 40000) {
    return "DataForSEO error " + data.status_code + ": " + data.status_message;
  }
  return "DataForSEO request failed (HTTP " + httpStatus + ").";
}

async function geocodeCity(city, state) {
  const q = encodeURIComponent(city + ", " + state);
  const res = await fetch(
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + q,
    { headers: { "User-Agent": GEO_UA, "Accept-Language": "en" } }
  );
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr.length) return null;
  const lat = parseFloat(arr[0].lat);
  const lng = parseFloat(arr[0].lon);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng };
}

async function geocodePlace(query) {
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + q,
      { headers: { "User-Agent": GEO_UA, "Accept-Language": "en" } }
    );
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) return null;
    const lat = parseFloat(arr[0].lat);
    const lng = parseFloat(arr[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function taskItems(taskResult) {
  if (!taskResult || !Array.isArray(taskResult.result) || !taskResult.result.length)
    return [];
  const items = taskResult.result[0].items;
  return Array.isArray(items) ? items : [];
}

// Scan results can span multiple entries in task.result; collect items from
// ALL of them. (taskItems above deliberately reads only the first entry,
// which is what the business search relies on.)
function taskItemsAll(taskResult) {
  if (!taskResult || !Array.isArray(taskResult.result)) return [];
  const all = [];
  for (const entry of taskResult.result) {
    if (entry && Array.isArray(entry.items)) all.push(...entry.items);
  }
  return all;
}

function mapSearchItem(item, center) {
  const rating = item.rating || {};
  // Only trust coordinates the item actually carries. Substituting the city
  // center here made the page center the scan grid on the city instead of
  // the business, so most grid points missed it. Missing coords stay null;
  // handleRankSearch resolves the exact-match listing separately.
  const hasCoords =
    typeof item.latitude === "number" && typeof item.longitude === "number";
  return {
    title: String(item.title || ""),
    address: String(item.address || ""),
    rating: typeof rating.value === "number" ? rating.value : null,
    ratingCount: typeof rating.votes_count === "number" ? rating.votes_count : null,
    category: String(item.category || ""),
    placeId: item.place_id || null,
    lat: hasCoords ? item.latitude : null,
    lng: hasCoords ? item.longitude : null,
  };
}

async function handleRankTest(req, res) {
  const body = await readJsonBody(req);
  if (!body) return sendJson(res, 400, { ok: false, error: "Invalid request." });
  const login = String(body.login || "").trim();
  const password = String(body.password || "");
  if (!login || !password)
    return sendJson(res, 400, { ok: false, error: "Enter your DataForSEO API login and password." });
  try {
    const r = await fetch(DFS_BASE + "/v3/appendix/user_data", {
      headers: { Authorization: dfsAuth(login, password) },
    });
    if (r.ok) return sendJson(res, 200, { ok: true });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return sendJson(res, 200, { ok: false, error: dfsCredsError(r.status, data) });
  } catch (err) {
    return sendJson(res, 200, { ok: false, error: "Could not reach DataForSEO: " + err.message });
  }
}

async function handleRankSearch(req, res) {
  const body = await readJsonBody(req);
  if (!body) return sendJson(res, 400, { ok: false, error: "Invalid request." });
  const login = String(body.login || "").trim();
  const password = String(body.password || "");
  const business = String(body.business || "").trim().slice(0, 160);
  const city = String(body.city || "").trim().slice(0, 80);
  const state = String(body.state || "").trim().slice(0, 80);
  const lang = String(body.language_code || "en").trim().slice(0, 8) || "en";
  if (!login || !password)
    return sendJson(res, 400, { ok: false, error: "Enter your DataForSEO API login and password." });
  if (!business || !city || !state)
    return sendJson(res, 400, { ok: false, error: "Enter the business name, city, and state." });

  const center = await geocodeCity(city, state);
  if (!center)
    return sendJson(res, 200, { ok: false, error: "Could not find that city and state. Check the spelling and try again." });

  const debug = { geocoded: center, attempts: [] };
  const attempts = [
    { keyword: business, zoom: "13z" },
    { keyword: business + " " + city + " " + state, zoom: "11z" },
  ];
  for (const attempt of attempts) {
    const coordinate = center.lat + "," + center.lng + "," + attempt.zoom;
    let out;
    try {
      out = await dfsMapsLive(login, password, [
        {
          keyword: attempt.keyword,
          language_code: lang,
          location_coordinate: coordinate,
          search_this_area: true,
          depth: 20,
        },
      ]);
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: "Could not reach DataForSEO: " + err.message, debug });
    }
    const task = out.data && Array.isArray(out.data.tasks) ? out.data.tasks[0] : null;
    const items = taskItems(task).filter((i) => i && i.title);
    debug.attempts.push({
      keyword: attempt.keyword,
      coordinate,
      httpStatus: out.httpStatus,
      status_code: task ? task.status_code : out.data ? out.data.status_code : null,
      status_message: task ? task.status_message : out.data ? out.data.status_message : null,
      items: items.length,
    });
    if (out.httpStatus === 401 || (out.data && out.data.status_code === 40100)) {
      return sendJson(res, 200, { ok: false, error: dfsCredsError(out.httpStatus, out.data), debug });
    }
    if (items.length) {
      const results = items.slice(0, 10).map((i) => mapSearchItem(i, center));
      // The single prominent result of an exact-name search often has no
      // coordinates. If the first exact-title listing is missing them,
      // resolve its real location so the scan grid centers on the business
      // itself rather than the city center.
      const targetName = normName(business);
      const exactIdx = results.findIndex(
        (r) => r.lat == null && normName(r.title) === targetName
      );
      if (exactIdx >= 0) {
        const place = await geocodePlace(
          results[exactIdx].title + ", " + city + ", " + state
        );
        if (place) {
          results[exactIdx].lat = place.lat;
          results[exactIdx].lng = place.lng;
          debug.businessGeocoded = { lat: place.lat, lng: place.lng };
        }
      }
      return sendJson(res, 200, { ok: true, center, results, debug });
    }
  }
  return sendJson(res, 200, {
    ok: false,
    error:
      "Google Maps returned no listings for that business name near this city. Try the exact name as it appears on your Google Business Profile.",
    center,
    debug,
  });
}

function normName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const NAME_SUFFIXES = new Set(["llc", "inc", "corp", "corporation", "co", "company", "ltd"]);

// Like normName, but also drops trailing legal-entity suffix tokens so
// "Acme Plumbing LLC" and "Acme Plumbing" compare equal.
function normNameLoose(s) {
  const tokens = normName(s).split(" ").filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

function rankOfItem(item) {
  return typeof item.rank_group === "number" ? item.rank_group : item.rank_absolute;
}

// Find the business in one grid point's result items. Tries, in order:
// place_id equality, coordinate proximity (the business's real location
// identifies it even when Google formats its name differently), then a
// loose name match (equality or containment either direction).
// Returns { rank, matchedBy } or null.
function matchScanItem(items, biz) {
  if (biz.placeId) {
    for (const item of items) {
      if (item && item.place_id && item.place_id === biz.placeId)
        return { rank: rankOfItem(item), matchedBy: "place_id" };
    }
  }
  if (isFinite(biz.lat) && isFinite(biz.lng)) {
    for (const item of items) {
      if (
        item &&
        typeof item.latitude === "number" &&
        typeof item.longitude === "number" &&
        Math.abs(item.latitude - biz.lat) <= 0.002 &&
        Math.abs(item.longitude - biz.lng) <= 0.002
      )
        return { rank: rankOfItem(item), matchedBy: "coords" };
    }
  }
  const target = normNameLoose(biz.title);
  if (target) {
    for (const item of items) {
      if (!item || !item.title) continue;
      const cand = normNameLoose(item.title);
      if (!cand) continue;
      if (cand === target || cand.includes(target) || target.includes(cand))
        return { rank: rankOfItem(item), matchedBy: "name" };
    }
  }
  return null;
}

async function handleRankScan(req, res) {
  const body = await readJsonBody(req);
  if (!body) return sendJson(res, 400, { ok: false, error: "Invalid request." });
  const login = String(body.login || "").trim();
  const password = String(body.password || "");
  const keyword = String(body.keyword || "").trim().slice(0, 160);
  const lang = String(body.language_code || "en").trim().slice(0, 8) || "en";
  const biz = body.business || {};
  const title = String(biz.title || "").trim();
  const placeId = biz.placeId || null;
  const lat = parseFloat(biz.lat);
  const lng = parseFloat(biz.lng);
  const gridSize = parseInt(body.gridSize, 10);
  let spacing = parseFloat(body.spacingMiles);
  if (!login || !password)
    return sendJson(res, 400, { ok: false, error: "Enter your DataForSEO API login and password." });
  if (!keyword) return sendJson(res, 400, { ok: false, error: "Enter a keyword to rank for." });
  if (!title)
    return sendJson(res, 400, { ok: false, error: "Select your business first." });
  if (!isFinite(lat) || !isFinite(lng))
    return sendJson(res, 200, {
      ok: false,
      error:
        "We couldn't pin down that business's exact location from the search result. Try the search again — pick the listing that shows a street address.",
    });
  if (![3, 5, 7, 9, 13].includes(gridSize))
    return sendJson(res, 400, { ok: false, error: "Choose a grid size: 3x3, 5x5, 7x7, 9x9, or 13x13." });
  if (![0.5, 1, 2, 3, 5, 10].includes(spacing)) spacing = 1;

  const half = (gridSize - 1) / 2;
  const latStep = spacing / 69.0;
  const lngStep = spacing / (69.0 * Math.cos((lat * Math.PI) / 180));
  const coords = [];
  for (let r = half; r >= -half; r--) {
    for (let c = -half; c <= half; c++) {
      coords.push({ lat: lat + r * latStep, lng: lng + c * lngStep });
    }
  }

  const taskBase = coords.map((p) => ({
    keyword,
    language_code: lang,
    location_coordinate: p.lat.toFixed(7) + "," + p.lng.toFixed(7) + ",13z",
    search_this_area: true,
  }));

  // DataForSEO's Live method accepts only ONE task per POST request (per
  // their best-practices doc, "How to collect SERP data from DataForSEO
  // API"). The old code posted the whole grid in a single array, so only
  // the first point's task was ever processed and every other point came
  // back empty. Each point is now fetched individually, 5 at a time.
  const bizForMatch = { placeId, lat, lng, title };
  const points = new Array(coords.length);
  const pointDebug = new Array(coords.length);
  const debug = { tasks: pointDebug };
  let authFailure = null; // { httpStatus, data } from the first 401 response
  let firstError = null; // { code, message } from the first non-auth point error

  async function fetchPointTask(taskObj) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      return await dfsMapsLive(login, password, [taskObj], controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function scanPoint(idx) {
    const p = coords[idx];
    let depthUsed = 100;
    let last = null; // { task, items, fetchError } from the final attempt
    for (const depth of [100, 20]) {
      depthUsed = depth;
      let out = null;
      let fetchError = null;
      try {
        out = await fetchPointTask({ ...taskBase[idx], depth });
      } catch (err) {
        fetchError = err;
      }
      if (
        !fetchError &&
        out &&
        (out.httpStatus === 401 || (out.data && out.data.status_code === 40100))
      ) {
        authFailure = { httpStatus: out.httpStatus, data: out.data };
        return;
      }
      const task =
        !fetchError && out && out.data && Array.isArray(out.data.tasks)
          ? out.data.tasks[0]
          : null;
      const items = taskItemsAll(task);
      last = { task, items, fetchError };
      const taskErrored =
        !!fetchError ||
        !task ||
        (typeof task.status_code === "number" && task.status_code >= 40000);
      // Retry once at depth 20 when the deep attempt errored or came back
      // empty; otherwise this point is done.
      if (!(taskErrored || items.length === 0) || depth === 20) break;
    }
    const { task, items, fetchError } = last;
    const statusCode = task ? task.status_code : null;
    const statusMessage = task
      ? task.status_message
      : fetchError
        ? "Request failed: " + fetchError.message
        : "No task returned.";
    pointDebug[idx] = {
      status_code: statusCode,
      status_message: statusMessage,
      items: items.length,
      depthUsed,
    };
    const errored =
      !!fetchError ||
      !task ||
      (typeof statusCode === "number" && statusCode >= 40000);
    if (errored) {
      if (!firstError) firstError = { code: statusCode, message: statusMessage };
      points[idx] = {
        lat: p.lat,
        lng: p.lng,
        rank: null,
        found: false,
        itemsCount: null,
        matchedBy: null,
        topTitles: [],
        error: String(statusMessage || "DataForSEO task failed."),
      };
      return;
    }
    const match = matchScanItem(items, bizForMatch);
    const rank = match ? match.rank : null;
    points[idx] = {
      lat: p.lat,
      lng: p.lng,
      rank: rank == null ? null : rank,
      found: rank != null,
      itemsCount: items.length,
      matchedBy: match ? match.matchedBy : null,
      topTitles: items.slice(0, 3).map((it) => String((it && it.title) || "")),
    };
  }

  let nextPoint = 0;
  async function poolWorker() {
    while (!authFailure) {
      const idx = nextPoint++;
      if (idx >= coords.length) return;
      await scanPoint(idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(5, coords.length) }, () => poolWorker())
  );

  if (authFailure) {
    return sendJson(res, 200, {
      ok: false,
      error: dfsCredsError(authFailure.httpStatus, authFailure.data),
      debug,
    });
  }

  const errorCount = points.filter((pt) => pt && pt.error).length;
  if (points.length && errorCount === points.length) {
    const fe = firstError || { code: null, message: "Unknown error" };
    const label = fe.code != null ? fe.code + ": " + fe.message : String(fe.message);
    return sendJson(res, 200, {
      ok: false,
      error:
        "DataForSEO couldn't complete the scan tasks (" +
        label +
        "). No points could be checked.",
      debug,
    });
  }

  const foundRanks = points.filter((p) => p.found).map((p) => p.rank);
  const pct = (n) => (points.length ? Math.round((n / points.length) * 1000) / 10 : 0);
  const summary = {
    found: foundRanks.length,
    total: points.length,
    avgRank: foundRanks.length
      ? Math.round((foundRanks.reduce((a, b) => a + b, 0) / foundRanks.length) * 10) / 10
      : null,
    best: foundRanks.length ? Math.min(...foundRanks) : null,
    worst: foundRanks.length ? Math.max(...foundRanks) : null,
    top3Pct: pct(foundRanks.filter((r) => r <= 3).length),
    top10Pct: pct(foundRanks.filter((r) => r <= 10).length),
  };
  return sendJson(res, 200, { ok: true, points, summary, debug });
}


/* ---------------- Website security scanner ---------------- */
// POST /api/website-scan { url } — fetches a public website and reports
// security headers, TLS, server/tech fingerprinting, sitemap/robots, and
// email authentication (SPF/DKIM/DMARC/MX). Built-ins only (http/https/dns).
// Because the endpoint is public, every target (including redirect hops)
// is SSRF-checked: hostnames that resolve to private/reserved addresses
// are refused before any connection is made. Known limitation: this is a
// pre-flight DNS check — without connection-level address pinning it does
// not fully eliminate DNS-rebinding (TOCTOU) attacks.

const SCAN_UA =
  process.env.SCAN_UA || "LocalSEOToolkit-SecurityScanner/1.0 (self-hosted)";
const SSRF_MESSAGE =
  "That address can't be scanned — it resolves to a private or internal network address.";
const DKIM_SELECTORS = [
  "default", "google", "selector1", "selector2", "k1", "k2", "mail",
  "dkim", "s1", "s2", "mandrill", "amazonses", "mailjet", "sendgrid",
];

function ssrfError() {
  const err = new Error(SSRF_MESSAGE);
  err.isSsrf = true;
  return err;
}

function isPrivateAddress(addr) {
  if (!addr) return true;
  const a = String(addr).toLowerCase();
  if (net.isIPv4(a)) {
    const p = a.split(".").map(Number);
    if (p[0] === 10) return true; // 10.0.0.0/8
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true; // 192.168.0.0/16
    if (p[0] === 127) return true; // 127.0.0.0/8 loopback
    if (p[0] === 169 && p[1] === 254) return true; // 169.254.0.0/16 link-local
    if (p[0] === 0) return true; // 0.0.0.0/8
    return false;
  }
  if (net.isIPv6(a)) {
    if (a === "::1" || a === "::") return true;
    if (a.startsWith("::ffff:")) {
      const v4 = a.slice(7);
      if (net.isIPv4(v4)) return isPrivateAddress(v4);
    }
    const first = parseInt(a.split(":")[0] || "0", 16);
    if (!isNaN(first)) {
      if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
      if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    }
    return false;
  }
  return true; // unparseable — treat as unsafe
}

// Resolve a hostname and refuse it if ANY address is private/reserved.
// Returns the list of resolved (public) addresses.
async function resolvePublicHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal"))
    throw ssrfError();
  const addrs = await dns.promises.lookup(host, { all: true });
  if (!addrs || !addrs.length) throw new Error("Could not resolve host: " + host);
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw ssrfError();
  }
  return addrs.map((a) => a.address);
}

// One raw GET request (no redirect following) with TLS capture. Assumes the
// host has already passed resolvePublicHost for this URL.
function rawRequest(urlObj, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 12000;
  const maxBody = (opts && opts.maxBody) || 1024 * 1024;
  return new Promise((resolve, reject) => {
    const lib = urlObj.protocol === "https:" ? https : http;
    const started = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      req.destroy(
        new Error("Request timed out after " + Math.round(timeoutMs / 1000) + "s")
      );
    }, timeoutMs);
    const finish = (fn, val) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(val);
      }
    };
    const req = lib.request(
      {
        protocol: urlObj.protocol,
        hostname: String(urlObj.hostname).replace(/^\[|\]$/g, ""),
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: "GET",
        headers: {
          "User-Agent": SCAN_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        // Capture TLS details NOW, at response start: by the time 'end'
        // fires the socket may already be detached (res.socket === null).
        let tls = null;
        if (
          urlObj.protocol === "https:" &&
          res.socket &&
          typeof res.socket.getPeerCertificate === "function"
        ) {
          try {
            const cert = res.socket.getPeerCertificate();
            if (cert && (cert.valid_to || cert.subject)) {
              const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
              tls = {
                authorized: !!res.socket.authorized,
                protocol:
                  typeof res.socket.getProtocol === "function"
                    ? res.socket.getProtocol()
                    : null,
                subject:
                  (cert.subject && (cert.subject.CN || cert.subject.O)) || null,
                issuer: cert.issuer
                  ? [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(" / ") ||
                    null
                  : null,
                validFrom: cert.valid_from || null,
                validTo: cert.valid_to || null,
                daysRemaining: validTo
                  ? Math.floor((validTo.getTime() - Date.now()) / 86400000)
                  : null,
              };
            }
          } catch {
            tls = null;
          }
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          if (size < maxBody) {
            const take = Math.min(chunk.length, maxBody - size);
            chunks.push(chunk.slice(0, take));
            size += take;
          }
        });
        res.on("end", () => {
          finish(resolve, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            responseTimeMs: Date.now() - started,
            tls,
          });
        });
        res.on("error", (err) => finish(reject, err));
      }
    );
    req.on("error", (err) => finish(reject, err));
    req.end();
  });
}

// GET with manual redirect following; every hop (including the first URL
// and every redirect target) is SSRF-checked before connecting.
async function fetchFollowing(urlStr, opts) {
  const maxRedirects = opts && opts.maxRedirects != null ? opts.maxRedirects : 5;
  const chain = [];
  let current = new URL(urlStr);
  let firstIps = null;
  const startedAll = Date.now();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const ips = await resolvePublicHost(current.hostname);
    if (hop === 0) firstIps = ips;
    const r = await rawRequest(current, opts);
    chain.push({ url: current.toString(), status: r.status });
    const loc = r.headers.location;
    const isRedirect = [301, 302, 303, 307, 308].includes(r.status) && !!loc;
    if (!isRedirect || hop === maxRedirects) {
      return {
        chain,
        finalUrl: current.toString(),
        status: r.status,
        headers: r.headers,
        body: r.body,
        tls: r.tls,
        responseTimeMs: Date.now() - startedAll,
        ips: firstIps,
      };
    }
    current = new URL(loc, current);
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error("Redirect to a non-HTTP address was blocked.");
    }
  }
}

function cspDirective(csp, name) {
  if (!csp) return null;
  for (const part of String(csp).split(";")) {
    const t = part.trim();
    if (!t) continue;
    const sp = t.indexOf(" ");
    const key = (sp === -1 ? t : t.slice(0, sp)).toLowerCase();
    if (key === name) return sp === -1 ? "" : t.slice(sp + 1);
  }
  return null;
}

function evaluateHeaders(headers, isHttps) {
  const checks = [];
  const get = (k) => (headers[k] != null ? String(headers[k]) : null);

  // HSTS
  const hstsVal = get("strict-transport-security");
  if (!isHttps) {
    checks.push({
      id: "hsts", name: "Strict-Transport-Security", status: "fail",
      value: hstsVal, detail: "site is not on HTTPS",
    });
  } else if (!hstsVal) {
    checks.push({
      id: "hsts", name: "Strict-Transport-Security", status: "fail", value: null,
      detail: "No HSTS header — browsers are not told to force HTTPS for this site.",
    });
  } else {
    const m = hstsVal.match(/max-age=(\d+)/i);
    const maxAge = m ? parseInt(m[1], 10) : null;
    if (maxAge != null && maxAge >= 15552000) {
      checks.push({
        id: "hsts", name: "Strict-Transport-Security", status: "pass", value: hstsVal,
        detail: "HSTS is on with max-age " + maxAge + "s (180 days or more).",
      });
    } else if (maxAge != null) {
      checks.push({
        id: "hsts", name: "Strict-Transport-Security", status: "warn", value: hstsVal,
        detail: "HSTS is on but max-age is only " + maxAge + "s — 15552000 (180 days) or more is recommended.",
      });
    } else {
      checks.push({
        id: "hsts", name: "Strict-Transport-Security", status: "warn", value: hstsVal,
        detail: "HSTS header is present but has no parsable max-age.",
      });
    }
  }

  // Content-Security-Policy
  const cspVal = get("content-security-policy");
  const cspReportOnly = get("content-security-policy-report-only");
  if (cspVal) {
    const scriptRules =
      cspDirective(cspVal, "script-src") || cspDirective(cspVal, "default-src") || "";
    if (scriptRules.includes("'unsafe-inline'") && scriptRules.includes("'unsafe-eval'")) {
      checks.push({
        id: "csp", name: "Content-Security-Policy", status: "warn", value: cspVal,
        detail: "CSP is present, but script rules allow both 'unsafe-inline' and 'unsafe-eval', which weakens XSS protection.",
      });
    } else {
      checks.push({
        id: "csp", name: "Content-Security-Policy", status: "pass", value: cspVal,
        detail: "Content-Security-Policy is set.",
      });
    }
  } else if (cspReportOnly) {
    checks.push({
      id: "csp", name: "Content-Security-Policy", status: "warn", value: cspReportOnly,
      detail: "Only a report-only CSP is set — violations are logged, not blocked. Enforce a Content-Security-Policy header.",
    });
  } else {
    checks.push({
      id: "csp", name: "Content-Security-Policy", status: "fail", value: null,
      detail: "No Content-Security-Policy — the main browser defense against injected scripts is missing.",
    });
  }

  // Clickjacking (X-Frame-Options / CSP frame-ancestors)
  const xfoVal = get("x-frame-options");
  const frameAncestors = cspVal ? cspDirective(cspVal, "frame-ancestors") : null;
  if (
    (xfoVal && /^(deny|sameorigin)$/i.test(xfoVal.trim())) ||
    frameAncestors != null
  ) {
    checks.push({
      id: "x-frame", name: "X-Frame-Options", status: "pass",
      value: xfoVal || "frame-ancestors " + frameAncestors,
      detail: "Clickjacking protection is on (framing is restricted).",
    });
  } else if (xfoVal) {
    checks.push({
      id: "x-frame", name: "X-Frame-Options", status: "warn", value: xfoVal,
      detail: "X-Frame-Options has an unrecognized value — DENY or SAMEORIGIN is expected.",
    });
  } else {
    checks.push({
      id: "x-frame", name: "X-Frame-Options", status: "fail", value: null,
      detail: "No X-Frame-Options and no CSP frame-ancestors — other sites can embed this page in a frame (clickjacking risk).",
    });
  }

  // X-Content-Type-Options
  const xctoVal = get("x-content-type-options");
  if (xctoVal && xctoVal.trim().toLowerCase() === "nosniff") {
    checks.push({
      id: "x-content-type", name: "X-Content-Type-Options", status: "pass", value: xctoVal,
      detail: "MIME-sniffing is disabled with nosniff.",
    });
  } else {
    checks.push({
      id: "x-content-type", name: "X-Content-Type-Options", status: "fail", value: xctoVal,
      detail: "X-Content-Type-Options should be \"nosniff\" — without it browsers may guess content types.",
    });
  }

  // X-XSS-Protection (legacy header; modern browsers rely on CSP)
  const xxssVal = get("x-xss-protection");
  if (xxssVal && xxssVal.trim() === "0") {
    checks.push({
      id: "x-xss", name: "X-XSS-Protection", status: "warn", value: xxssVal,
      detail: "X-XSS-Protection is set to 0 (disabled). That matches modern guidance — current browsers rely on CSP instead of this legacy filter.",
    });
  } else if (xxssVal) {
    checks.push({
      id: "x-xss", name: "X-XSS-Protection", status: "pass", value: xxssVal,
      detail: "Legacy XSS filter header is present (modern browsers rely mainly on CSP).",
    });
  } else {
    checks.push({
      id: "x-xss", name: "X-XSS-Protection", status: "fail", value: null,
      detail: "No X-XSS-Protection header. Impact is low today — modern browsers rely on CSP — but older browsers use this filter.",
    });
  }

  // Referrer-Policy
  const refVal = get("referrer-policy");
  const RECOGNIZED_REFERRER = [
    "no-referrer", "no-referrer-when-downgrade", "origin",
    "origin-when-cross-origin", "same-origin", "strict-origin",
    "strict-origin-when-cross-origin", "unsafe-url",
  ];
  if (refVal) {
    const tokens = refVal.toLowerCase().split(",").map((t) => t.trim());
    if (tokens.some((t) => RECOGNIZED_REFERRER.includes(t))) {
      checks.push({
        id: "referrer-policy", name: "Referrer-Policy", status: "pass", value: refVal,
        detail: "Referrer-Policy is set to a recognized value.",
      });
    } else {
      checks.push({
        id: "referrer-policy", name: "Referrer-Policy", status: "warn", value: refVal,
        detail: "Referrer-Policy is present but its value isn't one of the standard policies.",
      });
    }
  } else {
    checks.push({
      id: "referrer-policy", name: "Referrer-Policy", status: "fail", value: null,
      detail: "No Referrer-Policy — full page URLs can leak to third-party sites via the Referer header.",
    });
  }

  // Permissions-Policy
  const permVal = get("permissions-policy");
  if (permVal) {
    checks.push({
      id: "permissions-policy", name: "Permissions-Policy", status: "pass", value: permVal,
      detail: "Permissions-Policy is set, restricting browser features (camera, mic, geolocation, etc.).",
    });
  } else {
    checks.push({
      id: "permissions-policy", name: "Permissions-Policy", status: "fail", value: null,
      detail: "No Permissions-Policy — browser features like camera, microphone, and geolocation aren't restricted by policy.",
    });
  }

  // Cookies & session flags (CSRF hardening angle: SameSite blunts CSRF,
  // Secure/HttpOnly protect the session cookie itself.)
  const setCookies = Array.isArray(headers["set-cookie"]) ? headers["set-cookie"] : [];
  if (!setCookies.length) {
    checks.push({
      id: "cookies", name: "Cookies & session flags (CSRF hardening)", status: "warn",
      value: null,
      detail: "No cookies were set by the homepage — nothing to flag; session cookies should use Secure, HttpOnly, and SameSite",
    });
  } else {
    const missing = { Secure: 0, HttpOnly: 0, SameSite: 0 };
    for (const cookie of setCookies) {
      const parts = String(cookie).split(";").map((p) => p.trim().toLowerCase());
      if (isHttps && !parts.includes("secure")) missing.Secure++;
      if (!parts.includes("httponly")) missing.HttpOnly++;
      if (!parts.some((p) => p.startsWith("samesite="))) missing.SameSite++;
    }
    const gaps = Object.keys(missing).filter((k) => missing[k] > 0);
    if (!gaps.length) {
      checks.push({
        id: "cookies", name: "Cookies & session flags (CSRF hardening)", status: "pass",
        value: setCookies.length + " cookie(s) set",
        detail: "Every cookie carries the expected flags" + (isHttps ? " (Secure, HttpOnly, SameSite)." : " (HttpOnly, SameSite)."),
      });
    } else {
      checks.push({
        id: "cookies", name: "Cookies & session flags (CSRF hardening)", status: "warn",
        value: setCookies.length + " cookie(s) set",
        detail: "Missing flags: " + gaps.map((k) => k + " on " + missing[k] + " of " + setCookies.length + " cookie(s)").join("; ") + ". SameSite blunts CSRF; Secure + HttpOnly protect session cookies.",
      });
    }
  }

  return checks;
}

function detectTech(html, headers, setCookies) {
  const found = [];
  const add = (name, category, evidence) => found.push({ name, category, evidence });
  const has = (re) => re.test(html);
  const server = String(headers["server"] || "");
  const powered = String(headers["x-powered-by"] || "");
  const cookieNames = (setCookies || []).map((c) => String(c).split("=")[0].trim());

  // --- CMS ---
  if (has(/wp-content|wp-includes/)) add("WordPress", "CMS", "wp-content / wp-includes asset paths in page source");
  else if (has(/wp-json/)) add("WordPress", "CMS", "wp-json REST API reference in page source");
  else if (has(/name="generator" content="WordPress/i)) add("WordPress", "CMS", "Meta generator tag names WordPress");
  if (has(/name="generator" content="Drupal/i)) add("Drupal", "CMS", "Meta generator tag names Drupal");
  else if (has(/Drupal\.settings|\/sites\/default\//)) add("Drupal", "CMS", "Drupal settings / sites/default path in page source");
  if (has(/name="generator" content="Joomla/i)) add("Joomla", "CMS", "Meta generator tag names Joomla");
  else if (has(/\/media\/jui\//)) add("Joomla", "CMS", "Joomla /media/jui asset paths in page source");
  if (has(/cdn\.shopify\.com/)) add("Shopify", "CMS", "cdn.shopify.com assets in page source");
  else if (has(/myshopify\.com/)) add("Shopify", "CMS", "myshopify.com reference in page source");
  else if (has(/\bShopify\./)) add("Shopify", "CMS", "Shopify JavaScript object in page source");
  const wixHeader = Object.keys(headers).find((k) => k.startsWith("x-wix"));
  if (wixHeader) add("Wix", "CMS", "Response header: " + wixHeader);
  else if (has(/wixstatic\.com|wix\.com/)) add("Wix", "CMS", "Wix asset hosts in page source");
  if (has(/squarespace\.com/)) add("Squarespace", "CMS", "squarespace.com assets in page source");
  else if (has(/name="generator" content="Squarespace/i)) add("Squarespace", "CMS", "Meta generator tag names Squarespace");
  if (has(/name="generator" content="Ghost/i)) add("Ghost", "CMS", "Meta generator tag names Ghost");
  else if (has(/\/ghost\/api\//)) add("Ghost", "CMS", "Ghost API path in page source");
  if (has(/\/static\/frontend\//)) add("Magento", "CMS", "/static/frontend asset paths in page source");
  else if (has(/\bMagento\b/)) add("Magento", "CMS", "Magento reference in page source");
  else if (cookieNames.some((n) => /^mage-/i.test(n))) add("Magento", "CMS", "Magento (mage-*) cookies set");

  // --- Frameworks / libraries ---
  if (has(/__NEXT_DATA__/)) add("Next.js", "Framework / Library", "__NEXT_DATA__ payload in page source");
  else if (has(/\/_next\/static\//)) add("Next.js", "Framework / Library", "/_next/static asset paths in page source");
  if (has(/__NUXT__/)) add("Nuxt", "Framework / Library", "__NUXT__ payload in page source");
  else if (has(/\/_nuxt\//)) add("Nuxt", "Framework / Library", "/_nuxt/ asset paths in page source");
  if (has(/data-reactroot|data-reactid/)) add("React", "Framework / Library", "data-reactroot / data-reactid attributes in page source");
  else if (has(/react\.production|react-dom/)) add("React", "Framework / Library", "React / ReactDOM scripts in page source");
  if (has(/data-v-[0-9a-f]{8}/)) add("Vue.js", "Framework / Library", "Scoped data-v-* attributes in page source");
  else if (has(/vue\.runtime|__vue__/)) add("Vue.js", "Framework / Library", "Vue runtime markers in page source");
  if (has(/ng-version|ng-app/)) add("Angular", "Framework / Library", "ng-version / ng-app attributes in page source");
  else if (has(/angular(\.min)?\.js/)) add("Angular", "Framework / Library", "angular.js script in page source");
  if (has(/svelte-[a-z0-9]{5,}/)) add("Svelte", "Framework / Library", "Svelte scoped-style class hashes in page source");
  if (has(/jquery-\d|jquery(\.min)?\.js|jquery\/\d/)) add("jQuery", "Framework / Library", "jQuery script in page source");
  if (has(/bootstrap(\.min)?\.(css|js)|bootstrapcdn/)) add("Bootstrap", "Framework / Library", "Bootstrap CSS/JS in page source");
  if (has(/cdn\.tailwindcss\.com/)) add("Tailwind CSS", "Framework / Library", "Tailwind Play CDN script in page source");
  else if (has(/<style type="text\/tailwindcss">/)) add("Tailwind CSS", "Framework / Library", "text/tailwindcss style block in page source");
  if (has(/astro-island|data-astro-/)) add("Astro", "Framework / Library", "Astro island markers in page source");
  else if (has(/name="generator" content="Astro/i)) add("Astro", "Framework / Library", "Meta generator tag names Astro");
  if (has(/__gatsby|___gatsby/)) add("Gatsby", "Framework / Library", "Gatsby root markers in page source");

  // --- Hosting / server ---
  if (/cloudflare/i.test(server)) add("Cloudflare", "Hosting / Server", "Server header: " + server);
  else if (headers["cf-ray"]) add("Cloudflare", "Hosting / Server", "CF-Ray response header present");
  if (headers["x-vercel-id"] || headers["x-vercel-cache"]) add("Vercel", "Hosting / Server", "x-vercel response header present");
  else if (/vercel/i.test(server)) add("Vercel", "Hosting / Server", "Server header: " + server);
  if (headers["x-nf-request-id"]) add("Netlify", "Hosting / Server", "x-nf-request-id response header present");
  if (/apache/i.test(server)) add("Apache", "Hosting / Server", "Server header: " + server);
  if (/nginx/i.test(server)) add("Nginx", "Hosting / Server", "Server header: " + server);
  if (/litespeed/i.test(server)) add("LiteSpeed", "Hosting / Server", "Server header: " + server);
  if (headers["x-aspnet-version"]) add("Microsoft IIS / ASP.NET", "Hosting / Server", "X-AspNet-Version header: " + headers["x-aspnet-version"]);
  else if (/ASP\.NET/i.test(powered)) add("Microsoft IIS / ASP.NET", "Hosting / Server", "X-Powered-By: " + powered);
  if (/PHP\/?[\d.]*/i.test(powered)) add("PHP", "Framework / Library", "X-Powered-By: " + powered);
  if (/Express/i.test(powered)) add("Express / Node.js", "Framework / Library", "X-Powered-By: " + powered);

  // --- Analytics / marketing ---
  if (has(/gtag\(|google-analytics\.com/)) add("Google Analytics", "Analytics / Marketing", "gtag / google-analytics code in page source");
  if (has(/googletagmanager\.com/)) add("Google Tag Manager", "Analytics / Marketing", "googletagmanager.com code in page source");
  if (has(/connect\.facebook\.net/)) add("Meta Pixel", "Analytics / Marketing", "connect.facebook.net (Meta Pixel) in page source");

  return found;
}

async function txtAt(name) {
  try {
    const recs = await dns.promises.resolveTxt(name);
    return recs.map((r) => r.join(""));
  } catch {
    return [];
  }
}

async function checkEmailSecurity(domain) {
  const [txts, dmarcTxts, mxRecs, dkimResults] = await Promise.all([
    txtAt(domain),
    txtAt("_dmarc." + domain),
    dns.promises.resolveMx(domain).catch(() => []),
    Promise.all(
      DKIM_SELECTORS.map(async (sel) => {
        const recs = await txtAt(sel + "._domainkey." + domain);
        const hit = recs.find((t) => t.includes("v=DKIM1") || t.includes("p="));
        return hit ? { selector: sel, recordPreview: hit.slice(0, 120) } : null;
      })
    ),
  ]);

  // SPF
  const spfRecords = txts.filter((t) => /v=spf1\b/i.test(t));
  let spf;
  if (!spfRecords.length) {
    spf = {
      found: false, record: null, status: "fail",
      detail: "No SPF record — anyone can spoof this domain's email and receivers can't tell.",
    };
  } else {
    const record = spfRecords[0];
    let detail = "SPF record is published.";
    let status = "pass";
    if (record.includes("+all")) {
      status = "warn";
      detail = "SPF ends in +all, which authorizes ANY server to send as this domain — effectively no protection.";
    } else if (spfRecords.length > 1) {
      status = "warn";
      detail = "Multiple SPF records found (" + spfRecords.length + ") — SPF requires exactly one; receivers may reject all of them.";
    } else if (record.includes("-all")) {
      detail = "SPF ends in -all (strict): unauthorized senders are told to reject.";
    } else if (record.includes("~all")) {
      detail = "SPF ends in ~all (softfail): unauthorized mail is flagged, not rejected.";
    }
    spf = { found: true, record, status, detail };
  }

  // DMARC
  const dmarcRecord = dmarcTxts.find((t) => /v=DMARC1/i.test(t)) || null;
  let dmarc;
  if (!dmarcRecord) {
    dmarc = {
      found: false, record: null, policy: null, status: "fail",
      detail: "No DMARC record — the domain has no policy telling receivers what to do with spoofed mail.",
    };
  } else {
    const pm = dmarcRecord.match(/(?:^|;)\s*p=([a-z]+)/i);
    const policy = pm ? pm[1].toLowerCase() : null;
    if (policy === "quarantine" || policy === "reject") {
      dmarc = {
        found: true, record: dmarcRecord, policy, status: "pass",
        detail: "DMARC policy p=" + policy + " — spoofed mail is " + (policy === "reject" ? "rejected." : "quarantined."),
      };
    } else {
      dmarc = {
        found: true, record: dmarcRecord, policy, status: "warn",
        detail: policy === "none"
          ? "DMARC is in monitor-only mode (p=none) — spoofed mail is reported but still delivered."
          : "DMARC record found but no clear enforcement policy (p=) was parsed.",
      };
    }
  }

  // DKIM
  const selectorsFound = dkimResults.filter(Boolean);
  const dkim = selectorsFound.length
    ? {
        found: true, selectorsFound, selectorsChecked: DKIM_SELECTORS, status: "pass",
        detail: "DKIM record(s) found for selector(s): " + selectorsFound.map((s) => s.selector).join(", ") + ".",
      }
    : {
        found: false, selectorsFound: [], selectorsChecked: DKIM_SELECTORS, status: "warn",
        detail: "No DKIM record found for the common selectors checked — DKIM may use a custom selector",
      };

  // MX
  const hosts = (mxRecs || [])
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((m) => m.exchange)
    .filter(Boolean);
  const mx = hosts.length
    ? { found: true, hosts, status: "pass", detail: "Mail exchangers: " + hosts.join(", ") + "." }
    : { found: false, hosts: [], status: "warn", detail: "No MX records — this domain likely doesn't receive email." };

  return { domain, spf, dmarc, dkim, mx };
}

function parseRobots(text) {
  const sitemapRefs = [];
  let disallowCount = 0;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    if (key === "sitemap" && val) sitemapRefs.push(val);
    if (key === "disallow" && val) disallowCount++;
  }
  return { sitemapRefs, disallowCount };
}

async function checkFiles(origin) {
  let robots = {
    found: false, url: origin + "/robots.txt", status: null,
    disallowCount: null, allowsAll: null, sitemapRefs: [], contentPreview: null,
  };
  let robotsResult = null;
  try {
    robotsResult = await fetchFollowing(origin + "/robots.txt", {
      maxRedirects: 3, timeoutMs: 8000, maxBody: 1024 * 1024,
    });
  } catch {
    robotsResult = null;
  }
  let robotsSitemaps = [];
  if (robotsResult && robotsResult.status === 200) {
    const text = robotsResult.body.toString("utf8");
    const parsed = parseRobots(text);
    robotsSitemaps = parsed.sitemapRefs;
    robots = {
      found: true,
      url: origin + "/robots.txt",
      status: robotsResult.status,
      disallowCount: parsed.disallowCount,
      allowsAll: parsed.disallowCount === 0,
      sitemapRefs: parsed.sitemapRefs,
      contentPreview: text.slice(0, 500),
    };
  } else if (robotsResult) {
    // A non-200 body (e.g. a 404 page) is not a robots file — don't parse it.
    robots = {
      found: false,
      url: origin + "/robots.txt",
      status: robotsResult.status,
      disallowCount: null,
      allowsAll: null,
      sitemapRefs: [],
      contentPreview: null,
    };
  }

  const fromRobots = robotsSitemaps.length > 0;
  const sitemapUrl = fromRobots ? robotsSitemaps[0] : origin + "/sitemap.xml";
  let sitemap = {
    found: false, url: sitemapUrl, status: null, entries: null, alsoFromRobots: fromRobots,
  };
  try {
    const sm = await fetchFollowing(sitemapUrl, {
      maxRedirects: 3, timeoutMs: 8000, maxBody: 2 * 1024 * 1024,
    });
    const xml = sm.body.toString("utf8");
    const matches = xml.match(/<loc>/g);
    sitemap = {
      found: sm.status === 200,
      url: sitemapUrl,
      status: sm.status,
      entries: matches ? matches.length : 0,
      alsoFromRobots: fromRobots,
    };
  } catch {
    // keep the not-found shape above
  }
  return { sitemap, robots };
}

// Scoring: start at 100 and subtract for problems. Each failed header check
// costs 8, each warning 3 (a cookies warning costs 2 — it's usually just
// missing flags). Email: DMARC fail −10 / warn −4, SPF fail −8 / warn −3,
// DKIM warn −3. A failed TLS check caps the score at 40; no HTTPS at all
// caps it at 50. Result is clamped to 0–100 and graded A ≥90, B ≥80,
// C ≥65, D ≥50, else F.
function computeScore(headerChecks, email, tlsStatus, isHttps) {
  let score = 100;
  for (const c of headerChecks) {
    if (c.status === "fail") score -= 8;
    else if (c.status === "warn") score -= c.id === "cookies" ? 2 : 3;
  }
  if (email.dmarc.status === "fail") score -= 10;
  else if (email.dmarc.status === "warn") score -= 4;
  if (email.spf.status === "fail") score -= 8;
  else if (email.spf.status === "warn") score -= 3;
  if (email.dkim.status === "warn") score -= 3;
  if (tlsStatus === "fail") score = Math.min(score, 40);
  if (!isHttps) score = Math.min(score, 50);
  return Math.max(0, Math.min(100, score));
}

function gradeFor(score) {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
}

async function handleWebsiteScan(req, res) {
  const body = await readJsonBody(req);
  if (!body) return sendJson(res, 400, { ok: false, error: "Invalid request." });
  let rawUrl = String(body.url || "").trim();
  if (!rawUrl)
    return sendJson(res, 400, { ok: false, error: "Enter a website URL to scan." });
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl)) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl))
      return sendJson(res, 400, { ok: false, error: "Only http:// and https:// URLs can be scanned." });
    rawUrl = "https://" + rawUrl;
  }
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return sendJson(res, 400, { ok: false, error: "That doesn't look like a valid URL." });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:")
    return sendJson(res, 400, { ok: false, error: "Only http:// and https:// URLs can be scanned." });
  const enteredScheme = target.protocol === "https:" ? "https" : "http";

  let main;
  try {
    main = await fetchFollowing(target.toString(), {
      maxRedirects: 5, timeoutMs: 12000, maxBody: 1024 * 1024,
    });
  } catch (err) {
    if (err && err.isSsrf)
      return sendJson(res, 200, { ok: false, error: SSRF_MESSAGE });
    return sendJson(res, 200, {
      ok: false,
      error: "Could not reach that website: " + (err && err.message ? err.message : err),
    });
  }

  const finalUrlObj = new URL(main.finalUrl);
  const isHttps = finalUrlObj.protocol === "https:";
  const headers = main.headers || {};
  const html = main.body ? main.body.toString("utf8") : "";
  const setCookies = Array.isArray(headers["set-cookie"]) ? headers["set-cookie"] : [];

  const headerChecks = evaluateHeaders(headers, isHttps);

  // Server info
  const serverHeader = headers["server"] != null ? String(headers["server"]) : null;
  const poweredBy = headers["x-powered-by"] != null ? String(headers["x-powered-by"]) : null;
  const disclosing = [serverHeader, poweredBy].filter((v) => v && /\d+\.\d+/.test(v));
  const serverInfo = {
    server: serverHeader,
    xPoweredBy: poweredBy,
    via: headers["via"] != null ? String(headers["via"]) : null,
    ipAddress: main.ips && main.ips.length ? main.ips[0] : null,
    versionDisclosure: disclosing.length
      ? "Version disclosed: " + disclosing.join("; ")
      : null,
  };

  // TLS
  let tls = null;
  let tlsStatus = null;
  if (isHttps) {
    if (main.tls) {
      tlsStatus =
        !main.tls.authorized || (main.tls.daysRemaining != null && main.tls.daysRemaining < 0)
          ? "fail"
          : main.tls.daysRemaining != null && main.tls.daysRemaining < 30
            ? "warn"
            : "pass";
      tls = {
        protocol: main.tls.protocol,
        issuer: main.tls.issuer,
        subject: main.tls.subject,
        validFrom: main.tls.validFrom,
        validTo: main.tls.validTo,
        daysRemaining: main.tls.daysRemaining,
        status: tlsStatus,
      };
    } else {
      tlsStatus = "warn";
      tls = {
        protocol: null, issuer: null, subject: null,
        validFrom: null, validTo: null, daysRemaining: null, status: "warn",
      };
    }
  }

  // HTTPS enforcement: entered as http and landed on https counts; otherwise
  // probe the http:// variant of the final origin for a redirect to https.
  let httpsEnforced = false;
  if (isHttps) {
    if (enteredScheme === "http") {
      httpsEnforced = true;
    } else {
      try {
        await resolvePublicHost(finalUrlObj.hostname);
        const probe = await rawRequest(
          new URL("http://" + finalUrlObj.host + "/"),
          { timeoutMs: 8000, maxBody: 64 * 1024 }
        );
        if (
          probe.status >= 300 && probe.status < 400 &&
          probe.headers.location && /^https:\/\//i.test(probe.headers.location)
        ) {
          httpsEnforced = true;
        }
      } catch {
        httpsEnforced = false;
      }
    }
  }

  const emailDomain = finalUrlObj.hostname.replace(/^www\./i, "");
  const [files, email] = await Promise.all([
    checkFiles(finalUrlObj.origin),
    checkEmailSecurity(emailDomain),
  ]);

  const tech = detectTech(html, headers, setCookies);
  const score = computeScore(headerChecks, email, tlsStatus, isHttps);

  return sendJson(res, 200, {
    ok: true,
    input: target.toString(),
    finalUrl: main.finalUrl,
    httpStatus: main.status,
    responseTimeMs: main.responseTimeMs,
    redirectChain: main.chain,
    httpsEnforced,
    score,
    grade: gradeFor(score),
    headers: headerChecks,
    serverInfo,
    tls,
    tech,
    files,
    email,
  });
}

/* ---------------- Map tile proxy (OpenStreetMap) ---------------- */
// The Rank Checker map loads tiles same-origin from /tiles/{z}/{x}/{y}.png.
// This proxy fetches them from tile.openstreetmap.org with an identifying
// User-Agent (what OSM's tile usage policy asks of apps — generic browser
// user-agents get served a blocked-tile image) and caches them in memory.
// No other tile source is involved.

const TILE_UA = process.env.TILE_UA || "LocalSEOToolkit/1.0 (self-hosted maps rank tracker)";
const TILE_CACHE_MAX = 500;
const tileCache = new Map(); // key "z/x/y" -> { contentType, body }

async function handleTile(req, res, z, x, y) {
  const key = z + "/" + x + "/" + y;
  const hit = tileCache.get(key);
  if (hit) {
    // Refresh recency so frequently used tiles are evicted last.
    tileCache.delete(key);
    tileCache.set(key, hit);
    res.writeHead(200, {
      "Content-Type": hit.contentType,
      "Cache-Control": "public, max-age=86400",
    });
    return res.end(hit.body);
  }
  try {
    const upstream = await fetch(
      "https://tile.openstreetmap.org/" + z + "/" + x + "/" + y + ".png",
      { headers: { "User-Agent": TILE_UA } }
    );
    if (!upstream.ok) {
      return sendTileError(res, "Tile unavailable (OpenStreetMap returned " + upstream.status + ").");
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type") || "image/png";
    if (tileCache.size >= TILE_CACHE_MAX) {
      tileCache.delete(tileCache.keys().next().value); // evict oldest
    }
    tileCache.set(key, { contentType, body });
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    });
    return res.end(body);
  } catch (err) {
    return sendTileError(res, "Tile unavailable (" + err.message + ").");
  }
}

function sendTileError(res, message) {
  res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

/* ---------------- Generic DataForSEO proxy (allowlisted) ----------------
   Every other module in the toolkit (SERP rank tracking, Labs, Keywords
   Data, On-Page, Backlinks, Business Data, Reviews, Content Analysis,
   Domain Analytics, AI Optimization) calls DataForSEO through this one
   route. The path is allowlisted to DataForSEO v3 API families, the
   visitor's credentials travel per-request only, and nothing is stored
   or logged. Live endpoints accept ONE task per POST — the frontend
   always sends exactly one. Async families (task_post / task_get /
   tasks_ready / summary / pages) are supported so the UI can poll. */

const DFS_ALLOWED_PREFIXES = [
  "/v3/serp/",
  "/v3/dataforseo_labs/",
  "/v3/keywords_data/",
  "/v3/on_page/",
  "/v3/backlinks/",
  "/v3/business_data/",
  "/v3/reviews/",
  "/v3/content_analysis/",
  "/v3/domain_analytics/",
  "/v3/ai_optimization/",
  "/v3/appendix/",
  "/v3/merchant/",
  "/v3/app_data/",
];

function dfsPathOk(p) {
  if (typeof p !== "string") return false;
  if (!p.startsWith("/v3/")) return false;
  if (p.includes("..") || p.includes("\\") || p.includes("?") || p.includes("#")) return false;
  if (!/^[a-zA-Z0-9\/_\-.]+$/.test(p)) return false;
  return DFS_ALLOWED_PREFIXES.some((pre) => p.startsWith(pre));
}

async function handleDfsProxy(req, res) {
  const body = await readJsonBody(req, 512 * 1024);
  if (!body) return sendJson(res, 400, { ok: false, error: "Invalid request." });
  const login = String(body.login || "").trim();
  const password = String(body.password || "");
  const apiPath = String(body.path || "");
  const method = String(body.method || "POST").toUpperCase() === "GET" ? "GET" : "POST";
  if (!login || !password)
    return sendJson(res, 400, { ok: false, error: "Enter your DataForSEO API login and password first (Setup tab)." });
  if (!dfsPathOk(apiPath))
    return sendJson(res, 400, { ok: false, error: "That DataForSEO endpoint is not allowed by this tool." });
  const payload = Array.isArray(body.payload) ? body.payload.slice(0, 1) : [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let upstream;
    try {
      upstream = await fetch(DFS_BASE + apiPath, {
        method,
        headers: { Authorization: dfsAuth(login, password), "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
    const text = await upstream.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!data) return sendJson(res, 200, { ok: false, error: "DataForSEO returned an unreadable response (HTTP " + upstream.status + ")." });
    if (upstream.status === 401 || data.status_code === 40100)
      return sendJson(res, 200, { ok: false, error: dfsCredsError(upstream.status, data), data });
    const taskErr = Array.isArray(data.tasks) && data.tasks[0] && typeof data.tasks[0].status_code === "number" && data.tasks[0].status_code >= 40000
      ? data.tasks[0].status_code + ": " + (data.tasks[0].status_message || "task error") : null;
    return sendJson(res, 200, { ok: !taskErr, error: taskErr, data });
  } catch (err) {
    return sendJson(res, 200, { ok: false, error: "Could not reach DataForSEO: " + err.message });
  }
}

/* ---------------- Static + routing ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/api/test") return await handleRankTest(req, res);
    if (req.method === "POST" && url.pathname === "/api/business/search") return await handleRankSearch(req, res);
    if (req.method === "POST" && url.pathname === "/api/maps/scan") return await handleRankScan(req, res);
    if (req.method === "POST" && (url.pathname === "/api/security/scan" || url.pathname === "/api/website-scan")) return await handleWebsiteScan(req, res);
    if (req.method === "POST" && url.pathname === "/api/dfs") return await handleDfsProxy(req, res);
    const tileMatch = req.method === "GET" ? url.pathname.match(/^\/tiles\/(\d{1,2})\/(\d+)\/(\d+)\.png$/) : null;
    if (tileMatch) {
      const z = +tileMatch[1], x = +tileMatch[2], y = +tileMatch[3];
      if (z > 19 || x >= 2 ** z || y >= 2 ** z) { res.writeHead(400); return res.end("Invalid tile coordinates."); }
      return await handleTile(req, res, z, x, y);
    }
    if (req.method !== "GET") { res.writeHead(405); return res.end("Method not allowed"); }
    let filePath = url.pathname === "/" ? path.join(ROOT, "index.html") : path.join(ROOT, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) filePath = path.join(ROOT, "index.html");
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Server error: " + err.message });
  }
});
server.listen(PORT, () => console.log("Local SEO Toolkit listening on " + PORT));
