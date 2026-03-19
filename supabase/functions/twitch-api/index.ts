import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/twitch';
const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const TWITCH_API_KEY = Deno.env.get('TWITCH_API_KEY');
  if (!TWITCH_API_KEY) {
    return new Response(JSON.stringify({ error: 'TWITCH_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const headers = {
    'Authorization': `Bearer ${LOVABLE_API_KEY}`,
    'X-Connection-Api-Key': TWITCH_API_KEY!,
  };

  try {
    const body = await req.json();
    const { action, login, user_id, vod_id, vod_count } = body;

    if (action === 'get_user') {
      const res = await fetch(`${GATEWAY_URL}/users?login=${encodeURIComponent(login)}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_stream') {
      const param = login ? `user_login=${encodeURIComponent(login)}` : `user_id=${user_id}`;
      const res = await fetch(`${GATEWAY_URL}/streams?${param}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_vods') {
      const uid = user_id;
      const count = vod_count || 20;
      const res = await fetch(`${GATEWAY_URL}/videos?user_id=${uid}&first=${count}&type=archive`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_vod') {
      const res = await fetch(`${GATEWAY_URL}/videos?id=${vod_id}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch VOD chapters via Twitch GQL
    if (action === 'get_vod_chapters') {
      const videoId = vod_id;
      if (!videoId) throw new Error('vod_id is required for get_vod_chapters');

      const gqlQuery = {
        operationName: "VideoPlayer_ChapterSelectButtonVideo",
        variables: { videoID: String(videoId) },
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: "8d2793384aac3773beab5e59bd5d6f585aedb923d292800571571c2d1f41881c"
          }
        }
      };

      const gqlRes = await fetch(GQL_URL, {
        method: 'POST',
        headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
        body: JSON.stringify(gqlQuery),
      });

      const gqlData = await gqlRes.json();
      const moments = gqlData?.data?.video?.moments?.edges ?? [];
      const chapters = moments.map((edge: { node: { description: string; positionMilliseconds: number; durationMilliseconds: number; details: { game?: { displayName: string; id: string; boxArtURL: string } } } }) => {
        const node = edge.node;
        return {
          description: node.description,
          positionSeconds: Math.round(node.positionMilliseconds / 1000),
          durationSeconds: Math.round(node.durationMilliseconds / 1000),
          game: node.details?.game?.displayName ?? node.description,
          gameId: node.details?.game?.id ?? null,
          gameBoxArt: node.details?.game?.boxArtURL ?? null,
        };
      });

      return new Response(JSON.stringify({ chapters }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Scrape SullyGnome for channel stats (30 days)
    if (action === 'scrape_sullygnome') {
      const channelLogin = (body.login || '').toLowerCase().trim();
      if (!channelLogin) throw new Error('login is required for scrape_sullygnome');

      try {
        const url = `https://sullygnome.com/channel/${encodeURIComponent(channelLogin)}/30`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });

        if (!res.ok) throw new Error(`SullyGnome returned ${res.status}`);
        const html = await res.text();

        // Extract stats from InfoStatPanelTLCell elements
        const panelRegex = /<div class="InfoStatPanelTL"><div class="InfoStatPanelTLCell">([\d,]+)<\/div><\/div>/g;
        const values: number[] = [];
        let match;
        while ((match = panelRegex.exec(html)) !== null) {
          values.push(parseInt(match[1].replace(/,/g, ''), 10));
        }

        // Extract per-stream data from the stream summary table
        const streamRows: { date: string; hours: number; avgViewers: number; peakViewers: number; watchHours: number; followers: number }[] = [];
        const rowRegex = /InfoPanelCombinedRow(?:Alt)?[^>]*>[\s\S]*?<a href="[^"]*">([^<]+)<\/a><\/div>\s*<div class="InfoPanelCombinedRowCell">([\d.]+) hrs<\/div>\s*<div class="InfoPanelCombinedRowCell">([\d,]+)<\/div>\s*<div class="InfoPanelCombinedRowCell">([\d,]+)<\/div>\s*<div class="InfoPanelCombinedRowCell">([\d,.]+) hrs<\/div>\s*<div class="InfoPanelCombinedRowCell">(-?[\d,]+)<\/div>/g;
        while ((match = rowRegex.exec(html)) !== null) {
          streamRows.push({
            date: match[1],
            hours: parseFloat(match[2]),
            avgViewers: parseInt(match[3].replace(/,/g, ''), 10),
            peakViewers: parseInt(match[4].replace(/,/g, ''), 10),
            watchHours: parseFloat(match[5].replace(/,/g, '')),
            followers: parseInt(match[6].replace(/,/g, ''), 10),
          });
        }

        // Order: Average viewers, Hours watched, Followers gained, Peak viewers, Hours streamed, Streams
        const result = {
          avgViewers: values[0] ?? null,
          hoursWatched: values[1] ?? null,
          followersGained: values[2] ?? null,
          peakViewers: values[3] ?? null,
          hoursStreamed: values[4] ?? null,
          totalStreams: values[5] ?? null,
          streams: streamRows,
        };

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('SullyGnome scrape error:', err);
        return new Response(JSON.stringify({ error: `SullyGnome scrape failed: ${err instanceof Error ? err.message : 'unknown'}`, avgViewers: null, peakViewers: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Analyze VOD frames using AI Vision
    if (action === 'analyze_vod_frames') {
      const { thumbnail_urls, vod_title } = body;
      if (!thumbnail_urls || !Array.isArray(thumbnail_urls) || thumbnail_urls.length === 0) {
        throw new Error('thumbnail_urls array is required');
      }

      // Use Lovable AI to analyze the thumbnails
      const AI_GATEWAY = 'https://ai-gateway.lovable.dev/v1/chat/completions';
      
      const imageContent = thumbnail_urls.slice(0, 8).map((url: string) => ({
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
              content: `You are an expert at identifying casino/slot games from screenshots. Analyze each screenshot and identify:
1. The specific slot/casino game name (e.g., "Gates of Olympus", "Sweet Bonanza", "Big Bass Bonanza")
2. The game provider (e.g., "Pragmatic Play", "PG Soft", "NetEnt", "Evolution")
3. If it's not a casino game, describe what's shown (e.g., "Just Chatting", "GTA V gameplay")

Return a JSON array with one object per screenshot: [{"game": "name", "provider": "provider or null", "category": "slots|live_casino|table_game|not_casino", "confidence": "high|medium|low"}]
Only return the JSON array, no other text.`
            },
            {
              role: 'user',
              content: [
                { type: "text", text: `Analyze these ${thumbnail_urls.length} screenshots from the VOD "${vod_title || 'unknown'}". Identify each casino/slot game shown:` },
                ...imageContent
              ]
            }
          ],
          max_tokens: 2000,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`AI analysis failed [${aiRes.status}]: ${errText}`);
      }

      const aiData = await aiRes.json();
      const content = aiData?.choices?.[0]?.message?.content ?? '[]';
      
      // Parse the JSON response
      let games;
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        games = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch {
        games = [{ raw: content }];
      }

      return new Response(JSON.stringify({ games }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get VOD seek thumbnails at specific timestamps
    if (action === 'get_vod_seek_thumbnails') {
      const videoId = vod_id;
      if (!videoId) throw new Error('vod_id is required');
      const { offsets } = body; // Array of seconds
      if (!offsets || !Array.isArray(offsets)) throw new Error('offsets array required');

      // Use GQL to get seek preview URLs
      const thumbnailUrls: { offset: number; url: string }[] = [];
      
      for (const offset of offsets.slice(0, 20)) {
        const gqlQuery = {
          operationName: "VideoPreviewCard__VideoMomentEdge",
          variables: { videoID: String(videoId), offsetSeconds: offset },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: "cb5816f5b29f84a55a1e9e9e1f8f8a1e8f1e8a1e8f1e8a1e8f1e8a1e8f1e8a1e"
            }
          }
        };

        // Alternative: construct thumbnail URL directly from the VOD thumbnail pattern
        // Twitch VOD thumbnails support offset via the animated thumbnail endpoint
        const thumbUrl = `https://static-cdn.jtvnw.net/cf_vods/d1m7jfoe9zdc1j/` +
          `${videoId}//thumb/thumb${offset}-640x360.jpg`;
        thumbnailUrls.push({ offset, url: thumbUrl });
      }

      return new Response(JSON.stringify({ thumbnails: thumbnailUrls }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Twitch function error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
