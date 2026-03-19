import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/twitch';
const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

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

    // --- Twitch API proxy actions ---
    if (action === 'get_user') {
      const res = await fetch(`${GATEWAY_URL}/users?login=${encodeURIComponent(login)}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return jsonResponse(data);
    }

    if (action === 'get_stream') {
      const param = login ? `user_login=${encodeURIComponent(login)}` : `user_id=${user_id}`;
      const res = await fetch(`${GATEWAY_URL}/streams?${param}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return jsonResponse(data);
    }

    if (action === 'get_vods') {
      const count = vod_count || 20;
      const res = await fetch(`${GATEWAY_URL}/videos?user_id=${user_id}&first=${count}&type=archive`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return jsonResponse(data);
    }

    if (action === 'get_vod') {
      const res = await fetch(`${GATEWAY_URL}/videos?id=${vod_id}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Twitch API error [${res.status}]: ${JSON.stringify(data)}`);
      return jsonResponse(data);
    }

    // --- VOD chapters via GQL ---
    if (action === 'get_vod_chapters') {
      if (!vod_id) throw new Error('vod_id is required');
      const gqlQuery = {
        operationName: "VideoPlayer_ChapterSelectButtonVideo",
        variables: { videoID: String(vod_id) },
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

        return jsonResponse({
          avgViewers: values[0] ?? null,
          hoursWatched: values[1] ?? null,
          followersGained: values[2] ?? null,
          peakViewers: values[3] ?? null,
          hoursStreamed: values[4] ?? null,
          totalStreams: values[5] ?? null,
          streams: streamRows,
        });
      } catch (err) {
        console.error('SullyGnome scrape error:', err);
        return jsonResponse({ error: `SullyGnome scrape failed: ${err instanceof Error ? err.message : 'unknown'}`, avgViewers: null, peakViewers: null });
      }
    }

    // --- Deep VOD analysis with AI Vision ---
    if (action === 'analyze_vod_frames') {
      const { thumbnail_urls, vod_title, timestamps } = body;
      if (!thumbnail_urls || !Array.isArray(thumbnail_urls) || thumbnail_urls.length === 0) {
        throw new Error('thumbnail_urls array is required');
      }

      const hasTimestamps = timestamps && Array.isArray(timestamps) && timestamps.length === thumbnail_urls.length;

      // Process in batches of 8 images per AI call
      const BATCH_SIZE = 8;
      const allDetections: { game: string; provider: string | null; category: string; confidence: string; timestampSeconds: number }[] = [];

      for (let batchStart = 0; batchStart < thumbnail_urls.length; batchStart += BATCH_SIZE) {
        const batchUrls = thumbnail_urls.slice(batchStart, batchStart + BATCH_SIZE);
        const batchTimestamps = hasTimestamps ? timestamps.slice(batchStart, batchStart + BATCH_SIZE) : [];

        const imageContent = batchUrls.map((url: string, idx: number) => ({
          type: "image_url",
          image_url: { url, detail: "low" }
        }));

        const timestampLabels = hasTimestamps
          ? batchTimestamps.map((t: number, i: number) => `Screenshot ${i + 1}: timestamp ${Math.floor(t / 60)}m${t % 60}s`).join('\n')
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
                content: `You are an expert at identifying casino/slot games from stream screenshots. You MUST focus on these known providers and identify games from them:

PRIORITY PROVIDERS (check these first):
- Pragmatic Play (games: Gates of Olympus, Sweet Bonanza, Big Bass Bonanza, Sugar Rush, Starlight Princess, Dog House, Wolf Gold, etc.)
- Tada Gaming
- Games Global (formerly Microgaming - games: Immortal Romance, Mega Moolah, Thunderstruck, Book of Oz, etc.)
- BGaming (games: Elvis Frog, Aloha King Elvis, Space XY, etc.)
- Amusnet (formerly EGT - games: 40 Burning Hot, Rise of Ra, etc.)
- PG Soft (games: Fortune Tiger, Fortune Ox, Fortune Mouse, Mahjong Ways, etc.)
- Hacksaw Gaming (games: Wanted Dead or a Wild, Chaos Crew, IteroClassic, etc.)
- Playtech (games: Age of the Gods, Buffalo Blitz, etc.)
- Endorphina (games: Lucky Streak, Satoshi's Secret, etc.)
- FA Chai (games: Golden Empire, Boxing King, etc.)

For EACH screenshot, you must return one detection. Analyze carefully:
1. Look at the game UI, symbols, layout, logo, and any visible text
2. Match it to a specific game name and provider from the list above
3. If it's clearly a casino game but you can't identify the exact provider, use your best guess
4. If it's not a casino game, describe what's shown (e.g., "Just Chatting", "GTA V gameplay")

Return a JSON array with EXACTLY one object per screenshot in order:
[{"game": "name", "provider": "provider or null", "category": "slots|live_casino|table_game|not_casino", "confidence": "high|medium|low", "screenshot_index": 0}]
Only return the JSON array, no other text.`
              },
              {
                role: 'user',
                content: [
                  { type: "text", text: `Analyze these ${batchUrls.length} screenshots from the VOD "${vod_title || 'unknown'}". Identify each casino/slot game shown. ${timestampLabels ? 'Timestamps:\n' + timestampLabels : ''}` },
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
          continue; // Skip failed batch, continue with others
        }

        const aiData = await aiRes.json();
        const content = aiData?.choices?.[0]?.message?.content ?? '[]';

        try {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          const batchGames = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
          for (let i = 0; i < batchGames.length; i++) {
            const ts = hasTimestamps ? batchTimestamps[i] ?? 0 : 0;
            allDetections.push({ ...batchGames[i], timestampSeconds: ts });
          }
        } catch {
          console.error('Failed to parse AI batch response:', content);
        }

        // Small delay between batches to avoid rate limiting
        if (batchStart + BATCH_SIZE < thumbnail_urls.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Build timeline: group consecutive same-game detections into segments
      const gameTimeline: { game: string; provider: string | null; category: string; startSeconds: number; endSeconds: number; durationSeconds: number }[] = [];

      if (hasTimestamps && allDetections.length > 0) {
        // Sort by timestamp
        allDetections.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

        // Calculate interval between samples
        const interval = allDetections.length > 1
          ? (allDetections[allDetections.length - 1].timestampSeconds - allDetections[0].timestampSeconds) / (allDetections.length - 1)
          : 120;

        let currentSegment = {
          game: allDetections[0].game,
          provider: allDetections[0].provider,
          category: allDetections[0].category,
          startSeconds: Math.max(0, allDetections[0].timestampSeconds - interval / 2),
          endSeconds: allDetections[0].timestampSeconds + interval / 2,
        };

        for (let i = 1; i < allDetections.length; i++) {
          const det = allDetections[i];
          const isSameGame = det.game === currentSegment.game && det.provider === currentSegment.provider;

          if (isSameGame) {
            currentSegment.endSeconds = det.timestampSeconds + interval / 2;
          } else {
            gameTimeline.push({
              ...currentSegment,
              durationSeconds: Math.round(currentSegment.endSeconds - currentSegment.startSeconds),
            });
            currentSegment = {
              game: det.game,
              provider: det.provider,
              category: det.category,
              startSeconds: det.timestampSeconds - interval / 2,
              endSeconds: det.timestampSeconds + interval / 2,
            };
          }
        }
        // Push last segment
        gameTimeline.push({
          ...currentSegment,
          durationSeconds: Math.round(currentSegment.endSeconds - currentSegment.startSeconds),
        });
      }

      // Unique games list (deduplicated)
      const uniqueGames = new Map<string, typeof allDetections[0]>();
      for (const det of allDetections) {
        const key = `${det.game}|${det.provider}`;
        if (!uniqueGames.has(key)) {
          uniqueGames.set(key, det);
        }
      }

      return jsonResponse({
        games: Array.from(uniqueGames.values()),
        gameTimeline,
        totalSamples: allDetections.length,
        allDetections,
      });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error: unknown) {
    console.error('Twitch function error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: msg }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
