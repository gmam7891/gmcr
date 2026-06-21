import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/twitch';
const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

// === SAMPLING CONSTANTS (Surgical Audit Architecture) ===
const SAMPLE_INTERVAL_NORMAL = 15;       // 1 frame / 15s = 4 frames/min
const SAMPLE_INTERVAL_TRANSITION = 10;   // 1 frame / 10s in transition windows
const TRANSITION_WINDOW_SECONDS = 300;   // 5 minutes after a category change
const BATCH_SIZE = 5;
const CASINO_CATEGORY_HINTS = ['virtual casino', 'slots', 'casino', 'gambling'];

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const FORENSIC_SYSTEM_PROMPT = `Você é um auditor forense especializado em identificação de jogos de iGaming/Casino em transmissões ao vivo de streaming. Sua tarefa é realizar uma AUDITORIA VISUAL PRECISA de cada frame/imagem para detectar QUALQUER jogo de cassino online, de QUALQUER provedora existente no mercado.

## PRINCÍPIO FUNDAMENTAL:
Você deve identificar TODO e QUALQUER jogo de iGaming visível nos frames, independentemente da provedora. NÃO se limite a jogos conhecidos — se parecer um jogo de cassino (slot, mesa, crash, etc.), identifique-o pelo nome visível na tela e pela provedora se reconhecível.

## REGRAS DE ANÁLISE:
1. Analise TODOS os elementos visuais: HUD, logos, botões de spin/deal, saldo, multiplicadores, grid de slots, cartas, roleta, etc.
2. Se a imagem for uma FOLHA DE SPRITE (storyboard), analise CADA miniatura individualmente.
3. IGNORE completamente o título do VOD e a categoria da Twitch — analise APENAS o que é visível na imagem.
4. Se o streamer estiver ASSISTINDO conteúdo (player de vídeo, YouTube), classifique como "not_game".
5. Priorize detecção de HUD MINIMALISTA — muitos jogos modernos têm interfaces limpas.

## REGRA CRÍTICA: LEITURA DO NAVEGADOR
6. Se o streamer estiver JOGANDO VIA NAVEGADOR (URL visível, abas do Chrome/Firefox/Edge), LEIA O TÍTULO DA ABA DO NAVEGADOR para identificar o jogo. O título da aba frequentemente contém o nome exato do jogo.
7. Leia também a BARRA DE URL — pode conter o nome do jogo na URL (ex: "/slots/safari-so-good-assemblem").
8. O NOME DO CASSINO/PLATAFORMA pode estar visível no topo (ex: "SeuBet", "Betano", "Bet365") — isso confirma que é iGaming.

## REGRA CRÍTICA: HUDs ARTÍSTICOS / INTEGRADOS AO CENÁRIO
9. Alguns jogos têm HUD INTEGRADO AO CENÁRIO (botões de spin, saldo, aposta fazem parte da arte do jogo). NÃO ignore frames só porque não há HUD convencional separado.
10. Identifique elementos como: SALDO em R$/$/€, APOSTA/BET, GIROS/SPINS, MULTIPLICADORES (2x, 3x), WILD/SCATTER symbols, grid de símbolos.

## PROVEDORAS CONHECIDAS (lista NÃO exaustiva — identifique jogos de QUALQUER provedora, mesmo que não esteja listada):
Pragmatic Play, Relax Gaming, Hacksaw Gaming, PG Soft, Games Global (Microgaming + estúdios: Stormcraft, Triple Edge, JFTW, Foxium, Rabcat, Slingshot, Switch Studios, All41, Alchemy Gaming, Neon Valley, SpinPlay, Snowborn, Fortune Factory, Northern Lights), Evolution Gaming, Playtech, NetEnt, Play'n GO, BGaming, Amusnet/EGT, Endorphina, FA Chai, Push Gaming, Nolimit City, Red Tiger, Blueprint Gaming, Yggdrasil, Tada Gaming, Spribe, Turbo Games, SmartSoft, Wazdan, Booongo, Betsoft, Habanero, Quickspin, Thunderkick, ELK Studios, Iron Dog Studio, Big Time Gaming, iSoftBet, Kalamba Games, Peter & Sons, Avatar UX, Fantasma Games, TrueLab, Spinomenal, 1x2 Gaming, Evoplay, Platipus, Belatra, CT Gaming, Zillion Games, KA Gaming, Fugaso, Felix Gaming, Mancala Gaming, Gamzix, Popiplay, 3 Oaks Gaming, BetGames, Ezugi, Atmosfera, SA Gaming, Asia Gaming, Sexy Gaming, Dream Gaming, WM Casino, Vivo Gaming, Lucky Streak (live), Authentic Gaming, Bombay Live, TVBet, BetConstruct.

## ELEMENTOS VISUAIS A DETECTAR:
- Grids de slot (3x3, 5x3, 5x4, 6x5, Megaways dinâmico)
- Botões de SPIN, AUTO-SPIN, BET (incluindo ícones integrados ao cenário)
- Saldo (BALANCE/SALDO) em R$, $, €, aposta (BET/STAKE/APOSTA), ganho (WIN)
- Multiplicadores (x2, x5, x100, etc.)
- Logos de provedoras (geralmente no canto inferior)
- Mesas de casino ao vivo (roleta, blackjack, baccarat, game shows)
- Jogos crash (gráfico ascendente com multiplicador)
- Interfaces de Plinko, Mines, Dice, Keno, Hi-Lo
- WILDS, SCATTERS, BONUS symbols com animações
- Título do jogo no topo da interface do navegador ou na aba
- Qualquer interface que mostre apostas em dinheiro real

## FORMATO DE RESPOSTA (JSON array apenas):
[{"game": "nome_exato_do_jogo", "provider": "nome_provedora_ou_null_se_desconhecida", "category": "slots|live_casino|table_game|crash_game|not_game", "confidence": "high|medium|low", "evidence": "descrição breve do que foi detectado visualmente", "image_index": 0}]

IMPORTANTE:
- Se você não reconhecer a provedora, coloque "provider": "Unknown" e identifique o jogo pelo nome visível na tela.
- Se não conseguir ler o nome exato do jogo, descreva-o (ex: "Slot temática de piratas com grid 5x3").
- Retorne "evidence" com a descrição visual
- Se não for jogo (Just Chatting, navegador sem jogo, player de vídeo), retorne category "not_game"
- MESMO QUE APAREÇA EM APENAS 1 FRAME/MINIATURA, reporte o jogo.
- Retorne APENAS o JSON array, nenhum outro texto`;

const FORENSIC_RECOVERY_PROMPT = `Você é um auditor de iGaming. ESTAS IMAGENS pertencem a um período em que o streamer JÁ ESTAVA JOGANDO CASSINO (confirmado por estatísticas externas). NÃO use a categoria "not_game" — o jogo ESTÁ na tela; sua tarefa é IDENTIFICÁ-LO.

Procure por: grids de slot, botões SPIN, saldos em R$/$/€, multiplicadores, logo de provedora, abas de navegador, URL, ou descreva visualmente o jogo se o nome não for legível.

Responda em JSON array: [{"game":"...","provider":"...","category":"slots|live_casino|table_game|crash_game","confidence":"high|medium|low","evidence":"...","image_index":0}]`;

// ========= Helpers =========

async function callAI(messages: any[], apiKey: string, maxTokens = 8192) {
  return await fetch(AI_GATEWAY, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages, max_tokens: maxTokens }),
  });
}

function parseAIBatch(content: string): any[] {
  try {
    let clean = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { return JSON.parse(match[0]); } catch {
      const lastBrace = match[0].lastIndexOf('}');
      if (lastBrace > 0) {
        try { return JSON.parse(match[0].substring(0, lastBrace + 1) + ']'); } catch { return []; }
      }
    }
    return [];
  } catch { return []; }
}

function isCasinoCategory(name?: string | null): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return CASINO_CATEGORY_HINTS.some(k => lower.includes(k));
}

// Build adaptive sample timestamps from chapters (transition densification)
function buildAdaptiveTimestamps(durationSec: number, chapters: any[]): number[] {
  const timestamps = new Set<number>();

  // 1) Base: every SAMPLE_INTERVAL_NORMAL seconds across the whole VOD
  for (let t = 30; t < durationSec; t += SAMPLE_INTERVAL_NORMAL) timestamps.add(t);

  // 2) Transition densification: at every chapter start, add dense window
  if (Array.isArray(chapters)) {
    for (const ch of chapters) {
      const start = ch?.positionSeconds ?? 0;
      const windowEnd = Math.min(start + TRANSITION_WINDOW_SECONDS, durationSec);
      for (let t = start; t < windowEnd; t += SAMPLE_INTERVAL_TRANSITION) {
        timestamps.add(t);
      }
    }
  }

  return Array.from(timestamps).sort((a, b) => a - b);
}

// ========= Main handler =========

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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
          query: `query VodChapters($id: ID!) { video(id: $id) { lengthSeconds moments(momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { description positionMilliseconds durationMilliseconds details { ... on GameChangeMomentDetails { game { id displayName boxArtURL } } } } } } } }`,
          variables: { id: String(vod_id) },
        }),
      });
      const rawText = await gqlRes.text();
      console.log('[get_vod_chapters] vod_id=', vod_id, 'status=', gqlRes.status, 'body=', rawText.slice(0, 800));
      let gqlData: any = {};
      try { gqlData = JSON.parse(rawText); } catch (_) {}
      if (gqlData?.errors) console.warn('[get_vod_chapters] GQL errors:', JSON.stringify(gqlData.errors));
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
        body: JSON.stringify({ query: `query { video(id: "${vod_id}") { seekPreviewsURL } }` }),
      });
      const gqlData = await gqlRes.json();
      const seekPreviewsURL = gqlData?.data?.video?.seekPreviewsURL;
      if (!seekPreviewsURL) return jsonResponse({ storyboardUrls: [], interval: 0, error: 'No storyboard URL available' });

      const infoRes = await fetch(seekPreviewsURL);
      if (!infoRes.ok) return jsonResponse({ storyboardUrls: [], interval: 0, error: `Failed to fetch storyboard info: ${infoRes.status}` });

      const infoData = await infoRes.json();
      const highQuality = infoData.find((q: any) => q.quality === 'high') || infoData[0];
      if (!highQuality) return jsonResponse({ storyboardUrls: [], interval: 0, error: 'No storyboard quality data' });

      const baseUrl = seekPreviewsURL.replace(/[^/]+$/, '');
      const storyboardUrls = highQuality.images.map((img: string) => baseUrl + img);

      return jsonResponse({
        storyboardUrls, interval: highQuality.interval, cols: highQuality.cols, rows: highQuality.rows,
        width: highQuality.width, height: highQuality.height, count: highQuality.count,
        framesPerStrip: highQuality.cols * highQuality.rows,
      });
    }

    // ====================================================================
    // === SURGICAL VOD AUDIT (full pipeline w/ progress + SullyGnome) ====
    // ====================================================================
    if (action === 'analyze_vod_surgical') {
      const { thumbnail_url, vod_title, vod_duration_seconds, streamer_login, audit_id } = body;
      if (!thumbnail_url || !vod_duration_seconds || !streamer_login) {
        throw new Error('thumbnail_url, vod_duration_seconds, streamer_login required');
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const sb = createClient(supabaseUrl, supabaseKey);

      const totalMinutes = Math.round(vod_duration_seconds / 60);

      const updateProgress = async (patch: Record<string, any>) => {
        if (!audit_id) return;
        await sb.from('vod_audits').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', audit_id);
      };

      // === Phase 1: Fetch chapters (transition map) ===
      await updateProgress({ progress_phase: 'fetching_chapters', progress_message: 'Lendo capítulos da Twitch...', progress_total_minutes: totalMinutes });
      let chapters: any[] = [];
      try {
        const gqlRes = await fetch(GQL_URL, {
          method: 'POST',
          headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query VodChapters($id: ID!) { video(id: $id) { moments(momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { description positionMilliseconds durationMilliseconds details { ... on GameChangeMomentDetails { game { id displayName } } } } } } } }`,
            variables: { id: String(vod_id) },
          }),
        });
        const gqlData = await gqlRes.json();
        const moments = gqlData?.data?.video?.moments?.edges ?? [];
        chapters = moments.map((edge: any) => ({
          positionSeconds: Math.round(edge.node.positionMilliseconds / 1000),
          durationSeconds: Math.round(edge.node.durationMilliseconds / 1000),
          game: edge.node.details?.game?.displayName ?? edge.node.description,
        }));
      } catch (e) { console.warn('[SURGICAL] chapters failed:', e); }

      // === Phase 2: SullyGnome gabarito ===
      await updateProgress({ progress_phase: 'fetching_sullygnome', progress_message: 'Consultando SullyGnome (gabarito oficial)...' });
      let sullyData: any = null;
      try {
        const sullyRes = await sb.functions.invoke('sullygnome-scraper', {
          body: { action: 'scrape', streamer_login },
        });
        sullyData = sullyRes?.data || null;
      } catch (e) { console.warn('[SURGICAL] SullyGnome failed:', e); }
      await updateProgress({ sullygnome_snapshot: sullyData || {} });

      // === Phase 3: Build adaptive timestamps ===
      const timestamps = buildAdaptiveTimestamps(vod_duration_seconds, chapters);
      console.log(`[SURGICAL] Built ${timestamps.length} adaptive timestamps (normal=${SAMPLE_INTERVAL_NORMAL}s, transitions=${chapters.length})`);
      await updateProgress({ progress_phase: 'sampling', progress_message: `Amostragem adaptativa: ${timestamps.length} frames planejados` });

      // === Phase 4: Build thumbnail URLs at each timestamp ===
      const baseThumb = thumbnail_url.replace('%{width}', '1280').replace('%{height}', '720');
      const frameUrls = timestamps.map(ts => baseThumb.replace(/thumb\d*-\d+x\d+/, `thumb${ts}-1280x720`));

      // === Phase 5: Load Visual DNA ===
      let visualDnaContext = '';
      try {
        const { data: trainedGames } = await sb
          .from('game_visual_library')
          .select('game_name, provider_name, visual_dna')
          .eq('training_status', 'trained')
          .not('visual_dna', 'eq', '{}')
          .limit(200);
        if (trainedGames && trainedGames.length > 0) {
          const dnaEntries = trainedGames.map((g: any) => {
            const dna = g.visual_dna || {};
            const traits = dna.unique_traits ? dna.unique_traits.join('; ') : '';
            const keywords = dna.detection_keywords ? dna.detection_keywords.join(', ') : '';
            return `- "${g.game_name}" (${g.provider_name}): ${traits}${keywords ? ' | Keywords: ' + keywords : ''}`;
          }).join('\n');
          visualDnaContext = `\n\n## JOGOS TREINADOS (REFERÊNCIA VISUAL PRIORITÁRIA):\n${dnaEntries}`;
        }
      } catch {}

      const enhancedPrompt = FORENSIC_SYSTEM_PROMPT + visualDnaContext;

      // === Phase 6: Batch analysis with live progress ===
      const allDetections: any[] = [];
      const pendingAuditSegments: any[] = [];

      for (let i = 0; i < frameUrls.length; i += BATCH_SIZE) {
        const batchUrls = frameUrls.slice(i, i + BATCH_SIZE);
        const batchTs = timestamps.slice(i, i + BATCH_SIZE);
        const currentMinute = Math.round(batchTs[0] / 60);

        // Identify if this batch is in a known casino chapter (gabarito)
        const chapterAtBatch = chapters.find(ch =>
          batchTs[0] >= ch.positionSeconds &&
          batchTs[0] < (ch.positionSeconds + ch.durationSeconds)
        );
        const isKnownCasino = isCasinoCategory(chapterAtBatch?.game);

        // Live progress update
        const detectedSoFar = new Set(allDetections.filter(d => d.category !== 'not_game').map(d => `${d.game}|${d.provider}`)).size;
        await updateProgress({
          progress_phase: 'analyzing',
          progress_current_minute: currentMinute,
          progress_games_found: detectedSoFar,
          progress_message: `Analisando minuto ${currentMinute} de ${totalMinutes}... ${detectedSoFar} jogos detectados`,
        });

        const imageContent = batchUrls.map((url: string) => ({ type: "image_url", image_url: { url, detail: "high" } }));
        const tsHint = batchTs.map((t, ix) => `Image ${ix + 1}: ${Math.floor(t / 60)}min`).join(', ');

        const aiRes = await callAI([
          { role: 'system', content: enhancedPrompt },
          { role: 'user', content: [
            { type: "text", text: `AUDITORIA FORENSE de "${vod_title}". Identifique jogos. Timestamps: ${tsHint}` },
            ...imageContent,
          ] },
        ], LOVABLE_API_KEY);

        if (!aiRes.ok) { await aiRes.text(); continue; }
        const aiData = await aiRes.json();
        const batchGames = parseAIBatch(aiData?.choices?.[0]?.message?.content ?? '[]');

        // === SOVEREIGNTY: re-analyze if known-casino but AI says not_game ===
        const allNotGame = batchGames.length > 0 && batchGames.every((g: any) => g.category === 'not_game');
        let finalBatch = batchGames;

        if (isKnownCasino && (allNotGame || batchGames.length === 0)) {
          console.log(`[SURGICAL] Conflict at min ${currentMinute}: chapter=${chapterAtBatch?.game}, AI=not_game. Re-analyzing aggressively.`);
          const retryRes = await callAI([
            { role: 'system', content: FORENSIC_RECOVERY_PROMPT + visualDnaContext },
            { role: 'user', content: [
              { type: "text", text: `Período confirmado como ${chapterAtBatch?.game}. Identifique o jogo na tela.` },
              ...imageContent,
            ] },
          ], LOVABLE_API_KEY);

          if (retryRes.ok) {
            const retryData = await retryRes.json();
            const retryGames = parseAIBatch(retryData?.choices?.[0]?.message?.content ?? '[]');
            const stillFailing = retryGames.length === 0 || retryGames.every((g: any) => g.category === 'not_game');
            if (stillFailing) {
              // Flag for manual audit
              pendingAuditSegments.push({
                start_minute: currentMinute,
                chapter_category: chapterAtBatch?.game,
                frames: batchUrls,
                timestamps: batchTs,
                reason: 'AI_could_not_identify_in_known_casino_window',
              });
            } else {
              finalBatch = retryGames;
            }
          } else { await retryRes.text(); }
        }

        for (const g of finalBatch) {
          const imgIdx = g.image_index ?? 0;
          const ts = batchTs[imgIdx] ?? batchTs[0];
          allDetections.push({ ...g, timestampSeconds: ts });
        }

        if (i + BATCH_SIZE < frameUrls.length) await new Promise(r => setTimeout(r, 1000));
      }

      // === Phase 7: REAL TIME COUNT ===
      // TIME_TOTAL = (POSITIVE_FRAMES * SAMPLE_INTERVAL_NORMAL) / 60 minutes
      // Each detection represents one frame; we deduplicate per (game, timestamp).
      const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const byTimestamp = new Map<number, any[]>();
      for (const det of allDetections) {
        if (!byTimestamp.has(det.timestampSeconds)) byTimestamp.set(det.timestampSeconds, []);
        byTimestamp.get(det.timestampSeconds)!.push(det);
      }

      const deduped: any[] = [];
      for (const [_ts, dets] of byTimestamp) {
        const bestPerGame = new Map<string, any>();
        for (const d of dets) {
          const key = `${d.game}|${d.provider}`;
          const existing = bestPerGame.get(key);
          if (!existing || (confidenceRank[d.confidence] || 0) > (confidenceRank[existing.confidence] || 0)) {
            bestPerGame.set(key, d);
          }
        }
        deduped.push(...bestPerGame.values());
      }

      // Each positive frame = SAMPLE_INTERVAL_NORMAL seconds (rigorous)
      const gameMap = new Map<string, any>();
      for (const det of deduped) {
        if (det.category === 'not_game') continue;
        const key = `${det.game}|${det.provider}`;
        const existing = gameMap.get(key);
        if (existing) {
          existing.count += 1;
          existing.totalSeconds += SAMPLE_INTERVAL_NORMAL;
          if ((confidenceRank[det.confidence] || 0) > (confidenceRank[existing.confidence] || 0)) existing.confidence = det.confidence;
          if (!existing.evidence && det.evidence) existing.evidence = det.evidence;
        } else {
          gameMap.set(key, {
            game: det.game, provider: det.provider, category: det.category, confidence: det.confidence,
            evidence: det.evidence || null, count: 1, totalSeconds: SAMPLE_INTERVAL_NORMAL,
          });
        }
      }

      const uniqueGames = Array.from(gameMap.values()).map(g => ({
        game: g.game, provider: g.provider, category: g.category, confidence: g.confidence,
        evidence: g.evidence, detectionCount: g.count, totalSeconds: g.totalSeconds,
      })).sort((a, b) => b.totalSeconds - a.totalSeconds);

      const gameTimeline = deduped
        .filter(d => d.category !== 'not_game')
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map(d => ({
          game: d.game, provider: d.provider, category: d.category, evidence: d.evidence || null,
          startSeconds: d.timestampSeconds, endSeconds: d.timestampSeconds + SAMPLE_INTERVAL_NORMAL,
          durationSeconds: SAMPLE_INTERVAL_NORMAL,
        }));

      // Final progress update
      await updateProgress({
        progress_phase: 'completed',
        progress_current_minute: totalMinutes,
        progress_games_found: uniqueGames.length,
        progress_message: `Concluído: ${uniqueGames.length} jogos detectados em ${deduped.filter(d => d.category !== 'not_game').length} frames positivos`,
        pending_audit_segments: pendingAuditSegments,
        completed_at: new Date().toISOString(),
        status: pendingAuditSegments.length > 0 ? 'needs_review' : 'completed',
      });

      console.log(`[SURGICAL] DONE: ${uniqueGames.length} games, ${pendingAuditSegments.length} pending audits`);

      return jsonResponse({
        games: uniqueGames,
        gameTimeline,
        totalSamples: timestamps.length,
        positiveFrames: deduped.filter(d => d.category !== 'not_game').length,
        sampleDuration: SAMPLE_INTERVAL_NORMAL,
        pendingAuditSegments,
        sullygnome: sullyData,
      });
    }

    // === Legacy: analyze_vod_frames (kept for backward compat) ===
    if (action === 'analyze_vod_frames') {
      const { thumbnail_urls, vod_title, timestamps, sample_interval } = body;
      if (!thumbnail_urls || !Array.isArray(thumbnail_urls) || thumbnail_urls.length === 0) {
        throw new Error('thumbnail_urls array is required');
      }

      let visualDnaContext = '';
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        if (supabaseUrl && supabaseKey) {
          const sb = createClient(supabaseUrl, supabaseKey);
          const { data: trainedGames } = await sb
            .from('game_visual_library')
            .select('game_name, provider_name, visual_dna')
            .eq('training_status', 'trained')
            .not('visual_dna', 'eq', '{}')
            .limit(200);
          if (trainedGames && trainedGames.length > 0) {
            const dnaEntries = trainedGames.map((g: any) => {
              const dna = g.visual_dna || {};
              const traits = dna.unique_traits ? dna.unique_traits.join('; ') : '';
              const keywords = dna.detection_keywords ? dna.detection_keywords.join(', ') : '';
              return `- "${g.game_name}" (${g.provider_name}): ${traits}${keywords ? ' | Keywords: ' + keywords : ''}`;
            }).join('\n');
            visualDnaContext = `\n\n## JOGOS TREINADOS:\n${dnaEntries}`;
          }
        }
      } catch {}

      const enhancedPrompt = FORENSIC_SYSTEM_PROMPT + visualDnaContext;
      const hasTimestamps = timestamps && Array.isArray(timestamps) && timestamps.length === thumbnail_urls.length;
      const sampleDuration = sample_interval && sample_interval > 0 ? sample_interval : SAMPLE_INTERVAL_NORMAL;

      const allDetections: any[] = [];
      for (let batchStart = 0; batchStart < thumbnail_urls.length; batchStart += BATCH_SIZE) {
        const batchUrls = thumbnail_urls.slice(batchStart, batchStart + BATCH_SIZE);
        const batchTimestamps = hasTimestamps ? timestamps.slice(batchStart, batchStart + BATCH_SIZE) : [];
        const imageContent = batchUrls.map((url: string) => ({ type: "image_url", image_url: { url, detail: "high" } }));
        const aiRes = await callAI([
          { role: 'system', content: enhancedPrompt },
          { role: 'user', content: [
            { type: "text", text: `AUDITORIA FORENSE: Analise estas ${batchUrls.length} imagens.` },
            ...imageContent,
          ] },
        ], LOVABLE_API_KEY);

        if (!aiRes.ok) { await aiRes.text(); continue; }
        const aiData = await aiRes.json();
        const batchGames = parseAIBatch(aiData?.choices?.[0]?.message?.content ?? '[]');
        for (const g of batchGames) {
          const imgIdx = g.image_index ?? 0;
          const ts = hasTimestamps && batchTimestamps[imgIdx] != null ? batchTimestamps[imgIdx] : 0;
          allDetections.push({ ...g, timestampSeconds: ts });
        }
        if (batchStart + BATCH_SIZE < thumbnail_urls.length) await new Promise(r => setTimeout(r, 1200));
      }

      const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const byTimestamp = new Map<number, any[]>();
      for (const det of allDetections) {
        if (!byTimestamp.has(det.timestampSeconds)) byTimestamp.set(det.timestampSeconds, []);
        byTimestamp.get(det.timestampSeconds)!.push(det);
      }

      const deduped: any[] = [];
      for (const [_ts, dets] of byTimestamp) {
        const bestPerGame = new Map<string, any>();
        for (const d of dets) {
          const key = `${d.game}|${d.provider}`;
          const existing = bestPerGame.get(key);
          if (!existing || (confidenceRank[d.confidence] || 0) > (confidenceRank[existing.confidence] || 0)) {
            bestPerGame.set(key, d);
          }
        }
        deduped.push(...bestPerGame.values());
      }

      const gameCountMap = new Map<string, any>();
      for (const det of deduped) {
        if (det.category === 'not_game') continue;
        const key = `${det.game}|${det.provider}`;
        const existing = gameCountMap.get(key);
        if (existing) {
          existing.count += 1;
          existing.totalSeconds += sampleDuration;
          if ((confidenceRank[det.confidence] || 0) > (confidenceRank[existing.confidence] || 0)) existing.confidence = det.confidence;
          if (!existing.evidence && det.evidence) existing.evidence = det.evidence;
        } else {
          gameCountMap.set(key, {
            game: det.game, provider: det.provider, category: det.category, confidence: det.confidence,
            evidence: det.evidence || null, count: 1, totalSeconds: sampleDuration,
          });
        }
      }

      const gameTimeline: any[] = deduped
        .filter(d => d.category !== 'not_game')
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map(d => ({
          game: d.game, provider: d.provider, category: d.category, evidence: d.evidence || null,
          startSeconds: Math.max(0, d.timestampSeconds), endSeconds: Math.max(0, d.timestampSeconds) + sampleDuration,
          durationSeconds: sampleDuration,
        }));

      const uniqueGames = Array.from(gameCountMap.values()).map(g => ({
        game: g.game, provider: g.provider, category: g.category, confidence: g.confidence,
        evidence: g.evidence, detectionCount: g.count, totalSeconds: g.totalSeconds,
      }));

      return jsonResponse({ games: uniqueGames, gameTimeline, totalSamples: deduped.length, sampleDuration });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error: unknown) {
    console.error('Twitch function error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: msg }, 500);
  }
});
