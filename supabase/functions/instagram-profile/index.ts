const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY") || "";

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
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  return data.filter((x) => x >= lowerBound && x <= upperBound);
}

async function callApify(actorId: string, input: Record<string, unknown>, timeoutSec = 120): Promise<any> {
  if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY not configured in Lovable Cloud secrets");
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=${timeoutSec}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Apify ${actorId} failed [${res.status}]: ${errText.slice(0, 300)}`);
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
      return new Response(JSON.stringify({ error: "username inválido (apenas letras, números, ponto e underscore)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Instagram] starting analysis for: ${cleanUsername}`);

    let posts: any[] = [];
    let profileData: any = {};

    try {
      posts = await callApify("apify/instagram-post-scraper", {
        usernames: [cleanUsername],
        resultsLimit: 40,
      });
      console.log(`[Instagram] posts received: ${posts?.length ?? 0}`);
    } catch (e: any) {
      console.error(`[Instagram] post-scraper failed:`, e.message);
      // continue with empty posts (profile-only fallback)
    }

    try {
      const profileItems = await callApify("apify/instagram-profile-scraper", {
        usernames: [cleanUsername],
      });
      profileData = profileItems?.[0] || {};
      console.log(`[Instagram] profile received: followers=${profileData.followersCount}`);
    } catch (e: any) {
      console.error(`[Instagram] profile-scraper failed:`, e.message);
    }

    if ((!posts || posts.length === 0) && !profileData.username) {
      return new Response(JSON.stringify({
        error: `Apify não retornou dados para @${cleanUsername}. Possíveis causas: perfil privado, banido, ou créditos Apify esgotados.`,
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const followers = profileData.followersCount || 0;
    const engagements: number[] = [];
    const views: number[] = [];

    for (const p of posts) {
      const likes = p.likesCount || 0;
      const comments = p.commentsCount || 0;
      const v = p.videoViewCount || p.videoPlayCount || 0;
      engagements.push(likes + comments);
      if (v > 0) views.push(v);
    }

    const filteredEngagements = filterOutliers(engagements);
    const medianEngagement = calculateMedian(filteredEngagements);
    const medianViews = calculateMedian(filterOutliers(views));
    const engagementRate = followers > 0 ? (medianEngagement / followers) * 100 : 0;

    let storiesEstimate = 0;
    if (followers < 10000) storiesEstimate = Math.round(followers * 0.15);
    else if (followers < 100000) storiesEstimate = Math.round(followers * 0.1);
    else storiesEstimate = Math.round(followers * 0.05);

    const result = {
      username: profileData.username || cleanUsername,
      fullName: profileData.fullName || "",
      biography: profileData.biography || "",
      profilePicUrl: profileData.profilePicUrl || profileData.profilePicUrlHD || "",
      followers,
      postsCount: profileData.postsCount || posts.length,
      isVerified: profileData.verified || false,
      medianViews: Math.round(medianViews),
      engagementRate: Math.round(engagementRate * 100) / 100,
      storiesViewEstimate: storiesEstimate,
      estimatedCtr: Math.round(Math.min(engagementRate * 0.3, 5) * 10) / 10,
      sampleSize: posts.length,
      latestPosts: posts.slice(0, 6).map((p: any) => ({
        likes: p.likesCount,
        comments: p.commentsCount,
        views: p.videoViewCount || p.videoPlayCount || 0,
        type: p.mediaType,
      })),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[Instagram] fatal error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
