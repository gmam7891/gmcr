---
name: Influencer Discovery
description: Manual-first prospecting. No auto-keywords, no iGaming bias. User controls keywords, location, gender, age, follower range.
type: feature
---

# Influencer Discovery — Manual-first

## Rules
- **NO automatic keyword suggestion.** The "Termos de busca" field is empty by default; the user adds terms manually.
- **AI expansion is opt-in** via the "Expandir com IA" toggle (off by default). Only runs when toggle ON + briefing not empty + no manual keywords.
- **No iGaming bias in scoring.** Casino-related terms only flag `has_casino_content` for display; they do not boost match_score.
- **Location is generic.** No hardcoded SE-Brazil bias. User adds free-text locations (city, country, state) and the engine substring-matches against `location_declared`/`location_inferred`.
- **Gender** is inferred only from explicit hints in bio/name (e.g., "ela/dela", "she/her", emoji ♀/♂). When user picks a specific gender, profiles with mismatched explicit hints are penalised; "unknown" passes through.
- **Followers range** (min + max) is user-defined; defaults to no limit.
- **Age** fields exist in the UI and are passed to the backend, but profiles are rarely classified — used as soft filter only.

## Frontend
- `src/components/tabs/DiscoveryTab.tsx`
- Sections: Briefing (optional) → Manual keywords → Demographic filters (location/gender/age/followers) → Platforms → Submit.
- Validation: requires at least one of briefing, keywords, or locations.

## Backend
- `supabase/functions/influencer-discovery/index.ts`
- Accepts: `briefing`, `custom_keywords`, `manual_filters {locations, gender, min_age, max_age, min_followers, max_followers}`, `use_ai_expansion`.
- AI expansion runs ONLY when `use_ai_expansion === true` AND briefing present AND no custom keywords.
- Falls back to location terms if no scraping keywords are provided.
