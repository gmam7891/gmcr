---
name: Influencer Discovery
description: Instagram discovery uses seed-based two-layer enrichment reusing instagram-profile analytics; Twitch is not primary.
type: feature
---

# Influencer Discovery — Instagram 2-layer enrichment

## Sourcing
Instagram discovery must prioritize:
1. **Seed mode:** user provides 1–3 Instagram references; backend extracts followed accounts and caps candidates at 30.
2. **Fallback mode:** when no reference exists, briefing/filters/custom keywords feed Firecrawl profile search.
3. **Layer 1:** cheap `instagram-profile-scraper` profile scrape with hard filters before expensive enrichment.
4. **Layer 2:** only top 15 Layer 1 survivors call the existing `instagram-profile` function for rich metrics.
5. **Layer 3:** Gemini qualifies enriched profiles against the briefing.

## Rules
- Target cost is controlled by enriching only 15 survivors with rich Instagram-tab analytics.
- Private reference profiles return a friendly error; private candidate profiles are silently discarded.
- Results should show `score_breakdown.reason`, `engagement_rate`, `median_views`, and `stories_view_estimate` when available.
- **NO automatic keywords** unless AI expansion is explicitly enabled or fallback needs briefing extraction.
- **Reference profile URLs:** support up to 3 Instagram references as removable chips.
- **Engagement filter (≥)**: 0–1000% slider.
- **No iGaming bias** in scoring. Casino terms only flag `has_casino_content` when explicitly detected.

## Frontend
- Loading should communicate long-running stages: references/keywords → fast scrape → rich enrichment → AI scoring.
- Result UI shows all returned prospects with sorting by original, score, followers, or engagement.
