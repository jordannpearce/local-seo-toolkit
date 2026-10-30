# Local SEO Toolkit — Bring Your Own DataForSEO Key

A **free, open-source local SEO toolkit** that runs entirely on **your own
[DataForSEO](https://dataforseo.com) API key**. No subscriptions to this tool,
no lead capture, no data stored on a server — your key talks to DataForSEO
through a small self-hosted proxy and every report is yours.

Built from the same per-point grid-scan engine as the Pearce Studios Maps
Rank Checker, expanded into the full suite described in DataForSEO's own
[rank-tracking app](https://dataforseo.com/solutions/rank-tracking-app) and
[API-driven reputation management](https://dataforseo.com/solutions/api-driven-reputation-management)
solutions.

## What's inside

| Tab | What it does | DataForSEO APIs |
|---|---|---|
| ⚙️ Setup & Business | Test your key, see your balance, save your business profile (website, name, city, **any country**, language) | Appendix |
| 📍 Maps Rank Tracker | Search Google Maps for your business **in any country** with a live searching bar, pick the listing, preview the grid on a map, then run a 3×3–13×13 geo-grid scan (0.5–10 mi spacing) | SERP API — Google Maps Live |
| 🏆 Rank Tracker | Live Google position checks for your keywords + Labs views: domain overview, **ranked keywords, ranked pages vs. all pages, top ranking pages, and new-keyword opportunities** | SERP API — Google Organic Live · DataForSEO Labs |
| 🔑 Keywords | Search volume & CPC, keyword suggestions, and search intent | Keywords Data API · Labs |
| 🩺 Site & Content Audit | Instant page audit, **full website crawl** (task-based, auto-polled) with per-page scores, plus brand content analysis & sentiment | On-Page API · Content Analysis API |
| 🔗 Backlinks | Summary, top backlinks, referring domains, anchors | Backlinks API |
| ⭐ Reputation & GBP | Google Business Profile / business listing details, rating distribution across the web, review sentiment, and your **latest Google reviews** (with “no owner reply yet” flags) | Business Data API · Reviews API · Content Analysis API |
| 🤖 AI Optimization | How your brand shows up in AI answers — LLM mentions search and top cited domains | AI Optimization API |
| 🌐 Domain Analytics | WHOIS overview and the technology stack running a site | Domain Analytics API |
| 🛡️ Security Scanner | The full Pearce Studios website security scanner: graded A–F report, 8 security-header checks (incl. cookie/CSRF-hardening flags), server info disclosure, TLS certificate, tech fingerprinting (CMS/frameworks/hosting/analytics), sitemap & robots.txt, and email security (SPF, DMARC policy, DKIM across 14 selectors, MX). SSRF-guarded; no API key needed | Built into the server (Node built-ins only) |

## Quick start

You need Node.js 18+ (for built-in `fetch`). No `npm install` — **zero dependencies**.

```bash
git clone https://github.com/jordannpearce/local-seo-toolkit.git
cd local-seo-toolkit
node server.js
# open http://localhost:8080
```

Or deploy it: it ships with a `Procfile`, so Railway / Render / Heroku-style
hosts run it with `npm start`. Set `PORT` if your host doesn't.

Then:
1. Create a free DataForSEO account and copy your **API login + API password**
   (Dashboard → API Access — *not* your website password).
2. Paste them into the **Setup** tab and hit **Test connection**.
3. Fill in your website URL, business name, city and country, and save.
4. Run any tool. Costs are charged by DataForSEO to *your* account,
   pay-as-you-go (live SERP calls are cents; a 5×5 Maps grid = 25 calls).

## How the Maps grid scan works (and why)

DataForSEO's **Live** method accepts **only one task per POST** — batching a
whole grid into one request silently processes just the first point. This
tool therefore sends **one Live request per grid point** (5 in parallel,
30 s timeout), at **depth 100 with one depth-20 retry**, and matches your
business three ways, in order: **place_id → coordinates within 0.002° →
name match** (legal suffixes stripped). Every point reports how many
listings were checked and how it matched, and a failed point shows its real
error instead of a fake “not found”. Business search accepts listings
without coordinates but refuses to center a grid on a city center when the
business's exact location is unknown — it resolves the real location first.

Map tiles are **OpenStreetMap** (Leaflet), loaded same-origin through the
server's own `/tiles/{z}/{x}/{y}.png` proxy — the server fetches each tile
from tile.openstreetmap.org with an identifying User-Agent and caches it,
the pattern OSM's tile usage policy asks of apps. Browsers never request
OSM tiles directly, so they can't be served a blocked-tile placeholder.
Selecting a business pre-loads the map with a ★ marker on the business and
the full grid of scan points, fitted to view. Tiles © OpenStreetMap
contributors.

## Privacy & security

- API credentials are sent **per request only**, from your browser to your
  own server instance to DataForSEO. They are **never stored, logged, or
  sent anywhere else**.
- The optional “remember key” checkbox stores the key in **your own
  browser's localStorage on your own device** — nowhere else.
- The server proxy is **allowlisted** to DataForSEO v3 API families only;
  it cannot be used as a general-purpose proxy.
- Business profile details live only in your browser's localStorage.

## Endpoint map

Every module and the exact endpoint it calls is documented in
[`docs/API-MAP.md`](docs/API-MAP.md).

## License

MIT — use it, fork it, ship it for your clients. Attribution appreciated,

## Created By

Jordan Pearce was the creator of this repo. https://jordanpearce.com . For more questions, consulting bookings please email hire@info.jordanpearce.com

---

*Made for local businesses, freelancers and small agencies who would rather
pay API rates than another $99/month dashboard.*
