# API Map — every tool, every endpoint

All calls go browser → this app's server (`POST /api/dfs`, allowlisted
proxy, or the dedicated Maps routes) → `https://api.dataforseo.com/v3/…`
with the visitor's own credentials (HTTP Basic). Live endpoints are always
sent **one task per POST**.

## Dedicated routes (server.js)

| Route | Upstream | Used by |
|---|---|---|
| `POST /api/test` | `GET /v3/appendix/user_data` | Setup — test connection |
| `POST /api/business/search` | `POST /v3/serp/google/maps/live/advanced` (depth 20, `search_this_area`, coordinate-centered on the geocoded city in any country) | Maps tab — find the business; exact-match listings without coordinates are geocoded to their real location before a grid is centered |
| `POST /api/maps/scan` | `POST /v3/serp/google/maps/live/advanced` — **one request per grid point**, pool of 5, depth 100 → depth-20 retry, three-way match (place_id → coords ≤0.002° → suffix-stripped name) | Maps tab — grid scan |

References: [SERP API](https://dataforseo.com/apis/serp-api)

## Generic proxy modules (app.js → /api/dfs)

### Rank Tracker
- `POST /v3/serp/google/organic/live/advanced` — live position check per keyword (depth 100)
- `POST /v3/dataforseo_labs/google/domain_rank_overview/live` — domain overview
- `POST /v3/dataforseo_labs/google/ranked_keywords/live` — **ranked keywords**; grouping the same response by ranking page produces the **ranked pages / top ranking pages** views
- `POST /v3/dataforseo_labs/google/keywords_for_site/live` — **new-keyword opportunities** for the site

References: [rank-tracking app solution](https://dataforseo.com/solutions/rank-tracking-app) ·
[#ranked-pages](https://dataforseo.com/solutions/rank-tracking-app#ranked-pages) ·
[#tab-ranked-pages-vs-all-pages](https://dataforseo.com/solutions/rank-tracking-app#tab-ranked-pages-vs-all-pages) ·
[#tab-top-ranking-pages](https://dataforseo.com/solutions/rank-tracking-app#tab-top-ranking-pages) ·
[#tab-new-keywords](https://dataforseo.com/solutions/rank-tracking-app#tab-new-keywords) ·
[Labs API](https://dataforseo.com/apis/dataforseo-labs-api)

### Keywords
- `POST /v3/keywords_data/google_ads/search_volume/live` — volume, CPC, competition, monthly trend
- `POST /v3/dataforseo_labs/google/keyword_suggestions/live` — suggestions
- `POST /v3/dataforseo_labs/google/search_intent/live` — intent classification

Reference: [Keywords Data API](https://dataforseo.com/apis/keyword-data-api)

### Site & Content Audit
- `POST /v3/on_page/instant_pages` — instant single-page audit (score, meta, checks, timings)
- `POST /v3/on_page/task_post` → poll `GET /v3/on_page/summary/{id}` → `POST /v3/on_page/pages` — full crawl
- `POST /v3/content_analysis/search/live` — web content mentioning the brand
- `POST /v3/content_analysis/summary/live` — domain content summary & sentiment

References: [On-Page API](https://dataforseo.com/apis/on-page-api) ·
[Content Analysis API](https://dataforseo.com/apis/content-analysis-api)

### Backlinks
- `POST /v3/backlinks/summary/live`
- `POST /v3/backlinks/backlinks/live`
- `POST /v3/backlinks/referring_domains/live`
- `POST /v3/backlinks/anchors/live`

Reference: [Backlinks API](https://dataforseo.com/apis/backlinks-api)

### Reputation & GBP
- `POST /v3/business_data/business_listings/search/live` — GBP/business listing details (rating, reviews count, photos, claimed, place_id)
- `POST /v3/content_analysis/rating_distribution/live` — rating distribution across the web
- `POST /v3/content_analysis/sentiment_analysis/live` — review/content sentiment
- `POST /v3/reviews/google/task_post` → poll `GET /v3/reviews/google/task_get/{id}` — latest Google reviews + owner-reply flags

References: [API-driven reputation management](https://dataforseo.com/solutions/api-driven-reputation-management) ·
[Business Data API](https://dataforseo.com/apis/business-data-api) ·
[Reviews API](https://dataforseo.com/apis/reviews-api)

### AI Optimization
- `POST /v3/ai_optimization/llm_mentions/search/live` — brand mentions in AI answers (filterable by platform in the UI)
- `POST /v3/ai_optimization/llm_mentions/top_domains/live` — most-cited domains for a keyword

Reference: [AI Optimization API](https://dataforseo.com/apis/ai-optimization-api)

### Domain Analytics
- `POST /v3/domain_analytics/whois/overview/live`
- `POST /v3/domain_analytics/technologies/domain_technologies/live`

Reference: [Domain Analytics API](https://dataforseo.com/apis/domain-analytics-api)

## Locations & languages

The Setup tab ships DataForSEO `location_code` values for 44 countries plus
a custom-code override, and a free-text `language_code`. The Maps business
search geocodes *city + country/region* via OpenStreetMap Nominatim, so it
works in any country, not just the US.
