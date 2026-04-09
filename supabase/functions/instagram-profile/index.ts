const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Helper function to calculate the median of an array of numbers
function calculateMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
}

// Helper function to filter out extreme outliers (e.g., sponsored posts with inflated engagement)
function filterOutliers(data: number[]): number[] {
  if (data.length < 4) return data; // Need at least 4 data points for IQR
  const sorted = [...data].sort((a, b) => a - b);
  const q1 = calculateMedian(sorted.slice(0, Math.floor(sorted.length / 2)));
  const q3 = calculateMedian(sorted.slice(Math.ceil(sorted.length / 2)));
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  return data.filter((x) => x >= lowerBound && x <= upperBound);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username } = await req.json();
    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("APIFY_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "APIFY_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanUsername = username.replace(/^@/, "").trim();
    console.log(`Fetching Instagram profile for: ${cleanUsername}`);

    // --- PASSO 1: Buscar os posts usando o Instagram Post Scraper ---
    const postActorId = "apify/instagram-post-scraper"; // ATENÇÃO: MUDANÇA AQUI!
    const postRunUrl = `https://api.apify.com/v2/acts/${postActorId}/run-sync-get-dataset-items?token=${apiKey}`;

    const postResponse = await fetch(postRunUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [cleanUsername],
        resultsLimit: 40, // Agora este limite será respeitado pelo Post Scraper
      }),
    });

    if (!postResponse.ok) {
      const errText = await postResponse.text();
      console.error(`Apify Post Scraper error [${postResponse.status}]:`, errText);
      return new Response(JSON.stringify({ error: `Apify Post Scraper request failed: ${postResponse.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await postResponse.json();
    console.log(`Got ${results.length} post(s) from Apify Post Scraper`);

    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ error: "No posts found for this profile" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- PASSO 2: Buscar os dados do perfil usando o Instagram Profile Scraper ---
    // É necessário fazer uma segunda chamada para obter dados como followersCount, biography, etc.
    const profileActorId = "apify/instagram-profile-scraper";
    const profileRunUrl = `https://api.apify.com/v2/acts/${profileActorId}/run-sync-get-dataset-items?token=${apiKey}`;
    const profileResponse = await fetch(profileRunUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [cleanUsername],
      }),
    });

    let profileData: any = {};
    if (profileResponse.ok) {
      const profileResults = await profileResponse.json();
      if (profileResults && profileResults.length > 0) {
        profileData = profileResults[0];
      }
    } else {
      console.warn(`Could not fetch full profile data for ${cleanUsername}. Using partial data.`);
    }

    const followers = profileData.followersCount || profileData.subscribersCount || 0;
    const postsCount = profileData.postsCount || results.length; // Usar o count do perfil ou o número de posts que pegamos

    const latestPosts = results; // Agora 'results' são os posts diretamente

    const postEngagements: number[] = [];
    const reelsEngagements: number[] = [];
    const postLikes: number[] = [];
    const postComments: number[] = [];
    const postViews: number[] = [];

    let videoCount = 0;

    for (const post of latestPosts) {
      const likes = post.likesCount || 0;
      const comments = post.commentsCount || 0;
      const views = post.videoViewCount || post.videoPlayCount || 0;

      const engagement = likes + comments;
      postEngagements.push(engagement);
      postLikes.push(likes);
      postComments.push(comments);
      postViews.push(views);

      if (post.mediaType === "Video" || post.mediaType === "Reel") {
        videoCount++;
        reelsEngagements.push(likes + comments);
      }
    }

    // Filter outliers for more robust median calculation
    const filteredPostEngagements = filterOutliers(postEngagements);
    const filteredReelsEngagements = filterOutliers(reelsEngagements);

    const medianPostEngagement = calculateMedian(filteredPostEngagements);
    const medianReelsEngagement = calculateMedian(filteredReelsEngagements);
    const medianPostLikes = calculateMedian(filterOutliers(postLikes));
    const medianPostComments = calculateMedian(filterOutliers(postComments));
    const medianPostViews = calculateMedian(filterOutliers(postViews));

    // Total engagement rate (all content) using median
    const engagementRate = followers > 0 ? (medianPostEngagement / followers) * 100 : 0;

    // Reels-specific engagement rate using median
    const reelsEngagementRate = followers > 0 ? (medianReelsEngagement / followers) * 100 : 0;

    // Refined estimate stories views based on follower tiers
    let storiesViewEstimate = 0;
    if (followers < 5000) {
      storiesViewEstimate = Math.round(followers * 0.2); // 20% for very small accounts
    } else if (followers < 50000) {
      storiesViewEstimate = Math.round(followers * 0.12); // 12% for small to medium
    } else if (followers < 500000) {
      storiesViewEstimate = Math.round(followers * 0.08); // 8% for medium to large
    } else {
      storiesViewEstimate = Math.round(followers * 0.04); // 4% for very large accounts
    }

    // Stories engagement = storiesViews / followers * 100
    const storiesEngagementRate = followers > 0 ? (storiesViewEstimate / followers) * 100 : 0;

    // Estimate CTR from total engagement rate (typically 1-5% of engaged users click)
    const estimatedCtr = Math.min(engagementRate * 0.3, 5);

    const result = {
      username: profileData.username || cleanUsername,
      fullName: profileData.fullName || "",
      biography: profileData.biography || "",
      profilePicUrl: profileData.profilePicUrl || profileData.profilePicUrlHD || "",
      followers,
      following: profileData.followsCount || 0,
      postsCount: postsCount,
      isVerified: profileData.verified || false,
      medianPostViews: medianPostViews,
      medianReelsViews: medianPostViews, // Pode ser ajustado se houver dados específicos de views de reels no Post Scraper
      videoCount,
      estimatedCtr: Math.round(estimatedCtr * 10) / 10,
      storiesViewEstimate,
      engagementRate: Math.round(engagementRate * 100) / 100,
      reelsEngagementRate: Math.round(reelsEngagementRate * 100) / 100,
      storiesEngagementRate: Math.round(storiesEngagementRate * 100) / 100,
      latestPostsSample: latestPosts.slice(0, 6).map((p: any) => ({
        type: p.mediaType,
        likes: p.likesCount || 0,
        comments: p.commentsCount || 0,
        views: p.videoViewCount || p.videoPlayCount || 0,
      })),
    };

    console.log("Profile result:", JSON.stringify(result, null, 2));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
