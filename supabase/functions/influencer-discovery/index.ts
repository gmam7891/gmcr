import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY") || Deno.env.get("APIFY_API_TOKEN") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// ═══════════════════════════════════════════════════════════════════════
//  CONFIG — Cost & quality knobs
// ═══════════════════════════════════════════════════════════════════════

const MAX_CANDIDATES = 30;        // Layer 1: cheap scrape this many
const MAX_RICH_ENRICHMENTS = 15;  // Layer 2: rich enrichment only on the top 15 survivors
const FOLLOWING_FETCH_PER_REF = 60; // How many "followings" to pull per reference profile

// ═══════════════════════════════════════════════════════════════════════
//  APIFY HELPERS
// ═══════════════════════════════════════════════════════════════════════

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
    if (/^[A-Za-z0-9._]+$/.test(trimmed)) return trimmed;
  }
  return null;
}

async function callApify(actorId: string, input: Record<string, unknown>, timeoutSec = 120): Promise<any> {
  if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY not configured");
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=${timeoutSec}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Apify ${actorId} failed [${res.status}]: ${errText.slice(0, 200)}`);
  }
  return await res.json();
}

// Stats helpers (replicated from instagram-profile to keep the function self-contained)
function calculateMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function filterOutliers(data: number[]): number[] {
  if (data.length < 4) return data;
  const sorted = [...data].sort((a, b) => a - b);
  const q1 = calculateMedian(sorted.slice(0, Math.floor(sorted.length / 2)));
  const q3 = calculateMedian(sorted.slice(Math.ceil(sorted.length / 2)));
  const iqr = q3 - q1;
  return data.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
}

// ═══════════════════════════════════════════════════════════════════════
//  LAYER 1 — Cheap profile scrape (basic data for hard filtering)
// ═══════════════════════════════════════════════════════════════════════

interface BasicProfile {
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  profile_url: string;
  followers: number;
  following: number;
  posts_count: number;
  posts_last_30d: number;
  is_verified: boolean;
  is_private: boolean;
  location_declared: string;
  recent_post_captions: string[];
}

function normalizeBasic(raw: any): BasicProfile | null {
  if (!raw || !raw.username) return null;
  const recentPosts = Array.isArray(raw.latestPosts) ? raw.latestPosts.slice(0, 12) : [];
  let postsLast30d = 0;
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  for (const p of recentPosts) {
    const ts = new Date(p.timestamp || (p.takenAtTimestamp ? p.takenAtTimestamp * 1000 : 0)).getTime();
    if (ts >= cutoff) postsLast30d++;
  }
  return {
    username: raw.username,
    display_name: raw.fullName || raw.username,
    bio: raw.biography || "",
    avatar_url: raw.profilePicUrl || raw.profilePicUrlHD || "",
    profile_url: `https://instagram.com/${raw.username}`,
    followers: Number(raw.followersCount || 0),
    following: Number(raw.followsCount || raw.followingCount || 0),
    posts_count: Number(raw.postsCount || 0),
    posts_last_30d: postsLast30d,
    is_verified: !!raw.verified,
    is_private: !!raw.private,
    location_declared: raw.locationName || "",
    recent_post_captions: recentPosts.slice(0, 5)
      .map((p: any) => String(p.caption || "").slice(0, 280))
      .filter(Boolean),
  };
}

async function layer1Scrape(usernames: string[]): Promise<BasicProfile[]> {
  if (usernames.length === 0) return [];
  try {
    const items = await callApify("apify~instagram-profile-scraper", {
      usernames: usernames.slice(0, MAX_CANDIDATES),
    }, 180);
    return items.map(normalizeBasic).filter((p: BasicProfile | null): p is BasicProfile => p !== null);
  } catch (e: any) {
    console.warn(`[L1] batch scrape error:`, e.message);
    return [];
  }
}

async function getFollowingList(username: string, limit = FOLLOWING_FETCH_PER_REF): Promise<string[]> {
  try {
    const items = await callApify("apify~instagram-follower-scraper", {
      usernames: [username],
      resultsType: "following",
      resultsLimit: limit,
    }, 90);
    return items
      .map((i: any) => i.username || i.handle || "")
      .filter((u: string) => !!u && /^[A-Za-z0-9._]+$/.test(u))
      .slice(0, limit);
  } catch (e: any) {
    console.warn(`[seed] following list failed for ${username}:`, e.message);
    return [];
  }
}

function passesHardFilters(p: BasicProfile, filters: any): boolean {
  if (p.is_private) return false;
  const minF = Number(filters?.min_followers) || 0;
  const maxF = Number(filters?.max_followers) || 0;
  if (minF > 0 && p.followers < minF) return false;
  if (maxF > 0 && p.followers > maxF) return false;
  // Activity check (only for smaller profiles — big accounts may post less often)
  if (p.posts_last_30d === 0 && p.followers < 100_000) return false;
  // Bot-like ratio
  if (p.following > 3000 && p.followers > 0 && (p.followers / p.following) < 0.1) return false;
  return true;
}

function locationMatches(p: BasicProfile, wantedLocs: string[]): boolean {
  if (wantedLocs.length === 0) return true;
  const loc = p.location_declared.toLowerCase();
  const bio = p.bio.toLowerCase();
  return wantedLocs.some(l => {
    const needle = l.toLowerCase();
    return loc.includes(needle) || bio.includes(needle);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  LAYER 2 — Rich enrichment via the existing instagram-profile function
// ═══════════════════════════════════════════════════════════════════════

interface RichProfile extends BasicProfile {
  median_engagement: number;
  median_views: number;
  engagement_rate: number;          // %
  stories_view_estimate: number;
  estimated_ctr: number;            // %
  sample_size: number;              // posts analyzed
  latest_posts: Array<{ likes: number; comments: number; views: number; type: string }>;
}

async function layer2EnrichOne(username: string): Promise<RichProfile | null> {
  try {
    // Reuse the existing instagram-profile edge function — guarantees identical
    // analytics to what the Instagram tab shows for the same user.
    const url = `${SUPABASE_URL}/functions/v1/instagram-profile`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ username }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.username) return null;

    return {
      username: data.username,
      display_name: data.fullName || data.username,
      bio: data.biography || "",
      avatar_url: data.profilePicUrl || "",
      profile_url: `https://instagram.com/${data.username}`,
      followers: data.followers || 0,
      following: 0,
      posts_count: data.postsCount || 0,
      posts_last_30d: 0,
      is_verified: !!data.isVerified,
      is_private: false,
      location_declared: "",
      recent_post_captions: [],
      median_engagement: data.medianEngagement || 0,
      median_views: data.medianViews || 0,
      engagement_rate: data.engagementRate || 0,
      stories_view_estimate: data.storiesViewEstimate || 0,
      estimated_ctr: data.estimatedCtr || 0,
      sample_size: data.sampleSize || 0,
      latest_posts: data.latestPosts || [],
    };
  } catch (e: any) {
    console.warn(`[L2] enrich ${username} failed:`, e.message);
    return null;
  }
}

async function layer2EnrichBatch(profiles: BasicProfile[]): Promise<RichProfile[]> {
  // Run in parallel batches of 3 to control concurrency and avoid Apify rate limits
  const BATCH_SIZE = 3;
  const enriched: RichProfile[] = [];
  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const chunk = profiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(chunk.map(p => layer2EnrichOne(p.username)));
    for (let j = 0; j < chunk.length; j++) {
      const rich = results[j];
      if (rich) {
        // Merge: keep basic fields (bio, location, captions) from layer 1
        // and stat fields from layer 2 — both sources contribute their best data
        enriched.push({
          ...chunk[j],
          ...rich,
          bio: chunk[j].bio || rich.bio,
          location_declared: chunk[j].location_declared,
          recent_post_captions: chunk[j].recent_post_captions,
        });
      }
    }
    console.log(`[L2] Enriched ${enriched.length}/${profiles.length}`);
  }
  return enriched;
}

// ═══════════════════════════════════════════════════════════════════════
//  LAYER 3 — Gemini qualification against briefing
// ═══════════════════════════════════════════════════════════════════════

async function qualifyProfile(profile: RichProfile, briefing: string, filters: any): Promise<{ match: boolean; confidence: number; reason: string }> {
  if (!LOVABLE_API_KEY || !briefing?.trim()) {
    return { match: true, confidence: 0.5, reason: "sem-briefing" };
  }
  const summary = [
    `Username: @${profile.username}`,
    `Nome: ${profile.display_name}`,
    `Bio: ${profile.bio || "(vazia)"}`,
    `Seguidores: ${profile.followers.toLocaleString("pt-BR")}`,
    `Engagement rate: ${profile.engagement_rate}%`,
    `Median engagement: ${profile.median_engagement}`,
    `Median views (vídeos): ${profile.median_views}`,
    `Verificado: ${profile.is_verified ? "sim" : "não"}`,
    profile.recent_post_captions.length
      ? `Legendas recentes:\n${profile.recent_post_captions.slice(0, 3).map((c: string) => `- ${c}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");

  const systemPrompt = `Você é um analista sênior de descoberta de influenciadores.
Avalie se o PERFIL bate com o BRIEFING e os FILTROS.

Responda APENAS com JSON:
{ "match": true|false, "confidence": 0.0-1.0, "reason": "explicação curta em pt-BR (máx 18 palavras)" }

Critérios:
- Nicho/tema alinhado ao briefing? (analise bio + legendas + engagement, não só keywords)
- Audiência consistente com o porte pedido?
- Perfil ativo, real, com engagement saudável?
- Bate com gênero/localização se informados?

Seja rigoroso. Prefira rejeitar perfil duvidoso.`;

  const userPrompt = `BRIEFING:\n${briefing}\n\nFILTROS:\n${JSON.stringify({
    locations: filters?.target_locations || [],
    gender: filters?.target_gender || "any",
    min_followers: filters?.min_followers || 0,
    max_followers: filters?.max_followers || 0,
  })}\n\nPERFIL:\n${summary}`;

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
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    return {
      match: !!parsed.match,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: String(parsed.reason || ""),
    };
  } catch (e: any) {
    console.warn("[L3] qualify error:", e.message);
    return { match: true, confidence: 0.3, reason: "ai-parse-error" };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  FALLBACK — Firecrawl-based discovery when no reference is provided
// ═══════════════════════════════════════════════════════════════════════

async function discoverViaFirecrawl(keywords: string[], limit = 60): Promise<string[]> {
  if (!FIRECRAWL_API_KEY || keywords.length === 0) return [];
  const usernames = new Set<string>();
  for (const kw of keywords.slice(0, 4)) {
    if (usernames.size >= limit) break;
    const cleanKw = kw.replace(/^#/, "").trim();
    if (!cleanKw) continue;
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
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
      console.warn(`[firecrawl] error:`, e.message);
    }
  }
  return Array.from(usernames);
}

async function extractKeywordsFromBriefing(briefing: string): Promise<string[]> {
  if (!LOVABLE_API_KEY || !briefing.trim()) return [];
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: 'Extraia 4-6 palavras-chave de busca (pt-BR) do briefing. Retorne APENAS JSON: { "keywords": ["..."] }' },
          { role: "user", content: briefing.slice(0, 800) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    return Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN ROUTINE
// ═══════════════════════════════════════════════════════════════════════

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

  const stats: any = { used_path: "", layer1_total: 0, layer1_passed: 0, layer2_enriched: 0, qualified: 0 };
  const errorsDuringSeed: string[] = [];
  let candidateUsernames: string[] = [];

  // ─── PATH A: reference-based ─────────────────────────────────────
  if (refUsernames.length > 0) {
    stats.used_path = "reference";
    console.log(`[seed] References: ${refUsernames.join(", ")}`);

    // Quick scrape of references to verify they are public
    const seedProfiles = await layer1Scrape(refUsernames);
    for (const seed of seedProfiles) {
      if (seed.is_private) {
        errorsDuringSeed.push(`Perfil @${seed.username} é privado e não pode ser usado como referência.`);
        continue;
      }
      const following = await getFollowingList(seed.username, FOLLOWING_FETCH_PER_REF);
      console.log(`[seed] @${seed.username} follows ${following.length} accounts`);
      candidateUsernames.push(...following);
    }
    candidateUsernames = [...new Set(candidateUsernames)].filter(u => !refUsernames.includes(u));

    if (candidateUsernames.length === 0 && errorsDuringSeed.length > 0) {
      return { prospects: [], stats, error: errorsDuringSeed.join(" ") };
    }
  }

  // ─── PATH B: briefing-based fallback ─────────────────────────────
  if (candidateUsernames.length === 0) {
    stats.used_path = "briefing";
    console.log(`[fallback] Discovering via briefing + keywords`);
    const keywords = [
      ...(custom_keywords || []).map(String).filter(Boolean),
      ...(filters.target_locations || []),
    ];
    if (hasBriefing) {
      const aiKeywords = await extractKeywordsFromBriefing(briefing);
      keywords.push(...aiKeywords);
    }
    const uniqueKeywords = [...new Set(keywords)].slice(0, 6);
    if (uniqueKeywords.length === 0) {
      return { prospects: [], stats, error: "Forneça pelo menos uma referência, briefing, ou palavras-chave." };
    }
    candidateUsernames = await discoverViaFirecrawl(uniqueKeywords, MAX_CANDIDATES * 2);
  }

  candidateUsernames = candidateUsernames.slice(0, MAX_CANDIDATES);
  stats.layer1_total = candidateUsernames.length;
  console.log(`[L1] Scraping ${candidateUsernames.length} candidates (cheap)`);

  if (candidateUsernames.length === 0) {
    return { prospects: [], stats, error: "Nenhum candidato encontrado." };
  }

  // ─── LAYER 1: cheap scrape + hard filter ────────────────────────
  const basicProfiles = await layer1Scrape(candidateUsernames);
  console.log(`[L1] Got ${basicProfiles.length} basic profiles`);

  const wantedLocs = (filters.target_locations || []).filter((l: string) => l);
  const layer1Survivors = basicProfiles
    .filter(p => passesHardFilters(p, filters))
    .filter(p => locationMatches(p, wantedLocs))
    // Sort by followers desc and pick top N for the expensive enrichment
    .sort((a, b) => b.followers - a.followers)
    .slice(0, MAX_RICH_ENRICHMENTS);
  stats.layer1_passed = layer1Survivors.length;
  console.log(`[L1→L2] ${layer1Survivors.length} profiles selected for rich enrichment`);

  if (layer1Survivors.length === 0) {
    return {
      prospects: [],
      stats,
      error: "Todos os candidatos foram filtrados. Tente ajustar os filtros ou usar outras referências.",
    };
  }

  // ─── LAYER 2: rich enrichment (calls instagram-profile fn) ─────
  const richProfiles = await layer2EnrichBatch(layer1Survivors);
  stats.layer2_enriched = richProfiles.length;
  console.log(`[L2] Enriched ${richProfiles.length} profiles with full analytics`);

  // ─── LAYER 3: AI qualification ──────────────────────────────────
  const qualified: any[] = [];
  if (hasBriefing) {
    const BATCH = 5;
    for (let i = 0; i < richProfiles.length; i += BATCH) {
      const chunk = richProfiles.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(p => qualifyProfile(p, briefing, filters)));
      for (let j = 0; j < chunk.length; j++) {
        const p: any = chunk[j];
        const q = results[j];
        p.ai_qualification = q;
        p.match_score = Math.round(q.confidence * 100);
        if (q.match) qualified.push(p);
      }
    }
  } else {
    for (const p of richProfiles as any[]) {
      p.ai_qualification = { match: true, confidence: 0.5, reason: "sem-briefing" };
      p.match_score = 50;
      qualified.push(p);
    }
  }
  stats.qualified = qualified.length;

  // ─── FINAL RANKING ──────────────────────────────────────────────
  qualified.sort((a, b) => {
    if (b.match_score !== a.match_score) return b.match_score - a.match_score;
    if (b.engagement_rate !== a.engagement_rate) return b.engagement_rate - a.engagement_rate;
    return b.followers - a.followers;
  });

  if (errorsDuringSeed.length > 0) stats.warnings = errorsDuringSeed;
  return { prospects: qualified, stats };
}

// ═══════════════════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, briefing, platforms, custom_keywords, manual_filters, reference_url, reference_urls } = body;

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

    const refUrls: string[] = Array.isArray(reference_urls)
      ? reference_urls.filter(Boolean)
      : (reference_url ? [reference_url] : []);
    const selectedPlatforms: string[] = platforms || ["instagram"];
    const briefingId = crypto.randomUUID();

    if (selectedPlatforms.includes("instagram")) {
      const result = await runInstagramDiscovery({
        briefing: briefing || "",
        reference_urls: refUrls,
        manual_filters: manual_filters || {},
        custom_keywords: custom_keywords || [],
      });

      if (result.error && result.prospects.length === 0) {
        return new Response(
          JSON.stringify({
            briefing_id: briefingId,
            total_scraped: result.stats.layer2_enriched || result.stats.layer1_total || 0,
            total_qualified: 0,
            total_spam: Math.max(0, (result.stats.layer1_total || 0) - (result.stats.layer1_passed || 0)),
            total_low_score: result.stats.layer2_enriched || 0,
            stats: { ...result.stats, warning: result.error },
            prospects: [],
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prospects = result.prospects.map(p => ({
        ...p,
        platform: "instagram",
        avg_views: Number(p.median_views || 0),
        score_breakdown: p.ai_qualification || null,
        briefing_id: briefingId,
        briefing_text: briefing || "",
        search_keywords: custom_keywords || [],
      }));

      if (prospects.length > 0) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const dbRecords = prospects.map((p: any) => ({
          platform: "instagram",
          username: p.username || "",
          display_name: p.display_name || p.username || "",
          bio: p.bio || "",
          avatar_url: p.avatar_url || null,
          profile_url: p.profile_url || null,
          followers: Number(p.followers || 0),
          avg_views: Number(p.median_views || 0),
          posts_last_30d: Number(p.posts_last_30d || 0),
          lives_last_30d: 0,
          location_declared: p.location_declared || null,
          location_inferred: null,
          follower_following_ratio: Number(p.following || 0) > 0 ? Number(p.followers || 0) / Number(p.following || 1) : null,
          has_casino_content: false,
          is_spam: false,
          match_score: Number(p.match_score || 0),
          score_breakdown: p.ai_qualification || null,
          briefing_id: briefingId,
          briefing_text: briefing || "",
          search_keywords: custom_keywords || [],
        }));
        const { error } = await supabase.from("discovery_prospects").insert(dbRecords);
        if (error) console.error("[DB] insert error:", error.message);
      }

      return new Response(
        JSON.stringify({
          briefing_id: briefingId,
          total_scraped: result.stats.layer2_enriched || 0,
          total_qualified: result.stats.qualified || 0,
          total_spam: (result.stats.layer1_total || 0) - (result.stats.layer1_passed || 0),
          total_low_score: (result.stats.layer2_enriched || 0) - (result.stats.qualified || 0),
          stats: result.stats,
          prospects,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        error: "Twitch discovery está em manutenção. Use Instagram por enquanto.",
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
