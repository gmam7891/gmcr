// Instagram profile scraping via RapidAPI (instagram-scraper-api2)
// Migrated from Apify — keeps the exact same response shape used by the frontend.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RAPIDAPI_KEY = Deno.env.get("RAPIDAPI_KEY") || "";
const RAPIDAPI_HOST = "instagram-scraper-api2.p.rapidapi.com";

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

async function rapidGet(path: string, username: string): Promise<any> {
  if (!RAPIDAPI_KEY) throw new Error("RAPIDAPI_KEY not configured");
  const url = `https://${RAPIDAPI_HOST}${path}?username_or_id_or_url=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": RAPIDAPI_KEY,
      "X-RapidAPI-Host": RAPIDAPI_HOST,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RapidAPI ${path} [${res.status}]: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { username } = body as { username?: string };
    if (!username || typeof username !== "string") {
      return new Response(JSON.stringify({ error: "username (string) is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanUsername = username.replace(/^@/, "").trim().toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(cleanUsername)) {
      return new Response(JSON.stringify({ error: "username inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Instagram/RapidAPI] starting for: ${cleanUsername}`);

    // 1) Profile info
    let profileRaw: any = null;
    try {
      profileRaw = await rapidGet("/v1/info", cleanUsername);
    } catch (e: any) {
      console.error("[Instagram/RapidAPI] profile fetch failed:", e.message);
    }

    const profile = profileRaw?.data || profileRaw || {};
    const followers =
      profile.follower_count ?? profile.followers_count ?? profile.edge_followed_by?.count ?? 0;

    if (!profile.username && !followers) {
      return new Response(
        JSON.stringify({
          error: `Não foi possível obter dados do perfil @${cleanUsername}. Pode estar privado, banido, ou cota do RapidAPI esgotada.`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2) Recent posts
    let postsRaw: any = null;
    try {
      postsRaw = await rapidGet("/v1.2/posts", cleanUsername);
    } catch (e: any) {
      console.error("[Instagram/RapidAPI] posts fetch failed:", e.message);
    }

    const posts: any[] =
      postsRaw?.data?.items ?? postsRaw?.items ?? postsRaw?.data ?? [];

    const engagements: number[] = [];
    const views: number[] = [];
    for (const p of posts) {
      const likes = p.like_count ?? p.likesCount ?? 0;
      const comments = p.comment_count ?? p.commentsCount ?? 0;
      const v = p.play_count ?? p.video_view_count ?? p.view_count ?? 0;
      engagements.push(likes + comments);
      if (v > 0) views.push(v);
    }

    const medianEngagement = calculateMedian(filterOutliers(engagements));
    const medianViews = calculateMedian(filterOutliers(views));
    const engagementRate = followers > 0 ? (medianEngagement / followers) * 100 : 0;

    let storiesEstimate = 0;
    if (followers < 10000) storiesEstimate = Math.round(followers * 0.15);
    else if (followers < 100000) storiesEstimate = Math.round(followers * 0.1);
    else storiesEstimate = Math.round(followers * 0.05);

    const result = {
      username: profile.username || cleanUsername,
      fullName: profile.full_name || profile.fullName || "",
      biography: profile.biography || "",
      profilePicUrl:
        profile.profile_pic_url_hd || profile.profile_pic_url || profile.profilePicUrl || "",
      followers,
      postsCount: profile.media_count ?? profile.postsCount ?? posts.length,
      isVerified: profile.is_verified ?? profile.verified ?? false,
      medianViews: Math.round(medianViews),
      avgReelsViews: Math.round(medianViews),
      engagementRate: Math.round(engagementRate * 100) / 100,
      reelsEngagementRate: Math.round(engagementRate * 100) / 100,
      storiesEngagementRate: Math.round(engagementRate * 0.6 * 100) / 100,
      storiesViewEstimate: storiesEstimate,
      estimatedCtr: Math.round(Math.min(engagementRate * 0.3, 5) * 10) / 10,
      sampleSize: posts.length,
      latestPosts: posts.slice(0, 6).map((p: any) => ({
        likes: p.like_count ?? 0,
        comments: p.comment_count ?? 0,
        views: p.play_count ?? p.video_view_count ?? 0,
        type: p.media_type ?? p.product_type ?? "post",
      })),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[Instagram/RapidAPI] fatal:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
