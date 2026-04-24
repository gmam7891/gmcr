import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// ─── AI Briefing Expansion ─────────────────────────────────────────────
async function expandBriefing(briefing: string): Promise<{ keywords: string[]; filters: any }> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `Você é um especialista em marketing de iGaming/Cassino no Brasil. Dado um briefing em linguagem natural, gere uma matriz de busca.
Responda APENAS com JSON no formato:
{
  "keywords_twitch": ["termo1","termo2",...],
  "keywords_instagram": ["#hashtag1","#hashtag2",...],
  "target_regions": ["SP","RJ",...],
  "min_followers": 20000,
  "content_indicators": ["slots","cassino","apostas","bet",...]
}
Foque em termos brasileiros do nicho iGaming/cassino/apostas esportivas.`,
        },
        { role: "user", content: briefing },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search_matrix",
            description: "Search matrix for influencer discovery",
            parameters: {
              type: "object",
              properties: {
                keywords_twitch: { type: "array", items: { type: "string" } },
                keywords_instagram: { type: "array", items: { type: "string" } },
                target_regions: { type: "array", items: { type: "string" } },
                min_followers: { type: "number" },
                content_indicators: { type: "array", items: { type: "string" } },
              },
              required: ["keywords_twitch", "keywords_instagram", "target_regions", "min_followers", "content_indicators"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "search_matrix" } },
    }),
  });

  if (!res.ok) {
    console.error("AI gateway error:", res.status, await res.text());
    return {
      keywords: ["cassino", "slots", "apostas", "bet", "iGaming"],
      filters: { min_followers: 20000, target_regions: ["SP", "RJ", "MG"] },
    };
  }

  const data = await res.json();
  try {
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    const parsed = JSON.parse(toolCall.function.arguments);
    return {
      keywords: [...(parsed.keywords_twitch || []), ...(parsed.keywords_instagram || [])],
      filters: parsed,
    };
  } catch {
    return {
      keywords: ["cassino", "slots", "apostas", "bet"],
      filters: { min_followers: 20000, target_regions: ["SP", "RJ"] },
    };
  }
}

// ─── Apify Scraping ────────────────────────────────────────────────────
async function scrapeTwitch(keywords: string[], limit: number): Promise<any[]> {
  try {
    const actorId = "epctex/twitch-scraper";
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchQueries: keywords.slice(0, 5),
        maxItems: limit,
        proxy: { useApifyProxy: true },
      }),
    });
    if (!res.ok) {
      console.error("Twitch scraper error:", res.status);
      return [];
    }
    return await res.json();
  } catch (e) {
    console.error("Twitch scrape failed:", e);
    return [];
  }
}

async function scrapeInstagram(keywords: string[], limit: number): Promise<any[]> {
  try {
    const actorId = "apify~instagram-hashtag-scraper";
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;
    const hashtags = keywords
      .filter((k) => k.startsWith("#"))
      .map((k) => k.replace("#", ""))
      .slice(0, 5);
    if (hashtags.length === 0) hashtags.push("cassino", "slots", "apostas");

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hashtags,
        resultsLimit: limit,
      }),
    });
    if (!res.ok) {
      console.error("Instagram scraper error:", res.status);
      return [];
    }
    return await res.json();
  } catch (e) {
    console.error("Instagram scrape failed:", e);
    return [];
  }
}

// ─── Match Score (generic — no niche bias) ──────────────────────────────
const CASINO_KEYWORDS = ["casino", "cassino", "slot", "slots", "bet", "aposta", "apostas", "gambling", "igaming", "roleta", "blackjack", "poker", "tigrinho", "fortune"];
// Heuristic gender hints from bios/names (declarative only — never assumed)
const FEMALE_HINTS = ["ela/dela", "she/her", "♀", "mulher", "menina", "garota", "girl", "miss", "queen", "rainha"];
const MALE_HINTS = ["ele/dele", "he/him", "♂", "homem", "menino", "garoto", "boy", "king", "rei", "mister"];

function inferGender(profile: any): "female" | "male" | "unknown" {
  const text = `${profile.bio || ""} ${profile.display_name || ""}`.toLowerCase();
  if (FEMALE_HINTS.some((h) => text.includes(h))) return "female";
  if (MALE_HINTS.some((h) => text.includes(h))) return "male";
  return "unknown";
}

function calculateMatchScore(profile: any, filters: any): { score: number; breakdown: any } {
  // Location: matches any user-provided location keyword (case-insensitive substring)
  let locationScore = 0;
  const loc = (profile.location_declared || profile.location_inferred || "").toLowerCase();
  const wantedLocs: string[] = (filters?.target_locations || []).map((l: string) => l.toLowerCase()).filter(Boolean);
  if (wantedLocs.length === 0) {
    locationScore = 15; // neutral when no location filter
  } else if (wantedLocs.some((l) => loc.includes(l))) {
    locationScore = 30;
  }

  // Followers: respects user-provided min/max range
  const followers = profile.followers || 0;
  const minF = Number(filters?.min_followers) || 0;
  const maxF = Number(filters?.max_followers) || 0;
  let followersScore = 0;
  const inMin = minF === 0 || followers >= minF;
  const inMax = maxF === 0 || followers <= maxF;
  if (inMin && inMax) followersScore = 30;
  else if (followers >= Math.max(1000, minF * 0.5)) followersScore = 15;

  // Frequency: posting/streaming activity
  let frequencyScore = 0;
  const activity = (profile.posts_last_30d || 0) + (profile.lives_last_30d || 0);
  if (activity >= 12) frequencyScore = 20;
  else if (activity >= 6) frequencyScore = 10;
  else if (activity > 0) frequencyScore = 5;

  // Content: matches user-provided keywords (any niche, not just casino)
  const bio = (profile.bio || "").toLowerCase();
  const name = (profile.display_name || "").toLowerCase();
  const combined = `${bio} ${name}`;
  const indicators: string[] = (filters?.content_indicators || []).map((k: string) => String(k).toLowerCase().replace(/^#/, "")).filter(Boolean);
  let contentScore = 0;
  if (indicators.length === 0) {
    contentScore = 10; // neutral when no keyword filter
  } else if (indicators.some((kw) => combined.includes(kw))) {
    contentScore = 20;
  }
  // Track casino content as a tag (not as scoring bias)
  if (CASINO_KEYWORDS.some((kw) => combined.includes(kw))) {
    profile.has_casino_content = true;
  }

  // Gender filter (soft — penalises only when user picked a specific gender)
  const wantedGender: string = filters?.target_gender || "any";
  if (wantedGender !== "any") {
    const inferred = inferGender(profile);
    profile.gender_inferred = inferred;
    if (inferred !== "unknown" && inferred !== wantedGender) {
      // Hard mismatch — drop score significantly
      return {
        score: Math.max(0, locationScore + followersScore + frequencyScore + contentScore - 40),
        breakdown: { location: locationScore, followers: followersScore, frequency: frequencyScore, content: contentScore },
      };
    }
  }

  const score = locationScore + followersScore + frequencyScore + contentScore;
  return {
    score,
    breakdown: {
      location: locationScore,
      followers: followersScore,
      frequency: frequencyScore,
      content: contentScore,
    },
  };
}

// ─── Spam Validation ────────────────────────────────────────────────────
function validateSpam(profile: any): boolean {
  const ratio = profile.follower_following_ratio || 0;
  if (ratio > 0 && ratio < 0.1) return true; // way more following than followers
  if ((profile.followers || 0) > 100000 && (profile.avg_views || 0) < 100) return true;
  return false;
}

// ─── Normalize Profiles ────────────────────────────────────────────────
function normalizeTwitchProfile(raw: any): any {
  return {
    platform: "twitch",
    username: raw.login || raw.name || raw.displayName || "",
    display_name: raw.displayName || raw.name || raw.login || "",
    bio: raw.description || raw.bio || "",
    avatar_url: raw.profileImageURL || raw.profileImageUrl || raw.thumbnailUrl || "",
    profile_url: `https://twitch.tv/${raw.login || raw.name || ""}`,
    followers: raw.followers || raw.followersCount || 0,
    avg_views: raw.averageViewers || raw.viewCount || 0,
    posts_last_30d: 0,
    lives_last_30d: raw.recentBroadcasts?.length || 0,
    location_declared: raw.location || "",
    location_inferred: raw.language === "pt" || raw.broadcasterLanguage === "pt" ? "Brasil" : "",
    follower_following_ratio: 1,
  };
}

function normalizeInstagramProfile(raw: any): any {
  const following = raw.followingCount || raw.followsCount || 1;
  const followers = raw.followersCount || raw.likesCount || 0;
  return {
    platform: "instagram",
    username: raw.ownerUsername || raw.username || "",
    display_name: raw.ownerFullName || raw.fullName || raw.ownerUsername || "",
    bio: raw.biography || raw.caption || "",
    avatar_url: raw.profilePicUrl || "",
    profile_url: `https://instagram.com/${raw.ownerUsername || raw.username || ""}`,
    followers,
    avg_views: raw.videoViewCount || raw.videoPlayCount || 0,
    posts_last_30d: raw.postsCount ? Math.min(raw.postsCount, 30) : 0,
    lives_last_30d: 0,
    location_declared: raw.locationName || "",
    location_inferred: "",
    follower_following_ratio: following > 0 ? followers / following : 0,
  };
}

// ─── Main Handler ──────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      action,
      briefing,
      platforms,
      limit,
      custom_keywords,
      manual_filters,
      use_ai_expansion,
    } = await req.json();
    const maxResults = Math.min(limit || 50, 100);

    if (action === "discover") {
      let keywords: string[];
      let filters: any;

      const hasCustomKws = Array.isArray(custom_keywords) && custom_keywords.length > 0;
      const hasBriefing = typeof briefing === "string" && briefing.trim().length > 0;
      // AI expansion runs only when explicitly requested AND briefing exists AND no manual keywords
      const shouldExpand = use_ai_expansion === true && hasBriefing && !hasCustomKws;

      if (shouldExpand) {
        console.log("[Discovery] Expanding briefing with AI...");
        const expanded = await expandBriefing(briefing);
        keywords = expanded.keywords;
        filters = expanded.filters;
      } else {
        const kws = hasCustomKws
          ? custom_keywords.map((k: string) => String(k).trim()).filter(Boolean)
          : [];
        const twitchKws = kws.filter((k: string) => !k.startsWith("#"));
        const igKws = kws.filter((k: string) => k.startsWith("#"));
        keywords = kws;
        filters = {
          keywords_twitch: twitchKws.length > 0 ? twitchKws : kws,
          keywords_instagram: igKws.length > 0 ? igKws : kws.map((k: string) => `#${k.replace(/\s+/g, "")}`),
          content_indicators: kws,
        };
        console.log("[Discovery] Using custom/empty keywords:", keywords);
      }

      // Merge manual filters from the UI on top — these always win
      if (manual_filters && typeof manual_filters === "object") {
        filters = {
          ...filters,
          target_locations: manual_filters.locations || [],
          target_gender: manual_filters.gender || "any",
          min_age: Number(manual_filters.min_age) || 0,
          max_age: Number(manual_filters.max_age) || 0,
          min_followers: Number(manual_filters.min_followers) || Number(filters.min_followers) || 0,
          max_followers: Number(manual_filters.max_followers) || 0,
        };
      }
      console.log("[Discovery] Final filters:", JSON.stringify(filters));

      // Need at least one of: keywords, briefing, or location filter to scrape
      if (keywords.length === 0 && !hasBriefing && (!filters.target_locations || filters.target_locations.length === 0)) {
        return new Response(JSON.stringify({ error: "Provide at least one search term, briefing, or filter" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // If no scraping keywords, fall back to location terms so Apify has something to query
      if (keywords.length === 0) {
        const fallback = (filters.target_locations || []).slice(0, 3);
        keywords = fallback.length > 0 ? fallback : ["brasil"];
        filters.keywords_twitch = keywords;
        filters.keywords_instagram = keywords.map((k: string) => `#${k.replace(/\s+/g, "").toLowerCase()}`);
      }

      const selectedPlatforms = platforms || ["twitch", "instagram"];
      const allProfiles: any[] = [];

      // Scrape platforms in parallel
      const promises: Promise<void>[] = [];

      if (selectedPlatforms.includes("twitch")) {
        promises.push(
          scrapeTwitch(filters.keywords_twitch || keywords, maxResults).then((results) => {
            for (const r of results) {
              allProfiles.push(normalizeTwitchProfile(r));
            }
          })
        );
      }

      if (selectedPlatforms.includes("instagram")) {
        promises.push(
          scrapeInstagram(filters.keywords_instagram || keywords, maxResults).then((results) => {
            // Deduplicate by username
            const seen = new Set<string>();
            for (const r of results) {
              const profile = normalizeInstagramProfile(r);
              if (profile.username && !seen.has(profile.username)) {
                seen.add(profile.username);
                allProfiles.push(profile);
              }
            }
          })
        );
      }

      await Promise.all(promises);
      console.log(`[Discovery] Scraped ${allProfiles.length} profiles total`);

      // Score and filter
      const briefingId = crypto.randomUUID();
      const scored = allProfiles.map((p) => {
        const { score, breakdown } = calculateMatchScore(p, filters);
        const isSpam = validateSpam(p);
        return {
          ...p,
          briefing_id: briefingId,
          match_score: score,
          score_breakdown: breakdown,
          is_spam: isSpam,
          briefing_text: briefing,
          search_keywords: keywords,
        };
      });

      // Sort all profiles by score, mark qualified vs low score
      let allScored = scored
        .filter((p) => !p.is_spam)
        .sort((a, b) => b.match_score - a.match_score);

      // SullyGnome validation for top Twitch prospects (regardless of qualification)
      const twitchProspects = allScored.filter((p) => p.platform === "twitch").slice(0, 5);
      if (twitchProspects.length > 0 && APIFY_API_KEY) {
        console.log(`[Discovery] Validating ${twitchProspects.length} Twitch prospects via SullyGnome...`);
        for (const prospect of twitchProspects) {
          try {
            const sullyData = await fetchSullyGnomeQuick(prospect.username);
            if (sullyData) {
              prospect.sullygnome_data = sullyData;
              if (sullyData.casinoPercentage > 10) {
                prospect.match_score = Math.min(100, prospect.match_score + 5);
                prospect.score_breakdown.content = Math.min(20, (prospect.score_breakdown.content || 0) + 5);
              }
              if (sullyData.totalStreamMinutes < 600) {
                prospect.match_score = Math.max(0, prospect.match_score - 10);
                prospect.score_breakdown.frequency = Math.max(0, (prospect.score_breakdown.frequency || 0) - 5);
              }
            }
          } catch (e: any) {
            console.warn(`[Discovery] SullyGnome validation failed for ${prospect.username}:`, e.message);
          }
        }
        // Re-sort after score adjustments
        allScored = allScored.sort((a, b) => b.match_score - a.match_score);
      }

      const qualified = allScored.filter((p) => p.match_score >= 70);

      // Save ALL non-spam profiles to database (with qualification status implicit in score)
      if (allScored.length > 0) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const dbRecords = allScored.map(({ sullygnome_data, ...rest }) => rest);
        const { error } = await supabase.from("discovery_prospects").insert(dbRecords);
        if (error) console.error("[Discovery] DB insert error:", error.message);
      }

      return new Response(
        JSON.stringify({
          briefing_id: briefingId,
          keywords,
          filters,
          total_scraped: allProfiles.length,
          total_qualified: qualified.length,
          total_spam: scored.filter((p) => p.is_spam).length,
          total_low_score: allScored.filter((p) => p.match_score < 70).length,
          prospects: allScored, // return ALL non-spam profiles
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: list past searches
    if (action === "list") {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await supabase
        .from("discovery_prospects")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ prospects: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[Discovery] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── SullyGnome Quick Validation ───────────────────────────────────────
async function fetchSullyGnomeQuick(streamerLogin: string): Promise<any | null> {
  try {
    const actorId = "apify~web-scraper";
    const apiUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=60`;

    const pageFunction = `
      async function pageFunction(context) {
        const { $ } = context;
        const gameStats = [];
        $('#tblData tbody tr').each((i, el) => {
          gameStats.push({
            category: $(el).find('td:nth-child(2)').text().trim(),
            streamTime: $(el).find('td:nth-child(3)').text().trim(),
            percentage: $(el).find('td:nth-child(8)').text().trim()
          });
        });
        return { gameStats };
      }
    `;

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: `https://sullygnome.com/channel/${streamerLogin}/30/games` }],
        pageFunction,
        proxyConfiguration: { useApifyProxy: true },
        maxRequestsPerCrawl: 1,
        maxConcurrency: 1,
      }),
    });

    if (!res.ok) return null;
    const items = await res.json();
    const stats = items?.[0]?.gameStats || [];
    if (stats.length === 0) return null;

    const casinoKw = ["virtual casino", "slots", "casino", "gambling"];
    let totalMin = 0;
    let casinoMin = 0;
    for (const g of stats) {
      const mins = parseTime(g.streamTime || "0");
      totalMin += mins;
      if (casinoKw.some((k) => (g.category || "").toLowerCase().includes(k))) casinoMin += mins;
    }

    return {
      totalStreamMinutes: totalMin,
      casinoStreamMinutes: casinoMin,
      casinoPercentage: totalMin > 0 ? Math.round((casinoMin / totalMin) * 100) : 0,
    };
  } catch {
    return null;
  }
}

function parseTime(raw: string): number {
  let t = 0;
  const d = raw.match(/(\d+)d/);
  const h = raw.match(/(\d+)h/);
  const m = raw.match(/(\d+)m/);
  if (d) t += parseInt(d[1]) * 1440;
  if (h) t += parseInt(h[1]) * 60;
  if (m) t += parseInt(m[1]);
  if (!d && !h && !m) { const n = parseInt(raw.replace(/,/g, ""), 10); if (!isNaN(n)) t = n * 60; }
  return t;
}
