import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/twitch';
const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return jsonResponse({ error: 'LOVABLE_API_KEY not configured' }, 500);
  }

  const TWITCH_API_KEY = Deno.env.get('TWITCH_API_KEY');
  if (!TWITCH_API_KEY) {
    return jsonResponse({ error: 'TWITCH_API_KEY not configured' }, 500);
  }

  const twitchHeaders = {
    'Authorization': `Bearer ${LOVABLE_API_KEY}`,
    'X-Connection-Api-Key': TWITCH_API_KEY!,
  };

  try {
    const body = await req.json();
    const { action, login, user_id, vod_id, vod_count } = body;

    // --- Twitch API proxy ---
    if (action === 'get_user') {
      const res = await fetch(`${GATEWAY_URL}/users?login=${encodeURIComponent(login)}`, { headers: twitchHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return jsonResponse(data);
    }

    if (action === 'get_stream') {
      const param = login ? `user_login=${encodeURIComponent(login)}` : `user_id=${user_id}`;
      const res = await fetch(`${GATEWAY_URL}/streams?${param}`, { headers: twitchHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return jsonResponse(data);
    }

    if (action === 'get_vods') {
      const count = vod_count || 20;
      const res = await fetch(`${GATEWAY_URL}/videos?user_id=${user_id}&first=${count}&type=archive`, { headers: twitchHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return jsonResponse(data);
    }

    if (action === 'get_vod') {
      const res = await fetch(`${GATEWAY_URL}/videos?id=${vod_id}`, { headers: twitchHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return jsonResponse(data);
    }

    // --- VOD chapters via GQL ---
    if (action === 'get_vod_chapters') {
      if (!vod_id) throw new Error('vod_id is required');
      const gqlRes = await fetch(GQL_URL, {
        method: 'POST',
        headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationName: "VideoPlayer_ChapterSelectButtonVideo",
          variables: { videoID: String(vod_id) },
          extensions: { persistedQuery: { version: 1, sha256Hash: "8d2793384aac3773beab5e59bd5d6f585aedb923d292800571571c2d1f41881c" } }
        }),
      });
      const gqlData = await gqlRes.json();
      const moments = gqlData?.data?.video?.moments?.edges ?? [];
      const chapters = moments.map((edge: any) => {
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
      return jsonResponse({ chapters });
    }

    // --- SullyGnome scrape ---
    if (action === 'scrape_sullygnome') {
      const channelLogin = (body.login || '').toLowerCase().trim();
      if (!channelLogin) throw new Error('login is required');
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
        const panelRegex = /<div class="InfoStatPanelTL"><div class="InfoStatPanelTLCell">([\d,]+)<\/div><\/div>/g;
        const values: number[] = [];
        let match;
        while ((match = panelRegex.exec(html)) !== null) {
          values.push(parseInt(match[1].replace(/,/g, ''), 10));
        }
        const streamRows: any[] = [];
        const rowRegex = /InfoPanelCombinedRow(?:Alt)?[^>]*>[\s\S]*?<a href="[^"]*">([^<]+)<\/a><\/div>\s*<div class="InfoPanelCombinedRowCell">([\d.]+) hrs<\/div>\s*<div class="InfoPanelCombinedRowCell">([\d,]+)<\/div>\s*<div class="InfoPanelCombinedRowCell">([\d,]+)<\/div>\s*<div class="InfoPanelCombinedRowCell">([\d,.]+) hrs<\/div>\s*<div class="InfoPanelCombinedRowCell">(-?[\d,]+)<\/div>/g;
        while ((match = rowRegex.exec(html)) !== null) {
          streamRows.push({
            date: match[1], hours: parseFloat(match[2]),
            avgViewers: parseInt(match[3].replace(/,/g, ''), 10),
            peakViewers: parseInt(match[4].replace(/,/g, ''), 10),
            watchHours: parseFloat(match[5].replace(/,/g, '')),
            followers: parseInt(match[6].replace(/,/g, ''), 10),
          });
        }
        return jsonResponse({
          avgViewers: values[0] ?? null, hoursWatched: values[1] ?? null,
          followersGained: values[2] ?? null, peakViewers: values[3] ?? null,
          hoursStreamed: values[4] ?? null, totalStreams: values[5] ?? null, streams: streamRows,
        });
      } catch (err) {
        console.error('SullyGnome scrape error:', err);
        return jsonResponse({ error: `SullyGnome scrape failed: ${err instanceof Error ? err.message : 'unknown'}`, avgViewers: null, peakViewers: null });
      }
    }

    // --- Get VOD storyboard URLs via GQL ---
    if (action === 'get_storyboard_urls') {
      if (!vod_id) throw new Error('vod_id is required');

      const gqlRes = await fetch(GQL_URL, {
        method: 'POST',
        headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query { video(id: "${vod_id}") { seekPreviewsURL } }`,
        }),
      });

      const gqlData = await gqlRes.json();
      const seekPreviewsURL = gqlData?.data?.video?.seekPreviewsURL;

      if (!seekPreviewsURL) {
        return jsonResponse({ storyboardUrls: [], interval: 0, error: 'No storyboard URL available' });
      }

      // seekPreviewsURL is an info.json file, fetch it to get actual strip image URLs
      const infoRes = await fetch(seekPreviewsURL);
      if (!infoRes.ok) {
        return jsonResponse({ storyboardUrls: [], interval: 0, error: `Failed to fetch storyboard info: ${infoRes.status}` });
      }

      const infoData = await infoRes.json();
      // infoData is an array like:
      // [{ quality: "low", images: [...], interval: 19, cols: 5, rows: 40, width: 160, height: 90, count: 200 },
      //  { quality: "high", images: [...], interval: 19, cols: 5, rows: 10, width: 220, height: 124, count: 200 }]

      // Prefer "high" quality
      const highQuality = infoData.find((q: any) => q.quality === 'high') || infoData[0];
      if (!highQuality) {
        return jsonResponse({ storyboardUrls: [], interval: 0, error: 'No storyboard quality data' });
      }

      // Build full URLs for the strip images
      const baseUrl = seekPreviewsURL.replace(/[^/]+$/, ''); // remove info.json filename
      const storyboardUrls = highQuality.images.map((img: string) => baseUrl + img);

      return jsonResponse({
        storyboardUrls,
        interval: highQuality.interval,
        cols: highQuality.cols,
        rows: highQuality.rows,
        width: highQuality.width,
        height: highQuality.height,
        count: highQuality.count,
        framesPerStrip: highQuality.cols * highQuality.rows,
      });
    }

    // --- Deep VOD analysis with AI Vision using storyboards ---
    if (action === 'analyze_vod_frames') {
      const { thumbnail_urls, vod_title, timestamps } = body;
      if (!thumbnail_urls || !Array.isArray(thumbnail_urls) || thumbnail_urls.length === 0) {
        throw new Error('thumbnail_urls array is required');
      }

      const hasTimestamps = timestamps && Array.isArray(timestamps) && timestamps.length === thumbnail_urls.length;

      // Process in batches of 6 images per AI call (storyboard sprites are larger)
      const BATCH_SIZE = 6;
      const allDetections: { game: string; provider: string | null; category: string; confidence: string; timestampSeconds: number }[] = [];

      for (let batchStart = 0; batchStart < thumbnail_urls.length; batchStart += BATCH_SIZE) {
        const batchUrls = thumbnail_urls.slice(batchStart, batchStart + BATCH_SIZE);
        const batchTimestamps = hasTimestamps ? timestamps.slice(batchStart, batchStart + BATCH_SIZE) : [];

        const imageContent = batchUrls.map((url: string) => ({
          type: "image_url",
          image_url: { url, detail: "low" }
        }));

        const timestampInfo = hasTimestamps
          ? `\nTimestamps: ${batchTimestamps.map((t: number, i: number) => `Image ${i + 1}: ~${Math.floor(t / 60)}min`).join(', ')}`
          : '';

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
                content: `You are an expert at identifying casino/slot games from stream screenshots and storyboard sprite sheets.

IMPORTANT: Each image may be a STORYBOARD SPRITE SHEET containing multiple small thumbnails arranged in a grid. Analyze ALL thumbnails visible in each sprite sheet.

PRIORITY PROVIDERS (identify games from these):
- Pragmatic Play (Gates of Olympus, Sweet Bonanza, Big Bass Bonanza, Sugar Rush, Starlight Princess, Dog House, Wolf Gold, Fruit Party, etc.)
- Tada Gaming
- Games Global / Microgaming (Immortal Romance, Mega Moolah, Thunderstruck, Book of Oz, Lara Croft, etc.)
- BGaming (Elvis Frog, Aloha King Elvis, Space XY, etc.)
- Amusnet / EGT (40 Burning Hot, Rise of Ra, etc.)
- PG Soft (Fortune Tiger, Fortune Ox, Fortune Mouse, Mahjong Ways, etc.)
- Hacksaw Gaming (Wanted Dead or a Wild, Chaos Crew, etc.)
- Playtech (Age of the Gods, Buffalo Blitz, etc.)
- Endorphina (Lucky Streak, Satoshi's Secret, etc.)
- FA Chai (Golden Empire, Boxing King, etc.)

For each image/sprite sheet, identify ALL distinct casino games visible. Return one entry per distinct game detected:
[{"game": "name", "provider": "provider", "category": "slots|live_casino|table_game|not_casino", "confidence": "high|medium|low", "image_index": 0}]

If a sprite sheet shows multiple different games, return multiple entries with the same image_index.
If it's not a casino game (e.g., Just Chatting, gameplay), return one entry with category "not_casino".
Only return the JSON array, no other text.`
              },
              {
                role: 'user',
                content: [
                  { type: "text", text: `Analyze these ${batchUrls.length} images from the VOD "${vod_title || 'unknown'}". Some may be storyboard sprite sheets with multiple thumbnails. Identify every casino game visible.${timestampInfo}` },
                  ...imageContent
                ]
              }
            ],
            max_tokens: 3000,
          }),
        });

        if (!aiRes.ok) {
          const errText = await aiRes.text();
          console.error(`AI batch error [${aiRes.status}]:`, errText);
          continue;
        }

        const aiData = await aiRes.json();
        const content = aiData?.choices?.[0]?.message?.content ?? '[]';

        try {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          const batchGames = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
          for (const g of batchGames) {
            const imgIdx = g.image_index ?? 0;
            const ts = hasTimestamps && batchTimestamps[imgIdx] != null ? batchTimestamps[imgIdx] : 0;
            allDetections.push({ ...g, timestampSeconds: ts });
          }
        } catch {
          console.error('Failed to parse AI response:', content);
        }

        // Delay between batches
        if (batchStart + BATCH_SIZE < thumbnail_urls.length) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      // Build timeline from detections sorted by timestamp
      const gameTimeline: any[] = [];
      if (hasTimestamps && allDetections.length > 0) {
        allDetections.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
        const interval = allDetections.length > 1
          ? (allDetections[allDetections.length - 1].timestampSeconds - allDetections[0].timestampSeconds) / (allDetections.length - 1)
          : 120;

        let seg = {
          game: allDetections[0].game, provider: allDetections[0].provider,
          category: allDetections[0].category,
          startSeconds: Math.max(0, allDetections[0].timestampSeconds - interval / 2),
          endSeconds: allDetections[0].timestampSeconds + interval / 2,
        };

        for (let i = 1; i < allDetections.length; i++) {
          const det = allDetections[i];
          if (det.game === seg.game && det.provider === seg.provider) {
            seg.endSeconds = det.timestampSeconds + interval / 2;
          } else {
            gameTimeline.push({ ...seg, durationSeconds: Math.round(seg.endSeconds - seg.startSeconds) });
            seg = {
              game: det.game, provider: det.provider, category: det.category,
              startSeconds: det.timestampSeconds - interval / 2,
              endSeconds: det.timestampSeconds + interval / 2,
            };
          }
        }
        gameTimeline.push({ ...seg, durationSeconds: Math.round(seg.endSeconds - seg.startSeconds) });
      }

      // Unique games
      const uniqueGames = new Map<string, any>();
      for (const det of allDetections) {
        const key = `${det.game}|${det.provider}`;
        if (!uniqueGames.has(key)) uniqueGames.set(key, det);
      }

      return jsonResponse({
        games: Array.from(uniqueGames.values()),
        gameTimeline,
        totalSamples: allDetections.length,
      });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error: unknown) {
    console.error('Twitch function error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: msg }, 500);
  }
});
