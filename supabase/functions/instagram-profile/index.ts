const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APIFY_API_KEY = "apify_api_mIgb254Z3CxKOYBZPc2ObSaAIItb3V4iR2D9";

/**
 * Funções Auxiliares para Métricas Profissionais (Estilo Modash)
 */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { username } = await req.json();
    if (!username)
      return new Response(JSON.stringify({ error: "username is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const cleanUsername = username.replace(/^@/, "").trim();
    console.log(`[Instagram API] Iniciando análise profunda para: ${cleanUsername}`);

    // --- PASSO 1: Buscar 40 posts reais (Instagram Post Scraper) ---
    const postActorId = "apify/instagram-post-scraper";
    const postRunUrl = `https://api.apify.com/v2/acts/${postActorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}`;

    const postResponse = await fetch(postRunUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [cleanUsername], resultsLimit: 40 }),
    });

    if (!postResponse.ok) throw new Error(`Falha no Apify Post Scraper: ${postResponse.status}`);
    const posts = await postResponse.json();

    // --- PASSO 2: Buscar dados do perfil (Instagram Profile Scraper) ---
    const profileActorId = "apify/instagram-profile-scraper";
    const profileRunUrl = `https://api.apify.com/v2/acts/${profileActorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}`;

    const profileResponse = await fetch(profileRunUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [cleanUsername] }),
    });

    const profileData = profileResponse.ok ? (await profileResponse.json())[0] : {};

    // --- PROCESSAMENTO DE MÉTRICAS ---
    const followers = profileData.followersCount || 0;
    const engagements: number[] = [];
    const views: number[] = [];
    let videoCount = 0;

    for (const p of posts) {
      const likes = p.likesCount || 0;
      const comments = p.commentsCount || 0;
      const v = p.videoViewCount || p.videoPlayCount || 0;

      engagements.push(likes + comments);
      if (v > 0) {
        views.push(v);
        videoCount++;
      }
    }

    const filteredEngagements = filterOutliers(engagements);
    const medianEngagement = calculateMedian(filteredEngagements);
    const medianViews = calculateMedian(filterOutliers(views));

    // Taxa de Engajamento Real (Baseada na Mediana dos últimos 40 posts)
    const engagementRate = followers > 0 ? (medianEngagement / followers) * 100 : 0;

    // Estimativa de Stories (Curva de mercado por faixa de seguidores)
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

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("Erro na API:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
