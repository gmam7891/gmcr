---
name: Influencer Discovery
description: Instagram discovery is seed-based with Apify enrichment; Twitch route remains lightweight; Firecrawl is fallback only.
type: feature
---

# Influencer Discovery — Seed-based Instagram + Twitch support

## Sourcing
Instagram discovery must not use hashtag/post scraping as the primary source. It uses:
1. **Seed mode:** user provides 1–3 Instagram references; backend extracts followed accounts, caps candidates at 30, then enriches each profile with Apify profile data.
2. **Fallback mode:** when no reference exists, briefing/filters/custom keywords feed Firecrawl profile search, then candidates are enriched through Apify.
3. **Twitch route:** keep lightweight Twitch scraping available when platform includes Twitch.

## Rules
- **NO automatic keywords.** "Termos de busca" is empty by default and OPTIONAL.
- **AI keyword expansion** is opt-in via toggle, only runs when ON + briefing present + no manual kws.
- **Reference profile URLs:** support up to 3 Instagram references as removable chips.
- **Engagement filter (≥)**: 0–1000% slider. Instagram engagement uses recent post interactions / followers when enriched.
- **No iGaming bias** in scoring. Casino terms only flag `has_casino_content`.
- **Generic location/gender/followers/age filters** — all manual, all optional.
- **All non-spam profiles are returned and shown**, regardless of `match_score`. Score is informational only.

## Frontend (`src/components/tabs/DiscoveryTab.tsx`)
- Sections: Briefing (optional + AI toggle) → Reference URLs → Manual keywords (optional) → Filters → Platforms → Submit.
- Result UI shows ALL prospects with a sort dropdown: `original | score | followers | engagement`.
- No qualified/low-score toggle — removed per user request.

## Backend (`supabase/functions/influencer-discovery/index.ts`)
- Instagram route: `runInstagramDiscovery` → seed following list or Firecrawl fallback → Apify profile enrichment → hard filters → Gemini qualification.
- Return Gemini qualification reason in `score_breakdown.reason` for UI context.
- Private reference profiles return a friendly error.
