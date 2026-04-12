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

      const infoRes = await fetch(seekPreviewsURL);
      if (!infoRes.ok) {
        return jsonResponse({ storyboardUrls: [], interval: 0, error: `Failed to fetch storyboard info: ${infoRes.status}` });
      }

      const infoData = await infoRes.json();
      const highQuality = infoData.find((q: any) => q.quality === 'high') || infoData[0];
      if (!highQuality) {
        return jsonResponse({ storyboardUrls: [], interval: 0, error: 'No storyboard quality data' });
      }

      const baseUrl = seekPreviewsURL.replace(/[^/]+$/, '');
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

    // --- Deep VOD analysis with AI Vision (Anti-Hallucination Prompt) ---
    if (action === 'analyze_vod_frames') {
      const { thumbnail_urls, vod_title, timestamps } = body;
      if (!thumbnail_urls || !Array.isArray(thumbnail_urls) || thumbnail_urls.length === 0) {
        throw new Error('thumbnail_urls array is required');
      }

      const hasTimestamps = timestamps && Array.isArray(timestamps) && timestamps.length === thumbnail_urls.length;

      const BATCH_SIZE = 6;
      const allDetections: { game: string; provider: string | null; category: string; confidence: string; timestampSeconds: number }[] = [];

      for (let batchStart = 0; batchStart < thumbnail_urls.length; batchStart += BATCH_SIZE) {
        const batchUrls = thumbnail_urls.slice(batchStart, batchStart + BATCH_SIZE);
        const batchTimestamps = hasTimestamps ? timestamps.slice(batchStart, batchStart + BATCH_SIZE) : [];

        const imageContent = batchUrls.map((url: string) => ({
          type: "image_url",
          image_url: { url, detail: "high" }
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
                content: `You are a precision visual auditor for casino/slot game detection in livestream footage.

=== CORE PRINCIPLE: VISUAL EVIDENCE ONLY ===
Your classification MUST be based SOLELY on what you SEE in the image. The VOD title is metadata context only — if the title says "Playing Sweet Bonanza" but the image shows a browser or Just Chatting screen, classify as "not_casino".

=== CLASSIFICATION RULES ===

1. POSITIVE DETECTION (category = "slots", "live_casino", or "table_game"):
   - You MUST see actual game HUD/UI elements: spin button, bet display, balance counter, game grid/reels, dealer table, cards, roulette wheel.
   - The game interface must occupy the MAJORITY of the screen (not a small window).
   - Identify the specific game name and provider based on visual elements (symbols, UI style, logo).

2. WATCHING CONTENT (category = "not_casino", game = "Watching Content"):
   - Image shows a VIDEO PLAYER (YouTube, Twitch clip, or any embedded player) even if the video content is about casino games.
   - Browser is open showing websites, social media, or video content.
   - A smaller window showing game content while the main screen is something else.

3. JUST CHATTING (category = "not_casino", game = "Just Chatting"):
   - Webcam-dominant view with no game visible.
   - Chat overlay without game in background.
   - Starting/ending screen, BRB screen, intermission.

4. LOADING/LOBBY (category = "not_casino", game = "Loading/Lobby"):
   - Casino lobby showing game thumbnails but no active game.
   - Loading screens, deposit screens, cashier pages.
   - Game selection menus.

5. UNKNOWN (category = "not_casino", game = "Unknown", confidence = "low"):
   - Image is too blurry, dark, or obstructed to identify.
   - Cannot determine what is being shown.
   - DO NOT GUESS — if you are not sure, mark as Unknown.

=== ANTI-HALLUCINATION RULES ===
- NEVER classify based on VOD title alone.
- NEVER assume a game is being played just because the streamer typically plays casino.
- If you see a casino lobby (game thumbnails/selection), that is NOT active gameplay — classify as "Loading/Lobby".
- If confidence is below "medium", classify as "Unknown" rather than guessing a game name.
- Each sprite sheet thumbnail is independent — do NOT carry classification from one thumbnail to adjacent ones.

=== PRIORITY PROVIDERS ===
Pragmatic Play, Tada Gaming, Games Global (all studios: Stormcraft, Triple Edge, Gameburger, All41, SpinPlay, Neon Valley, Gold Coin, Snowborn, Alchemy, Crazy Tooth, Fantasma, Foxium, JFTW, Rabcat, Area Link), BGaming, Amusnet/EGT, PG Soft, Hacksaw Gaming, Playtech, Endorphina, FA Chai.

=== OUTPUT FORMAT ===
Return ONLY a JSON array. One entry per distinct detection per image:
[{"game": "name", "provider": "provider_name", "category": "slots|live_casino|table_game|not_casino", "confidence": "high|medium|low", "image_index": 0}]

Do NOT add any text outside the JSON array.`
              },
              {
                role: 'user',
                content: [
                  { type: "text", text: `Analyze these ${batchUrls.length} images from a VOD. Title context (DO NOT use as sole evidence): "${vod_title || 'unknown'}". Identify what is VISUALLY shown in each image.${timestampInfo}` },
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

        if (batchStart + BATCH_SIZE < thumbnail_urls.length) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      // ── 3-Minute Persistence Filter (Noise Reduction) ──
      // Sort by timestamp, then only keep games that appear in 3+ consecutive frames
      allDetections.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

      const confirmedDetections: typeof allDetections = [];
      let i = 0;
      while (i < allDetections.length) {
        const current = allDetections[i];
        // Skip non-casino detections — they pass through as-is
        if (current.category === 'not_casino') {
          confirmedDetections.push(current);
          i++;
          continue;
        }

        // Count consecutive frames with the same game
        let consecutiveCount = 1;
        let j = i + 1;
        while (j < allDetections.length && allDetections[j].game === current.game && allDetections[j].provider === current.provider) {
          consecutiveCount++;
          j++;
        }

        // Only confirm if 3+ consecutive detections (≈3 minutes at 60s interval)
        if (consecutiveCount >= 3) {
          for (let k = i; k < j; k++) {
            confirmedDetections.push(allDetections[k]);
          }
        } else {
          // Mark isolated detections as noise — downgrade to not_casino
          for (let k = i; k < j; k++) {
            confirmedDetections.push({
              ...allDetections[k],
              category: 'not_casino',
              game: 'Noise/Outlier',
              confidence: 'low',
            });
          }
        }
        i = j;
      }

      // Build timeline from confirmed detections
      const SAMPLING_INTERVAL = 60; // 60-second intervals
      const gameTimeline: any[] = [];
      const casinoDetections = confirmedDetections.filter(d => d.category !== 'not_casino');

      if (casinoDetections.length > 0) {
        let seg = {
          game: casinoDetections[0].game,
          provider: casinoDetections[0].provider,
          category: casinoDetections[0].category,
          startSeconds: Math.max(0, casinoDetections[0].timestampSeconds - SAMPLING_INTERVAL / 2),
          endSeconds: casinoDetections[0].timestampSeconds + SAMPLING_INTERVAL / 2,
        };

        for (let idx = 1; idx < casinoDetections.length; idx++) {
          const det = casinoDetections[idx];
          if (det.game === seg.game && det.provider === seg.provider) {
            seg.endSeconds = det.timestampSeconds + SAMPLING_INTERVAL / 2;
          } else {
            gameTimeline.push({ ...seg, durationSeconds: Math.round(seg.endSeconds - seg.startSeconds) });
            seg = {
              game: det.game, provider: det.provider, category: det.category,
              startSeconds: det.timestampSeconds - SAMPLING_INTERVAL / 2,
              endSeconds: det.timestampSeconds + SAMPLING_INTERVAL / 2,
            };
          }
        }
        gameTimeline.push({ ...seg, durationSeconds: Math.round(seg.endSeconds - seg.startSeconds) });
      }

      // Unique confirmed games
      const uniqueGames = new Map<string, any>();
      for (const det of casinoDetections) {
        const key = `${det.game}|${det.provider}`;
        if (!uniqueGames.has(key)) uniqueGames.set(key, det);
      }

      return jsonResponse({
        games: Array.from(uniqueGames.values()),
        gameTimeline,
        totalSamples: allDetections.length,
        confirmedSamples: casinoDetections.length,
        filteredAsNoise: allDetections.length - confirmedDetections.length + confirmedDetections.filter(d => d.game === 'Noise/Outlier').length,
      });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error: unknown) {
    console.error('Twitch function error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: msg }, 500);
  }
});
