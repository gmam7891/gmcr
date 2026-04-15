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

const FORENSIC_SYSTEM_PROMPT = `Você é um auditor forense especializado em identificação de jogos de iGaming/Casino em transmissões ao vivo de streaming. Sua tarefa é realizar uma AUDITORIA VISUAL PRECISA de cada frame/imagem para detectar qualquer jogo de cassino online.

## REGRAS DE ANÁLISE:
1. Analise TODOS os elementos visuais: HUD, logos, botões de spin/deal, saldo, multiplicadores, grid de slots, cartas, roleta, etc.
2. Se a imagem for uma FOLHA DE SPRITE (storyboard), analise CADA miniatura individualmente.
3. IGNORE completamente o título do VOD e a categoria da Twitch — analise APENAS o que é visível na imagem.
4. Se o streamer estiver ASSISTINDO conteúdo (player de vídeo, navegador, YouTube), classifique como "not_game".
5. Priorize detecção de HUD MINIMALISTA — muitos jogos modernos têm interfaces limpas (Relax Gaming, Hacksaw).

## PROVEDORAS PRIORITÁRIAS (identifique jogos destas):
1. **Pragmatic Play**: Gates of Olympus, Sweet Bonanza, Big Bass Bonanza, Sugar Rush, Starlight Princess, Dog House, Wolf Gold, Fruit Party, Madame Destiny, The Hand of Midas, Gems Bonanza, John Hunter series, Release the Kraken, Buffalo King, Wild West Gold, Aztec Gems, Mustang Gold, Great Rhino
2. **Relax Gaming / Studios**: Money Train 1/2/3/4, Temple Tumble, Snake Arena, Dream Drop series, Hellcatraz, Book of 99, Iron Bank — HUD minimalista, foque no GRID de símbolos e botão de spin
3. **Hacksaw Gaming**: Wanted Dead or a Wild, Chaos Crew 1/2, Hand of Anubis, Stick 'Em, ItBro, Le Bandit, Gladiator Legends, RIP City — interface escura com grid distinto
4. **PG Soft**: Fortune Tiger, Fortune Ox, Fortune Mouse, Fortune Rabbit, Mahjong Ways 1/2/3, Ganesha Fortune, Dragon Hatch, Treasures of Aztec
5. **Games Global / Microgaming** (incluindo TODOS os estúdios: Stormcraft, Triple Edge, JFTW, Foxium, Rabcat, etc.): Immortal Romance, Mega Moolah, Thunderstruck, Book of Oz, Lara Croft, 9 Masks of Fire, Hyper Gold, Amazing Link
6. **Evolution Gaming**: Lightning Roulette, Crazy Time, Monopoly Live, Dream Catcher, Lightning Blackjack, XXXtreme Lightning Roulette, Funky Time, Cash or Crash
7. **Playtech**: Age of the Gods series, Buffalo Blitz, Great Blue, Gladiator, Adventures Beyond Wonderland
8. **NetEnt**: Starburst, Gonzo's Quest, Dead or Alive 1/2, Divine Fortune, Mega Fortune, Narcos
9. **Play'n GO**: Book of Dead, Reactoonz 1/2, Rise of Olympus, Moon Princess, Fire Joker, Rich Wilde series
10. **BGaming**: Elvis Frog series, Aloha King Elvis, Space XY, Plinko, Crash, Lucky Lady Moon
11. **Amusnet / EGT**: 40 Burning Hot, Rise of Ra, Shining Crown, Supreme Hot, Amazons' Battle
12. **Endorphina**: Lucky Streak, Satoshi's Secret, Chance Machine, Lucky Lands, Cash Tank
13. **FA Chai**: Golden Empire, Boxing King, Lucky Coming, Super Ace
14. **Push Gaming**: Jammin' Jars 1/2, Fat Rabbit, Razor Shark, Big Bamboo, Ice Lobster
15. **Nolimit City**: Mental, San Quentin, Tombstone, Fire in the Hole, Punk Rocker, East Coast vs West Coast
16. **Red Tiger**: Gonzo's Quest Megaways, Piggy Riches, Dragon's Fire, Mystery Reels
17. **Blueprint Gaming**: Eye of Horus, Fishin' Frenzy, Buffalo Rising
18. **Yggdrasil**: Vikings Go Berzerk, Valley of the Gods, Jackpot Raiders
19. **Tada Gaming**: vários jogos de estilo asiático
20. **Spribe**: Aviator, Mines, Plinko, Dice, Hi-Lo — jogos crash/instant
21. **Turbo Games / SmartSoft**: JetX, Cappadocia, Balloon — jogos crash

## ELEMENTOS VISUAIS A DETECTAR:
- Grids de slot (3x3, 5x3, 6x5, Megaways)
- Botões de SPIN, AUTO-SPIN, BET
- Saldo (BALANCE), aposta (BET/STAKE), ganho (WIN)
- Multiplicadores (x2, x5, x100, etc.)
- Logos de provedoras (geralmente no canto inferior)
- Mesas de casino ao vivo (roleta, blackjack, baccarat)
- Jogos crash (gráfico ascendente com multiplicador)
- Interfaces de Plinko, Mines, Dice

## FORMATO DE RESPOSTA (JSON array apenas):
[{"game": "nome_exato_do_jogo", "provider": "nome_provedora", "category": "slots|live_casino|table_game|crash_game|not_game", "confidence": "high|medium|low", "evidence": "descrição breve do que foi detectado visualmente", "image_index": 0}]

IMPORTANTE:
- Retorne "evidence" com a descrição visual (ex: "Logo Pragmatic Play visível no canto inferior, grid 5x3 com símbolos de frutas, botão SPIN verde")
- Para HUD minimalista, descreva os elementos que levaram à identificação
- Se não for jogo (Just Chatting, navegador, player de vídeo), retorne category "not_game"
- Retorne APENAS o JSON array, nenhum outro texto`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return jsonResponse({ error: 'LOVABLE_API_KEY not configured' }, 500);

  const TWITCH_API_KEY = Deno.env.get('TWITCH_API_KEY');
  if (!TWITCH_API_KEY) return jsonResponse({ error: 'TWITCH_API_KEY not configured' }, 500);

  const twitchHeaders = {
    'Authorization': `Bearer ${LOVABLE_API_KEY}`,
    'X-Connection-Api-Key': TWITCH_API_KEY,
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
      // Prefer "high" quality, fallback to any available
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

    // --- Deep VOD analysis with AI Vision (FORENSIC AUDIT) ---
    if (action === 'analyze_vod_frames') {
      const { thumbnail_urls, vod_title, timestamps, sample_interval } = body;
      if (!thumbnail_urls || !Array.isArray(thumbnail_urls) || thumbnail_urls.length === 0) {
        throw new Error('thumbnail_urls array is required');
      }

      const hasTimestamps = timestamps && Array.isArray(timestamps) && timestamps.length === thumbnail_urls.length;
      // Each detection = one sample worth of time. Default 60s, but storyboards pass the real interval.
      const sampleDuration = sample_interval && sample_interval > 0 ? sample_interval : 60;

      // Process in batches of 5 images per AI call for better accuracy
      const BATCH_SIZE = 5;
      const allDetections: { game: string; provider: string | null; category: string; confidence: string; evidence?: string; timestampSeconds: number }[] = [];

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

        console.log(`[FORENSIC] Batch ${batchStart}: Analyzing ${batchUrls.length} frames...`);

        const aiRes = await fetch(AI_GATEWAY, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: FORENSIC_SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: "text", text: `AUDITORIA FORENSE: Analise estas ${batchUrls.length} imagens do VOD "${vod_title || 'unknown'}". Identifique TODOS os jogos de casino/iGaming visíveis com evidências visuais detalhadas. Foque em HUD, logos, botões e elementos de interface mesmo que minimalistas.${timestampInfo}` },
                  ...imageContent
                ]
              }
            ],
            max_tokens: 4000,
          }),
        });

        if (!aiRes.ok) {
          const errText = await aiRes.text();
          console.error(`[FORENSIC] AI batch error [${aiRes.status}]:`, errText);
          if (aiRes.status === 413 || aiRes.status === 400) {
            console.log(`[FORENSIC] Retrying batch ${batchStart} with low detail...`);
            const retryRes = await fetch(AI_GATEWAY, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  { role: 'system', content: FORENSIC_SYSTEM_PROMPT },
                  {
                    role: 'user',
                    content: [
                      { type: "text", text: `AUDITORIA FORENSE: Analise estas ${batchUrls.length} imagens. Identifique jogos de casino visíveis.${timestampInfo}` },
                      ...batchUrls.map((url: string) => ({ type: "image_url", image_url: { url, detail: "low" } }))
                    ]
                  }
                ],
                max_tokens: 3000,
              }),
            });
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              const retryContent = retryData?.choices?.[0]?.message?.content ?? '[]';
              try {
                const jsonMatch = retryContent.match(/\[[\s\S]*\]/);
                const batchGames = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
                for (const g of batchGames) {
                  const imgIdx = g.image_index ?? 0;
                  const ts = hasTimestamps && batchTimestamps[imgIdx] != null ? batchTimestamps[imgIdx] : 0;
                  allDetections.push({ ...g, timestampSeconds: ts });
                }
              } catch { /* skip */ }
            } else {
              await retryRes.text();
            }
          }
          continue;
        }

        const aiData = await aiRes.json();
        const content = aiData?.choices?.[0]?.message?.content ?? '[]';

        try {
          console.log(`[FORENSIC] Raw AI response (batch ${batchStart}):`, content.slice(0, 500));
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          const batchGames = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
          console.log(`[FORENSIC] Parsed ${batchGames.length} detections:`, JSON.stringify(batchGames.map((g: any) => ({
            game: g.game, provider: g.provider, category: g.category, confidence: g.confidence, evidence: g.evidence?.slice(0, 80)
          }))));
          for (const g of batchGames) {
            const imgIdx = g.image_index ?? 0;
            const ts = hasTimestamps && batchTimestamps[imgIdx] != null ? batchTimestamps[imgIdx] : 0;
            allDetections.push({ ...g, timestampSeconds: ts });
          }
        } catch {
          console.error('[FORENSIC] Failed to parse AI response:', content.slice(0, 300));
        }

        if (batchStart + BATCH_SIZE < thumbnail_urls.length) {
          await new Promise(r => setTimeout(r, 1200));
        }
      }

      // === NEW: Per-detection time calculation ===
      // Handle overlapping detections at the same timestamp: keep highest confidence
      const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const byTimestamp = new Map<number, typeof allDetections>();
      for (const det of allDetections) {
        const ts = det.timestampSeconds;
        if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
        byTimestamp.get(ts)!.push(det);
      }

      // Deduplicate: at each timestamp, keep only one detection per game (highest confidence)
      const deduped: typeof allDetections = [];
      for (const [_ts, dets] of byTimestamp) {
        const bestPerGame = new Map<string, typeof allDetections[0]>();
        for (const d of dets) {
          const key = `${d.game}|${d.provider}`;
          const existing = bestPerGame.get(key);
          if (!existing || (confidenceRank[d.confidence] || 0) > (confidenceRank[existing.confidence] || 0)) {
            bestPerGame.set(key, d);
          }
        }
        deduped.push(...bestPerGame.values());
      }

      // Count detections per game and calculate time = count * sampleDuration
      const gameCountMap = new Map<string, { game: string; provider: string | null; category: string; confidence: string; evidence: string | null; count: number; totalSeconds: number }>();
      for (const det of deduped) {
        const key = `${det.game}|${det.provider}`;
        const existing = gameCountMap.get(key);
        if (existing) {
          existing.count += 1;
          existing.totalSeconds += sampleDuration;
          // Keep highest confidence
          if ((confidenceRank[det.confidence] || 0) > (confidenceRank[existing.confidence] || 0)) {
            existing.confidence = det.confidence;
          }
          if (!existing.evidence && det.evidence) existing.evidence = det.evidence;
        } else {
          gameCountMap.set(key, {
            game: det.game,
            provider: det.provider,
            category: det.category,
            confidence: det.confidence,
            evidence: det.evidence || null,
            count: 1,
            totalSeconds: sampleDuration,
          });
        }
      }

      // Build timeline segments from sorted detections for visualization
      const gameTimeline: any[] = [];
      const sortedDeduped = [...deduped].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
      for (const det of sortedDeduped) {
        const startSec = Math.max(0, det.timestampSeconds);
        gameTimeline.push({
          game: det.game,
          provider: det.provider,
          category: det.category,
          evidence: det.evidence || null,
          startSeconds: startSec,
          endSeconds: startSec + sampleDuration,
          durationSeconds: sampleDuration,
        });
      }

      // Unique games with detection count and real total time
      const uniqueGames = Array.from(gameCountMap.values()).map(g => ({
        game: g.game,
        provider: g.provider,
        category: g.category,
        confidence: g.confidence,
        evidence: g.evidence,
        detectionCount: g.count,
        totalSeconds: g.totalSeconds,
      }));

      console.log(`[FORENSIC] TOTAL: ${allDetections.length} raw detections, ${deduped.length} deduped, ${uniqueGames.length} unique games, sampleDuration=${sampleDuration}s`);
      console.log(`[FORENSIC] Per-game times:`, JSON.stringify(uniqueGames.map(g => ({ game: g.game, count: g.detectionCount, totalSec: g.totalSeconds }))));

      return jsonResponse({
        games: uniqueGames,
        gameTimeline,
        totalSamples: deduped.length,
        sampleDuration,
      });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error: unknown) {
    console.error('Twitch function error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: msg }, 500);
  }
});
