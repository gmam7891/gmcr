---
name: Influencer Discovery
description: Manual-first prospecting. No auto-keywords, no iGaming bias. Manual filters for keywords, location, gender, age, follower range, engagement (≥0–1000%), and reference profile URL.
type: feature
---

# Influencer Discovery — Manual-first

## Rules
- **NO automatic keyword suggestion.** The "Termos de busca" field is empty by default; the user adds terms manually.
- **AI expansion is opt-in** via the "Expandir com IA" toggle (off by default). Only runs when toggle ON + briefing not empty + no manual keywords.
- **Reference profile URL** (Instagram or Twitch): when provided, the backend scrapes that profile via Apify, extracts niche/topic keywords from its bio via Lovable AI, and uses them as seeds — combined with any manual keywords.
- **Engagement filter (≥)**: slider + numeric input from 0% to 1000%. `engagement_rate = avg_views / followers * 100`. `0` = no filter. Profiles below the threshold are dropped.
- **No iGaming bias in scoring.** Casino-related terms only flag `has_casino_content` for display.
- **Location is generic** — substring match against `location_declared`/`location_inferred`.
- **Gender** is inferred only from explicit hints in bio/name; soft penalty when user picks a specific gender.
- **Followers range** (min + max) — user-defined; defaults to no limit.

## Frontend
- `src/components/tabs/DiscoveryTab.tsx`
- Sections: Briefing (optional + AI toggle) → Reference URL → Manual keywords → Demographic filters (location/gender/age/followers/engagement) → Platforms → Submit.
- Engagement displayed on result cards next to followers/views.
- Validation: requires at least one of briefing, keywords, locations, or reference_url.

## Backend
- `supabase/functions/influencer-discovery/index.ts`
- Accepts: `briefing`, `custom_keywords`, `manual_filters {locations, gender, min_age, max_age, min_followers, max_followers, min_engagement}`, `use_ai_expansion`, `reference_url`.
- `parseProfileUrl` + `scrapeReferenceProfile` (Apify `apify~instagram-profile-scraper` for IG, login fallback for Twitch).
- `extractKeywordsFromProfile` calls Lovable AI Gateway (`google/gemini-3-flash-preview`, `response_format: json_object`) to derive 5–10 niche keywords from the reference bio.
- Engagement is computed per profile as `(avg_views / followers) * 100` and filtered post-scoring; the field is stripped before DB insert (not a column).
