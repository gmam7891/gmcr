import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseYTDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0') * 60) + parseInt(match[2] || '0') + (parseInt(match[3] || '0') / 60);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return jsonResponse({ error: 'LOVABLE_API_KEY not configured' }, 500);

  try {
    const body = await req.json();
    const { action } = body;

    // ==================== YOUTUBE ====================
    if (action === 'youtube_get_channel') {
      const YT_KEY = Deno.env.get('YOUTUBE_API_KEY');
      if (!YT_KEY) return jsonResponse({ error: 'YOUTUBE_API_KEY not configured' }, 500);

      const { handle } = body;
      if (!handle) throw new Error('handle is required');

      // Try forHandle first, then forUsername
      let cleanHandle = handle.replace(/^@/, '').trim();
      
      let res = await fetch(`${YT_BASE}/channels?part=snippet,statistics,brandingSettings&forHandle=${encodeURIComponent(cleanHandle)}&key=${YT_KEY}`);
      let data = await res.json();

      if (!data.items || data.items.length === 0) {
        // Try as username
        res = await fetch(`${YT_BASE}/channels?part=snippet,statistics,brandingSettings&forUsername=${encodeURIComponent(cleanHandle)}&key=${YT_KEY}`);
        data = await res.json();
      }

      if (!data.items || data.items.length === 0) {
        // Try search
        res = await fetch(`${YT_BASE}/search?part=snippet&q=${encodeURIComponent(cleanHandle)}&type=channel&maxResults=1&key=${YT_KEY}`);
        const searchData = await res.json();
        if (searchData.items && searchData.items.length > 0) {
          const channelId = searchData.items[0].snippet.channelId;
          res = await fetch(`${YT_BASE}/channels?part=snippet,statistics,brandingSettings&id=${channelId}&key=${YT_KEY}`);
          data = await res.json();
        }
      }

      if (!data.items || data.items.length === 0) {
        return jsonResponse({ error: 'Channel not found' }, 404);
      }

      const ch = data.items[0];
      return jsonResponse({
        id: ch.id,
        title: ch.snippet.title,
        description: ch.snippet.description,
        thumbnailUrl: ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url,
        subscriberCount: parseInt(ch.statistics.subscriberCount || '0'),
        viewCount: parseInt(ch.statistics.viewCount || '0'),
        videoCount: parseInt(ch.statistics.videoCount || '0'),
        customUrl: ch.snippet.customUrl,
      });
    }

    if (action === 'youtube_get_videos') {
      const YT_KEY = Deno.env.get('YOUTUBE_API_KEY');
      if (!YT_KEY) return jsonResponse({ error: 'YOUTUBE_API_KEY not configured' }, 500);

      const { channel_id, max_results } = body;
      if (!channel_id) throw new Error('channel_id is required');
      const count = max_results || 20;

      // Search for recent videos
      const searchRes = await fetch(`${YT_BASE}/search?part=snippet&channelId=${channel_id}&type=video&order=date&maxResults=${count}&key=${YT_KEY}`);
      const searchData = await searchRes.json();

      if (!searchData.items || searchData.items.length === 0) {
        return jsonResponse({ videos: [] });
      }

      // Get detailed video info
      const videoIds = searchData.items.map((i: any) => i.id.videoId).join(',');
      const detailRes = await fetch(`${YT_BASE}/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${YT_KEY}`);
      const detailData = await detailRes.json();

      const videos = (detailData.items || []).map((v: any) => ({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        publishedAt: v.snippet.publishedAt,
        thumbnailUrl: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
        viewCount: parseInt(v.statistics.viewCount || '0'),
        likeCount: parseInt(v.statistics.likeCount || '0'),
        commentCount: parseInt(v.statistics.commentCount || '0'),
        duration: v.contentDetails.duration,
        durationMinutes: parseYTDuration(v.contentDetails.duration),
      }));

      return jsonResponse({ videos });
    }

    // ==================== KICK ====================
    if (action === 'kick_get_channel') {
      const { username } = body;
      if (!username) throw new Error('username is required');

      const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(username.toLowerCase())}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        if (res.status === 404) return jsonResponse({ error: 'Channel not found' }, 404);
        throw new Error(`Kick API error: ${res.status}`);
      }

      const data = await res.json();
      return jsonResponse({
        id: data.id,
        username: data.slug || data.user?.username,
        displayName: data.user?.username || data.slug,
        bio: data.user?.bio,
        avatarUrl: data.user?.profile_pic,
        followers: data.followersCount || data.followers_count || 0,
        isLive: data.livestream !== null,
        livestream: data.livestream ? {
          title: data.livestream.session_title,
          viewers: data.livestream.viewer_count,
          category: data.livestream.categories?.[0]?.name,
          startedAt: data.livestream.created_at,
        } : null,
        verified: data.verified || false,
      });
    }

    if (action === 'kick_get_videos') {
      const { username } = body;
      if (!username) throw new Error('username is required');

      const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(username.toLowerCase())}/videos`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });

      if (!res.ok) throw new Error(`Kick videos API error: ${res.status}`);
      const data = await res.json();

      // Kick returns videos in different formats, normalize
      const videos = (Array.isArray(data) ? data : data.data || []).map((v: any) => ({
        id: v.id || v.uuid,
        title: v.session_title || v.title || 'Untitled',
        thumbnailUrl: v.thumbnail?.url || v.thumbnail || null,
        viewCount: v.views || v.view_count || 0,
        duration: v.duration || '0',
        durationMinutes: typeof v.duration === 'string' ? parseFloat(v.duration) / 60 : (v.duration || 0) / 60,
        createdAt: v.created_at || v.start_time,
        categories: v.categories?.map((c: any) => c.name) || [],
      }));

      return jsonResponse({ videos });
    }

    // ==================== AI ANALYSIS (shared) ====================
    if (action === 'analyze_thumbnails') {
      const { thumbnail_urls, title, platform } = body;
      if (!thumbnail_urls?.length) throw new Error('thumbnail_urls required');

      const BATCH_SIZE = 6;
      const allDetections: any[] = [];

      for (let i = 0; i < thumbnail_urls.length; i += BATCH_SIZE) {
        const batch = thumbnail_urls.slice(i, i + BATCH_SIZE);
        const imageContent = batch.map((url: string) => ({
          type: "image_url",
          image_url: { url, detail: "low" }
        }));

        const aiRes = await fetch(AI_GATEWAY, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `You are an expert at identifying casino/slot games from stream screenshots and thumbnails.

PRIORITY PROVIDERS:
- Pragmatic Play (Gates of Olympus, Sweet Bonanza, Big Bass Bonanza, Sugar Rush, Starlight Princess, Dog House, Wolf Gold, Fruit Party, etc.)
- Tada Gaming
- Games Global / Microgaming and ALL their studios — detect ANY as provider "Games Global":
  Studios: Stormcraft Studios, Triple Edge Studios, Gameburger Studios, All41 Studios, SpinPlay Games, Neon Valley Studios, Gold Coin Studios, Snowborn Games, Alchemy Gaming, Buck Stakes Entertainment, Crazy Tooth Studio, Electric Elephant, Fantasma Games, Fortune Factory Studios, Foxium, Just For The Win (JFTW), Neko Games, Northern Lights Gaming, Old Skool Studios, Pulse 8 Studios, Rabcat, Real Dealer Studios, Slingshot Studios, Switch Studios, Area Link
  Known games: Immortal Romance, Mega Moolah, Thunderstruck, Book of Oz, Lara Croft, Break Da Bank, Avalon, 9 Masks of Fire, Hyper Gold, Amazing Link, Area Link, Book of Atem, etc.
- BGaming (Elvis Frog, Aloha King Elvis, Space XY, etc.)
- Amusnet / EGT (40 Burning Hot, Rise of Ra, etc.)
- PG Soft (Fortune Tiger, Fortune Ox, Fortune Mouse, Mahjong Ways, etc.)
- Hacksaw Gaming (Wanted Dead or a Wild, Chaos Crew, etc.)
- Playtech (Age of the Gods, Buffalo Blitz, etc.)
- Endorphina (Lucky Streak, Satoshi's Secret, etc.)
- FA Chai (Golden Empire, Boxing King, etc.)

For each image, identify casino games visible.
Return JSON array: [{"game": "name", "provider": "provider", "category": "slots|live_casino|table_game|not_casino", "confidence": "high|medium|low", "image_index": 0}]
Only return the JSON array, no other text.`
              },
              {
                role: 'user',
                content: [
                  { type: "text", text: `Analyze these ${batch.length} thumbnails from ${platform || 'stream'} "${title || 'unknown'}". Identify casino games.` },
                  ...imageContent
                ]
              }
            ],
            max_tokens: 2000,
          }),
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const content = aiData?.choices?.[0]?.message?.content ?? '[]';
          try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            const games = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
            allDetections.push(...games);
          } catch { console.error('AI parse error'); }
        }

        if (i + BATCH_SIZE < thumbnail_urls.length) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      const uniqueGames = new Map<string, any>();
      for (const d of allDetections) {
        const key = `${d.game}|${d.provider}`;
        if (!uniqueGames.has(key)) uniqueGames.set(key, d);
      }

      return jsonResponse({ games: Array.from(uniqueGames.values()), totalSamples: allDetections.length });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error: unknown) {
    console.error('youtube-kick-api error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: msg }, 500);
  }
});
