const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username } = await req.json();
    if (!username) {
      return new Response(JSON.stringify({ error: 'username is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('APIFY_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'APIFY_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanUsername = username.replace(/^@/, '').trim();
    console.log(`Fetching Instagram profile for: ${cleanUsername}`);

    // Use Apify's Instagram Profile Scraper actor
    const actorId = 'apify~instagram-profile-scraper';
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiKey}`;

    const response = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames: [cleanUsername],
        resultsLimit: 12,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Apify error [${response.status}]:`, errText);
      return new Response(JSON.stringify({ error: `Apify request failed: ${response.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = await response.json();
    console.log(`Got ${results.length} result(s) from Apify`);

    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const profile = results[0];

    // Extract metrics from the profile data
    const followers = profile.followersCount || profile.subscribersCount || 0;
    const posts = profile.postsCount || 0;

    // Calculate average views and engagement from recent posts
    const latestPosts = profile.latestPosts || [];
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let videoCount = 0;
    let reelsLikes = 0;
    let reelsComments = 0;

    for (const post of latestPosts) {
      const views = post.videoViewCount || post.videoPlayCount || 0;
      const likes = post.likesCount || 0;
      const comments = post.commentsCount || 0;

      if (views > 0) {
        totalViews += views;
        videoCount++;
        reelsLikes += likes;
        reelsComments += comments;
      }
      totalLikes += likes;
      totalComments += comments;
    }

    const avgReelsViews = videoCount > 0 ? Math.round(totalViews / videoCount) : 0;

    // Total engagement rate (all content)
    const totalEngagements = totalLikes + totalComments;
    const avgEngagement = latestPosts.length > 0 ? totalEngagements / latestPosts.length : 0;
    const engagementRate = followers > 0 ? (avgEngagement / followers) * 100 : 0;

    // Reels-specific engagement rate
    const reelsAvgEngagement = videoCount > 0 ? (reelsLikes + reelsComments) / videoCount : 0;
    const reelsEngagementRate = followers > 0 ? (reelsAvgEngagement / followers) * 100 : 0;

    // Stories engagement estimate (typically lower than reels, ~60-80% of total ER)
    const storiesEngagementRate = engagementRate * 0.65;

    // Estimate CTR from engagement rate (typically 1-5% of engaged users click)
    const estimatedCtr = Math.min(engagementRate * 0.3, 5);

    // Estimate stories views (~10-20% of followers for accounts, higher for smaller)
    const storiesViewEstimate = followers < 10000
      ? Math.round(followers * 0.15)
      : followers < 100000
        ? Math.round(followers * 0.10)
        : Math.round(followers * 0.05);

    const result = {
      username: profile.username || cleanUsername,
      fullName: profile.fullName || '',
      biography: profile.biography || '',
      profilePicUrl: profile.profilePicUrl || profile.profilePicUrlHD || '',
      followers,
      following: profile.followsCount || 0,
      postsCount: posts,
      isVerified: profile.verified || false,
      avgReelsViews,
      videoCount,
      estimatedCtr: Math.round(estimatedCtr * 10) / 10,
      storiesViewEstimate,
      engagementRate: Math.round(engagementRate * 100) / 100,
      latestPostsSample: latestPosts.slice(0, 6).map((p: any) => ({
        type: p.type,
        likes: p.likesCount || 0,
        comments: p.commentsCount || 0,
        views: p.videoViewCount || p.videoPlayCount || 0,
      })),
    };

    console.log('Profile result:', JSON.stringify(result, null, 2));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
