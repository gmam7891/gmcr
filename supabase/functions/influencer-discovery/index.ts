import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// ═══════════════════════════════════════════════════════════════════════
//  INSTAGRAM — NEW SEED-BASED DISCOVERY
// ═══════════════════════════════════════════════════════════════════════

const MAX_PROFILES_PER_SEARCH = 30; // hard cap to control Apify cost

/** Parse a profile URL or @handle into a clean username. */
function parseInstagramUsername(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@/, "");
  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (u.hostname.toLowerCase().includes("instagram.com")) {
      const path = u.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "";
      return path || null;
    }
  } catch {
    // bare username — valid if it looks right
    if (/^[A-Za-z0-9._]+$/.test(trimmed)) return trimmed;
  }
  return null;
}

/** Full scrape of an Instagram profile using Apify's instagram-profile-scraper.
 *  Returns enriched data including followers, bio, post count, recent posts. */
async function scrapeInstagramProfile(username: string): Promise<any | null> {
  try {
    const url = `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=90`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username] }),
    });
    if (!res.ok) {
      console.warn(`[IG] scrape ${username} failed: ${res.status}`);
      return null;
    }
    const items = await res.json();
    return items?.[0] || null;
  } catch (e: any) {
    console.warn(`[IG] scrape ${username} error:`, e.message);
    return null;
  }
}

/** Batch version — scrapes up to 10 profiles in a single Apify run.
 *  Much cheaper than N individual calls. */
async function scrapeInstagramProfilesBatch(usernames: string[]): Promise<any[]> {
  if (usernames.length === 0) return [];
  try {
    const url = `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=180`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: usernames.slice(0, 30) }),
    });
    if (!res.ok) {
      console.warn(`[IG] batch scrape failed: ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (e: any) {
    console.warn(`[IG] batch scrape error:`, e.message);
    return [];
  }
}

/** Normalize a raw Apify profile object into our canonical shape.
 *  Uses REAL fields from the profile scraper — not hashtag scraper fallbacks. */
function normalizeProfile(raw: any): any {
  if (!raw || !raw.username) return null;
  const followers = Number(raw.followersCount || 0);
  const following = Number(raw.followsCount || raw.followingCount || 0);
  const postsCount = Number(raw.postsCount || 0);

  // Engagement rate: average likes+comments across the last few posts ÷ followers
  let avgInteractions = 0;
  let avgViews = 0;
  const recentPosts = Array.isArray(raw.latestPosts) ? raw.latestPosts.slice(0, 12) : [];
  if (recentPosts.length > 0) {
    let totalInter = 0;
    let totalViews = 0;
    for (const p of recentPosts) {
      totalInter += (Number(p.likesCount || 0) + Number(p.commentsCount || 0));
      totalViews += Number(p.videoViewCount || p.videoPlayCount || 0);
    }
    avgInteractions = Math.round(totalInter / recentPosts.length);
    avgViews = Math.round(totalViews / recentPosts.length);
  }
  const engagementRate = followers > 0 ? Number(((avgInteractions / followers) * 100).toFixed(2)) : 0;

  // Posts in last 30d: count posts whose timestamp is within 30 days
  let postsLast30d = 0;
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  for (const p of recentPosts) {
    const ts = new Date(p.timestamp || p.takenAtTimestamp * 1000 || 0).getTime();
    if (ts >= cutoff) postsLast30d++;
  }

  return {
    platform: "instagram",
    username: raw.username,
    display_name: raw.fullName || raw.username,
    bio: raw.biography || "",
    avatar_url: raw.profilePicUrl || raw.profilePicUrlHD || "",
    profile_url: `https://instagram.com/${raw.username}`,
    followers,
    following,
    posts_count: postsCount,
    avg_views: avgViews,
    avg_interactions: avgInteractions,
    engagement_rate: engagementRate,
    posts_last_30d: postsLast30d,
    lives_last_30d: 0,
    location_declared: raw.locationName || "",
    is_verified: !!raw.verified,
    is_private: !!raw.private,
    external_url: raw.externalUrl || "",
    recent_post_captions: recentPosts.slice(0, 5).map((p: any) => String(p.caption || "").slice(0, 280)).filter(Boolean),
    _raw_following_list: Array.isArray(raw.followings) ? raw.followings : [],
  };
}

/** Extract candidate usernames from a reference profile's "following" list.
 *  Apify's profile scraper does not return followings by default — we need
 *  a secondary actor. This function uses instagram-followers-scraper for that. */
async function getFollowingList(username: string, limit = 60): Promise<string[]> {
  try {
    // Use the dedicated followers/following scraper
    const url = `https://api.apify.com/v2/acts/apify~instagram-follower-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=90`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [username],
        resultsType: "following",
        resultsLimit: limit,
      }),
    });
    if (!res.ok) {
      console.warn(`[IG] following list failed for ${username}: ${res.status}`);
      return [];
    }
    const items = await res.json();
    // The actor returns objects like { username: "..." } for each followed account
    return items
      .map((i: any) => i.username || i.handle || "")
      .filter((u: string) => !!u && /^[A-Za-z0-9._]+$/.test(u))
      .slice(0, limit);
  } catch (e: any) {
    console.warn(`[IG] following list error for ${username}:`, e.message);
    return [];
  }
}

/** Qualify a profile against the briefing using Gemini.
 *  Returns { match: boolean, confidence: 0-1, reason: string } */
async function qualifyProfile(profile: any, briefing: string, filters: any): Promise<{ match: boolean; confidence: number; reason: string }> {
  if (!LOVABLE_API_KEY || !briefing?.trim()) {
    return { match: true, confidence: 0.5, reason: "no-briefing-fallback" };
  }

  const profileSummary = [
    `Username: @${profile.username}`,
    `Nome: ${profile.display_name}`,
    `Bio: ${profile.bio || "(vazia)"}`,
    `Seguidores: ${profile.followers}`,
    `Posts recentes: ${profile.posts_last_30d} nos últimos 30 dias`,
    `Verificado: ${profile.is_verified ? "sim" : "não"}`,
    profile.recent_post_captions?.length ? `Legendas recentes:\n${profile.recent_post_captions.slice(0, 3).map((c: string) => `- ${c}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const systemPrompt = `Você é um analista de descoberta de influenciadores para campanhas de marketing.
Dado o BRIEFING e os FILTROS do usuário, avalie se o PERFIL abaixo é um bom match.

Responda APENAS com um objeto JSON no formato:
{
  "match": true | false,
  "confidence": 0.0 a 1.0,
  "reason": "explicação curta em pt-BR (máx 15 palavras)"
}

Critérios:
- O perfil tem o NICHO/TEMA descrito no briefing? (analise bio + legendas, não só palavras-chave)
- O tamanho de audiência está adequado?
- O perfil parece ATIVO e REAL (não bot, não abandonado)?
- Bate com os filtros de gênero/localização se informados?

Seja rigoroso. Prefira rejeitar do que aceitar perfil duvidoso.`;

  const userPrompt = `BRIEFING:\n${briefing}\n\nFILTROS:\n${JSON.stringify({
    locations: filters?.target_locations || [],
    gender: filters?.target_gender || "any",
    min_followers: filters?.min_followers || 0,
    max_followers: filters?.max_followers || 0,
  })}\n\nPERFIL:\n${profileSummary}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { match: true, confidence: 0.3, reason: "ai-error-fallback" };
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    return {
      match: !!parsed.match,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: String(parsed.reason || ""),
    };
  } catch (e: any) {
    console.warn("[IG] qualify error:", e.message);
    return { match: true, confidence: 0.3, reason: "ai-parse-error" };
  }
}

/** Apply hard filters before sending to AI (cheap pre-filter). */
function passesHardFilters(profile: any, filters: any): boolean {
  // Private profiles are useless for campaigns
  if (profile.is_private) return false;

  // Followers range
  const minF = Number(filters?.min_followers) || 0;
  const maxF = Number(filters?.max_followers) || 0;
  if (minF > 0 && profile.followers < minF) return false;
  if (maxF > 0 && profile.followers > maxF) return false;

  // Minimum engagement rate
  const minEng = Number(filters?.min_engagement) || 0;
  if (minEng > 0 && profile.engagement_rate < minEng) return false;

  // Activity: profile must have posted something in last 30 days
  if (profile.posts_last_30d === 0 && profile.followers < 100_000) return false;

  // Followers/following sanity check — exclude obvious spam/bot accounts
  if (profile.followers > 0 && profile.following > 0) {
    const ratio = profile.followers / profile.following;
    // Spam pattern: follows thousands, has nobody following back
    if (profile.following > 3000 && ratio < 0.1) return false;
  }

  return true;
}

/** Location match (declared field only — we do not infer). */
function locationMatches(profile: any, wantedLocs: string[]): boolean {
  if (wantedLocs.length === 0) return true;
  const loc = (profile.location_declared || "").toLowerCase();
  const bio = (profile.bio || "").toLowerCase();
  return wantedLocs.some(l => {
    const needle = l.toLowerCase();
    return loc.includes(needle) || bio.includes(needle);
  });
}

/** Firecrawl fallback: when no reference profile, derive candidate usernames from
 *  briefing + filters by searching Google for `site:instagram.com "<keyword>"`. */
async function discoverCandidatesViaFirecrawl(keywords: string[], limit = 40): Promise<string[]> {
  if (!FIRECRAWL_API_KEY || keywords.length === 0) return [];
  const usernames = new Set<string>();
  for (const kw of keywords.slice(0, 4)) {
    if (usernames.size >= limit) break;
    const cleanKw = kw.replace(/^#/, "").trim();
    if (!cleanKw) continue;
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: `site:instagram.com "${cleanKw}"`, limit: 15 }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const results = json?.data?.web || json?.data || [];
      for (const r of results) {
        const url: string = r.url || "";
        const m = url.match(/instagram\.com\/([A-Za-z0-9._]+)\/?$/);
        if (!m) continue;
        const u = m[1];
        if (["p", "reel", "explore", "directory", "tv", "stories"].includes(u.toLowerCase())) continue;
        usernames.add(u);
        if (usernames.size >= limit) break;
      }
    } catch (e: any) {
      console.warn(`[Firecrawl] error:`, e.message);
    }
  }
  return Array.from(usernames);
}

/** MAIN ROUTINE — Instagram seed-based discovery */
async function runInstagramDiscovery(params: {
  briefing: string;
  reference_urls: string[];
  manual_filters: any;
  custom_keywords: string[];
}): Promise<{ prospects: any[]; stats: any; error?: string }> {
  const { briefing, reference_urls, manual_filters, custom_keywords } = params;

  const filters = {
    target_locations: manual_filters?.locations || [],
    target_gender: manual_filters?.gender || "any",
    min_followers: Number(manual_filters?.min_followers) || 0,
    max_followers: Number(manual_filters?.max_followers) || 0,
    min_engagement: Number(manual_filters?.min_engagement) || 0,
  };

  const hasBriefing = typeof briefing === "string" && briefing.trim().length > 0;
  const refUsernames = (reference_urls || [])
    .map(parseInstagramUsername)
    .filter((u): u is string => !!u);

  // ─── PATH A: reference-based ─────────────────────────────────────────
  let candidateUsernames: string[] = [];
  const errorsDuringSeed: string[] = [];

  if (refUsernames.length > 0) {
    console.log(`[IG] Seed mode — references: ${refUsernames.join(", ")}`);

    // 1. Scrape each reference profile (full data)
    const seedProfiles = await scrapeInstagramProfilesBatch(refUsernames);
    for (const rawSeed of seedProfiles) {
      const seed = normalizeProfile(rawSeed);
      if (!seed) continue;
      if (seed.is_private) {
        errorsDuringSeed.push(`Perfil @${seed.username} é privado e não pode ser usado como referência.`);
        continue;
      }
      // 2. Get the accounts this seed follows
      const following = await getFollowingList(seed.username, 60);
      console.log(`[IG] @${seed.username} follows ${following.length} accounts`);
      candidateUsernames.push(...following);
    }

    // Deduplicate and drop the references themselves
    candidateUsernames = [...new Set(candidateUsernames)].filter(u => !refUsernames.includes(u));

    if (candidateUsernames.length === 0 && errorsDuringSeed.length > 0) {
      return { prospects: [], stats: {}, error: errorsDuringSeed.join(" ") };
    }
  }

  // ─── PATH B: briefing-based fallback (no reference) ─────────────────
  if (candidateUsernames.length === 0) {
    console.log(`[IG] Fallback mode — discovering via briefing + keywords`);
    const keywords = [
      ...(custom_keywords || []).map(String).filter(Boolean),
      ...(filters.target_locations || []),
    ];
    if (hasBriefing) {
      // Extract keywords from briefing via AI
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: "Extraia 4-6 palavras-chave de busca (pt-BR) do briefing. Retorne APENAS JSON: { \"keywords\": [\"...\"] }" },
              { role: "user", content: briefing.slice(0, 800) },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
          if (Array.isArray(parsed.keywords)) keywords.push(...parsed.keywords.map(String));
        }
      } catch {/* ignore */}
    }

    const uniqueKeywords = [...new Set(keywords)].slice(0, 6);
    if (uniqueKeywords.length === 0) {
      return { prospects: [], stats: {}, error: "Forneça uma referência, briefing, palavras-chave ou localização." };
    }
    candidateUsernames = await discoverCandidatesViaFirecrawl(uniqueKeywords, MAX_PROFILES_PER_SEARCH * 2);
  }

  // Cap before the expensive enrichment step
  candidateUsernames = candidateUsernames.slice(0, MAX_PROFILES_PER_SEARCH);
  console.log(`[IG] Enriching ${candidateUsernames.length} candidates`);

  if (candidateUsernames.length === 0) {
    return { prospects: [], stats: {}, error: "Nenhum candidato encontrado com os critérios fornecidos." };
  }

  // ─── ENRICHMENT — full scrape of each candidate ─────────────────────
  const rawProfiles = await scrapeInstagramProfilesBatch(candidateUsernames);
  const enriched = rawProfiles.map(normalizeProfile).filter((p): p is any => p !== null);
  console.log(`[IG] Enriched ${enriched.length} profiles successfully`);

  // ─── HARD FILTERS ───────────────────────────────────────────────────
  let filtered = enriched.filter(p => passesHardFilters(p, filters));
  const droppedByHardFilter = enriched.length - filtered.length;
  console.log(`[IG] Hard filters dropped ${droppedByHardFilter}, ${filtered.length} remain`);

  // ─── LOCATION FILTER ────────────────────────────────────────────────
  const wantedLocs = (filters.target_locations || []).filter((l: string) => l);
  if (wantedLocs.length > 0) {
    const before = filtered.length;
    filtered = filtered.filter(p => locationMatches(p, wantedLocs));
    console.log(`[IG] Location filter dropped ${before - filtered.length}`);
  }

  // ─── AI QUALIFICATION (only if briefing exists) ─────────────────────
  const qualified: any[] = [];
  if (hasBriefing) {
    // Run qualifications in parallel batches of 5 to control concurrency
    const BATCH = 5;
    for (let i = 0; i < filtered.length; i += BATCH) {
      const chunk = filtered.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(p => qualifyProfile(p, briefing, filters)));
      for (let j = 0; j < chunk.length; j++) {
        const p = chunk[j];
        const q = results[j];
        p.ai_qualification = q;
        p.match_score = Math.round(q.confidence * 100);
        if (q.match) qualified.push(p);
      }
    }
  } else {
    // No briefing — everything that passed hard filters is "qualified"
    for (const p of filtered) {
      p.ai_qualification = { match: true, confidence: 0.5, reason: "no-briefing" };
      p.match_score = 50;
      qualified.push(p);
    }
  }

  // ─── FINAL RANKING ──────────────────────────────────────────────────
  qualified.sort((a, b) => {
    if (b.match_score !== a.match_score) return b.match_score - a.match_score;
    if (b.engagement_rate !== a.engagement_rate) return b.engagement_rate - a.engagement_rate;
    return b.followers - a.followers;
  });

  return {
    prospects: qualified,
    stats: {
      total_candidates: candidateUsernames.length,
      total_enriched: enriched.length,
      dropped_by_hard_filter: droppedByHardFilter,
      dropped_by_location: wantedLocs.length > 0 ? filtered.length - qualified.length : 0,
      qualified: qualified.length,
      used_path: refUsernames.length > 0 ? "reference" : "briefing",
      errors: errorsDuringSeed.length > 0 ? errorsDuringSeed : undefined,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      action,
      briefing,
      platforms,
      custom_keywords,
      manual_filters,
      reference_url,       // legacy — single URL
      reference_urls,      // new — array of URLs
    } = body;

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

    if (action !== "discover") {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize reference input — accept either single or array
    const refUrls: string[] = Array.isArray(reference_urls)
      ? reference_urls.filter(Boolean)
      : (reference_url ? [reference_url] : []);

    const selectedPlatforms: string[] = platforms || ["instagram"];
    const briefingId = crypto.randomUUID();

    // ─── INSTAGRAM (new seed-based flow) ──────────────────────────────
    if (selectedPlatforms.includes("instagram")) {
      const result = await runInstagramDiscovery({
        briefing: briefing || "",
        reference_urls: refUrls,
        manual_filters: manual_filters || {},
        custom_keywords: custom_keywords || [],
      });

      if (result.error && result.prospects.length === 0) {
        return new Response(
          JSON.stringify({ error: result.error, stats: result.stats }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Tag each prospect with the briefing id and save
      const prospects = result.prospects.map(p => ({
        ...p,
        briefing_id: briefingId,
        briefing_text: briefing || "",
        search_keywords: custom_keywords || [],
      }));

      if (prospects.length > 0) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const dbRecords = prospects.map(({ _raw_following_list, ai_qualification, ...rest }) => ({
          ...rest,
          score_breakdown: ai_qualification || null,
        }));
        const { error } = await supabase.from("discovery_prospects").insert(dbRecords);
        if (error) console.error("[IG] DB insert error:", error.message);
      }

      return new Response(
        JSON.stringify({
          briefing_id: briefingId,
          total_scraped: result.stats.total_enriched || 0,
          total_qualified: result.stats.qualified || 0,
          total_spam: result.stats.dropped_by_hard_filter || 0,
          total_low_score: 0,
          stats: result.stats,
          prospects,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── TWITCH — falls back to "not implemented" in this version ────
    // The previous Twitch logic should remain if it already works; otherwise
    // return a helpful message.
    return new Response(
      JSON.stringify({
        error: "Twitch discovery está sendo migrada. Use Instagram por enquanto.",
        briefing_id: briefingId,
        prospects: [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[Discovery] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
