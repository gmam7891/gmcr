---
name: Influencer Discovery
description: Manual-first prospecting. Hybrid sourcing (Apify scraping + Firecrawl web search). No filtering by score — all profiles always shown, sortable.
type: feature
---

# Influencer Discovery — Manual-first + Web Search

## Sourcing
Profiles come from two parallel sources, deduplicated by `platform:username`:
1. **Apify** scrapers (`apify~instagram-hashtag-scraper`, Twitch search) — enriched data (followers, avg_views, bio).
2. **Firecrawl `/v2/search`** — real Google web search with `site:instagram.com "<kw>"` and `site:twitch.tv "<kw>"` queries. Returns lightweight profile stubs (URL, title, description). Requires `FIRECRAWL_API_KEY`.

## Rules
- **NO automatic keywords.** "Termos de busca" is empty by default and OPTIONAL.
- **AI keyword expansion** is opt-in via toggle, only runs when ON + briefing present + no manual kws.
- **Reference profile URL** (IG/Twitch): scraped via Apify, bio fed to Lovable AI to derive 5–10 niche keywords.
- **Engagement filter (≥)**: 0–1000% slider. `engagement_rate = avg_views / followers * 100`. Drops profiles below threshold.
- **No iGaming bias** in scoring. Casino terms only flag `has_casino_content`.
- **Generic location/gender/followers/age filters** — all manual, all optional.
- **All non-spam profiles are returned and shown**, regardless of `match_score`. Score is informational only.

## Frontend (`src/components/tabs/DiscoveryTab.tsx`)
- Sections: Briefing (optional + AI toggle) → Reference URL → Manual keywords (optional) → Filters → Platforms → Submit.
- Result UI shows ALL prospects with a sort dropdown: `original | score | followers | engagement`.
- No qualified/low-score toggle — removed per user request.

## Backend (`supabase/functions/influencer-discovery/index.ts`)
- `searchProfilesViaFirecrawl(keywords, platforms, limitPerQuery)` runs in parallel with Apify scrapers.
- Profiles merged & deduplicated before scoring.
- `engagement_rate` computed and stripped before DB insert.
- Returns `prospects: allScored` (all non-spam, sorted by score for default ordering).
