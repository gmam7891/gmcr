// ============================================================================
// VOD Watcher AI — Autonomous Background Agent
// ----------------------------------------------------------------------------
// Runs the surgical audit asynchronously. The user can close the page and the
// agent keeps processing. Self-invokes in chunks so each HTTP call stays
// inside the edge function timeout.
//
// Actions:
//   - start(vod_id, streamer_login, vod_duration_seconds, thumbnail_url, vod_title)
//   - resume(audit_id) — internal self-invoke
//   - report(audit_id) — generate consolidated audit report
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

const SAMPLE_INTERVAL = 15;            // seconds — 4 frames/min (rigorous)
const FRAMES_PER_CHUNK = 60;           // 60 frames per HTTP invocation = 15 min of VOD
const BATCH_SIZE = 5;                  // images per AI call
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

const FORENSIC_PROMPT = `Você é um auditor forense de iGaming/Casino em VODs de streaming.

REGRAS:
1. Analise CADA imagem individualmente. Identifique TODO jogo de cassino visível (slot, mesa, crash, live).
2. IGNORE título e categoria da Twitch — analise APENAS a tela.
3. SOBERANIA DA IA: Se o streamer está em "Just Chatting" mas a tela mostra um slot, REGISTRE o jogo (não diga not_game).
4. Se o streamer estiver assistindo conteúdo (player de vídeo), classifique "not_game".
5. Se houver navegador, leia URL e título da aba para identificar o jogo.

PROVEDORAS (lista parcial — identifique TODAS): Pragmatic Play, Relax Gaming, PG Soft, Hacksaw, Push Gaming, NetEnt, Play'n GO, Nolimit City, Red Tiger, Yggdrasil, Evolution, Playtech, BGaming, Spribe, Turbo Games, ELK, Big Time Gaming, Wazdan, Booongo, Habanero, Quickspin, Thunderkick, Fantasma, Avatar UX, Spinomenal, 3 Oaks Gaming, Ezugi, Atmosfera.

EXTRAÇÃO VISUAL EXTRA (somente quando category != "not_game"):
- balance: saldo visível na tela (ex: "R$ 1.234,56", "$500", null se não visível)
- bet_amount: valor da aposta atual (ex: "R$ 5,00", null)
- bonus_hud: true se HUD de bônus/free spins/multiplicador estiver visível
- free_spins_active: true se rodadas grátis ativas
- big_win_banner: true se animação/banner de big win/mega win visível

RESPONDA APENAS JSON ARRAY:
[{"game":"nome","provider":"provedora_ou_Unknown","category":"slots|live_casino|table_game|crash_game|not_game","confidence":"high|medium|low","evidence":"o que viu","image_index":0,"balance":null,"bet_amount":null,"bonus_hud":false,"free_spins_active":false,"big_win_banner":false}]`;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseAIBatch(content: string): any[] {
  try {
    const clean = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { return JSON.parse(match[0]); } catch {
      const lastBrace = match[0].lastIndexOf("}");
      if (lastBrace > 0) {
        try { return JSON.parse(match[0].substring(0, lastBrace + 1) + "]"); } catch { return []; }
      }
      return [];
    }
  } catch { return []; }
}

async function callAI(messages: any[]): Promise<any[]> {
  const res = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages, max_tokens: 8192 }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn(`[Watcher] AI call failed [${res.status}]: ${txt.slice(0, 200)}`);
    return [];
  }
  const data = await res.json();
  return parseAIBatch(data?.choices?.[0]?.message?.content ?? "[]");
}

async function fetchChapters(vodId: string): Promise<any[]> {
  try {
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: { "Client-ID": GQL_CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "VideoPlayer_ChapterSelectButtonVideo",
        variables: { videoID: String(vodId) },
        extensions: { persistedQuery: { version: 1, sha256Hash: "8d2793384aac3773beab5e59bd5d6f585aedb923d292800571571c2d1f41881c" } },
      }),
    });
    const data = await res.json();
    const moments = data?.data?.video?.moments?.edges ?? [];
    return moments.map((edge: any) => ({
      positionSeconds: Math.round(edge.node.positionMilliseconds / 1000),
      durationSeconds: Math.round(edge.node.durationMilliseconds / 1000),
      game: edge.node.details?.game?.displayName ?? edge.node.description,
    }));
  } catch (e) {
    console.warn("[Watcher] chapter fetch failed:", e);
    return [];
  }
}

function buildThumbUrl(baseThumb: string, ts: number): string {
  return baseThumb.replace(/thumb\d*-\d+x\d+/, `thumb${ts}-1280x720`);
}

async function selfInvokeResume(auditId: string) {
  // Fire-and-forget HTTP call back to ourselves to process the next chunk
  const url = `${SUPABASE_URL}/functions/v1/vod-watcher-agent`;
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ action: "resume", audit_id: auditId }),
  }).catch((e) => console.warn("[Watcher] self-invoke failed:", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!LOVABLE_API_KEY) return jsonResponse({ error: "LOVABLE_API_KEY not configured" }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: "Supabase env not configured" }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  const { action } = body;

  // ─────────────────────────────────────────────────────────────────────────
  // ACTION: start — create audit row and kick off background processing
  // ─────────────────────────────────────────────────────────────────────────
  if (action === "start") {
    const { vod_id, streamer_login, vod_duration_seconds, thumbnail_url, vod_title } = body;
    if (!vod_id || !streamer_login || !vod_duration_seconds || !thumbnail_url) {
      return jsonResponse({ error: "vod_id, streamer_login, vod_duration_seconds, thumbnail_url required" }, 400);
    }

    // Build full timestamp plan (rigorous: every 15s)
    const totalMinutes = Math.round(vod_duration_seconds / 60);
    const timestamps: number[] = [];
    for (let t = 30; t < vod_duration_seconds; t += SAMPLE_INTERVAL) timestamps.push(t);

    // Fetch chapters quickly (cheap GraphQL call, ~1s). SullyGnome is deferred to background.
    let chapters: any[] = [];
    try {
      chapters = await Promise.race([
        fetchChapters(vod_id),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000)),
      ]);
    } catch (e) { console.warn("[Watcher] chapters fetch error:", e); }

    // Upsert audit row IMMEDIATELY (idempotent: re-runs on same VOD reset progress)
    const auditPayload = {
      vod_id,
      streamer_login,
      platform: "twitch",
      status: "processing" as const,
      vod_duration_seconds: Math.round(vod_duration_seconds),
      expected_frames: timestamps.length,
      processed_frames: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      error_message: null,
      progress_phase: "starting",
      progress_total_minutes: totalMinutes,
      progress_current_minute: 0,
      progress_games_found: 0,
      progress_message: `Plano: ${timestamps.length} frames | ${chapters.length} capítulos`,
      sullygnome_snapshot: {},
      pending_audit_segments: {
        plan: {
          timestamps,
          chapters,
          thumbnail_url,
          vod_title: vod_title || "",
          processed_until: 0,
        },
        flagged: [],
      } as any,
    };

    const { data: auditRow, error: auditErr } = await sb
      .from("vod_audits")
      .upsert(auditPayload, { onConflict: "vod_id,platform" })
      .select("id")
      .single();

    if (auditErr || !auditRow) {
      console.error("[Watcher] failed to upsert audit:", auditErr);
      return jsonResponse({ error: `Failed to create audit: ${auditErr?.message}` }, 500);
    }

    // Defer SullyGnome scraping to background (don't block start response)
    EdgeRuntime.waitUntil((async () => {
      try {
        const sully = await sb.functions.invoke("sullygnome-scraper", {
          body: { action: "scrape", streamer_login },
        });
        if (sully?.data) {
          await sb.from("vod_audits").update({ sullygnome_snapshot: sully.data })
            .eq("id", auditRow.id);
        }
      } catch (e) { console.warn("[Watcher] SullyGnome background fetch failed:", e); }
    })());

    // Kick off background processing
    selfInvokeResume(auditRow.id);

    return jsonResponse({
      audit_id: auditRow.id,
      total_frames: timestamps.length,
      total_minutes: totalMinutes,
      chapters: chapters.length,
      message: "Agente iniciado em background — feche a página, ele continua processando.",
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACTION: resume — process next chunk and self-invoke if more remains
  // ─────────────────────────────────────────────────────────────────────────
  if (action === "resume") {
    const { audit_id } = body;
    if (!audit_id) return jsonResponse({ error: "audit_id required" }, 400);

    const { data: audit, error: loadErr } = await sb
      .from("vod_audits")
      .select("*")
      .eq("id", audit_id)
      .single();

    if (loadErr || !audit) return jsonResponse({ error: "audit not found" }, 404);
    if (audit.status === "completed" || audit.status === "failed") {
      return jsonResponse({ status: audit.status, message: "already finished" });
    }

    const segments = (audit.pending_audit_segments as any) || {};
    const plan = segments.plan;
    const flagged: any[] = segments.flagged || [];
    if (!plan) {
      await sb.from("vod_audits").update({
        status: "failed",
        error_message: "Plano de execução não encontrado",
        completed_at: new Date().toISOString(),
      }).eq("id", audit_id);
      return jsonResponse({ error: "no plan" }, 500);
    }

    const { timestamps, chapters, thumbnail_url, vod_title, processed_until } = plan;
    const totalMinutes = Math.round(audit.vod_duration_seconds / 60);
    const baseThumb = thumbnail_url.replace("%{width}", "1280").replace("%{height}", "720");

    const startIdx = processed_until || 0;
    const endIdx = Math.min(startIdx + FRAMES_PER_CHUNK, timestamps.length);

    if (startIdx >= timestamps.length) {
      // Already done — mark complete
      await finalizeAudit(sb, audit, flagged);
      return jsonResponse({ status: "completed" });
    }

    console.log(`[Watcher ${audit_id}] processing frames ${startIdx}-${endIdx} of ${timestamps.length}`);

    // Process this chunk in BATCH_SIZE batches
    for (let i = startIdx; i < endIdx; i += BATCH_SIZE) {
      const batchTs = timestamps.slice(i, Math.min(i + BATCH_SIZE, endIdx));
      const batchUrls = batchTs.map((ts: number) => buildThumbUrl(baseThumb, ts));
      const currentMinute = Math.round(batchTs[0] / 60);

      // Identify if in known-casino chapter (gabarito)
      const chapterAtBatch = chapters.find((ch: any) =>
        batchTs[0] >= ch.positionSeconds && batchTs[0] < (ch.positionSeconds + ch.durationSeconds),
      );
      const chapterCategory = chapterAtBatch?.game || "Unknown";

      const imageContent = batchUrls.map((url: string) => ({ type: "image_url", image_url: { url, detail: "high" } }));
      const tsHint = batchTs.map((t: number, ix: number) => `Image ${ix + 1}: ${Math.floor(t / 60)}min`).join(", ");

      let detections = await callAI([
        { role: "system", content: FORENSIC_PROMPT },
        { role: "user", content: [
          { type: "text", text: `VOD: "${vod_title}". Categoria Twitch: ${chapterCategory}. ${tsHint}` },
          ...imageContent,
        ] },
      ]);

      // SOVEREIGNTY: if in known casino chapter and AI says all not_game, retry aggressive
      const casinoHints = ["virtual casino", "slots", "casino", "gambling"];
      const isCasinoChapter = casinoHints.some((k) => chapterCategory.toLowerCase().includes(k));
      const allNotGame = detections.length > 0 && detections.every((d: any) => d.category === "not_game");

      if (isCasinoChapter && (detections.length === 0 || allNotGame)) {
        const retry = await callAI([
          { role: "system", content: FORENSIC_PROMPT + "\n\nESTAS IMAGENS SÃO DE PERÍODO CONFIRMADO COMO CASSINO. NÃO USE not_game. IDENTIFIQUE O JOGO." },
          { role: "user", content: [
            { type: "text", text: `Período confirmado: ${chapterCategory}. Identifique o jogo.` },
            ...imageContent,
          ] },
        ]);
        if (retry.length > 0 && !retry.every((d: any) => d.category === "not_game")) {
          detections = retry;
        } else {
          flagged.push({
            start_minute: currentMinute,
            chapter_category: chapterCategory,
            frames: batchUrls,
            timestamps: batchTs,
            reason: "AI_could_not_identify_in_known_casino_window",
          });
        }
      }

      // Persist each detection as a stream_snapshot (ai_evidence enrichment)
      const snapshotRows: any[] = [];
      for (const det of detections) {
        const imgIdx = det.image_index ?? 0;
        const ts = batchTs[imgIdx] ?? batchTs[0];
        snapshotRows.push({
          streamer_login: audit.streamer_login,
          captured_at: new Date(Date.now()).toISOString(),
          is_live: false,
          stream_title: vod_title || null,
          game_name: det.game || null,
          viewer_count: 0,
          ai_evidence: det.evidence ? `[${ts}s] ${det.evidence} (provider=${det.provider || "?"})` : null,
          ai_confidence: det.confidence === "high" ? 0.95 : det.confidence === "medium" ? 0.7 : 0.4,
          is_ai_verified: det.category !== "not_game",
        });
      }
      if (snapshotRows.length > 0) {
        const { error: snapErr } = await sb.from("stream_snapshots").insert(snapshotRows);
        if (snapErr) console.warn("[Watcher] snapshot insert failed:", snapErr.message);
      }

      // Persist as raw_evidences (for the existing pipeline + reports)
      const evidenceRows = detections
        .filter((d: any) => d.category !== "not_game")
        .map((det: any) => {
          const imgIdx = det.image_index ?? 0;
          const ts = batchTs[imgIdx] ?? batchTs[0];
          return {
            vod_id: audit.vod_id,
            streamer_login: audit.streamer_login,
            platform: "twitch",
            source_type: "vod",
            timestamp_seconds: ts,
            game_detected: det.game || null,
            provider_detected: det.provider || null,
            confidence_score: det.confidence === "high" ? 0.95 : det.confidence === "medium" ? 0.7 : 0.4,
            is_valid: true,
            validation_status: "ai_detected",
            extra_metadata: {
              category: det.category || null,
              balance: det.balance ?? null,
              bet_amount: det.bet_amount ?? null,
              bonus_hud: det.bonus_hud === true,
              free_spins_active: det.free_spins_active === true,
              big_win_banner: det.big_win_banner === true,
              evidence_text: det.evidence || null,
              chapter_category: chapterCategory,
            },
          };
        });
      if (evidenceRows.length > 0) {
        await sb.from("raw_evidences").insert(evidenceRows);
      }
    }

    // Update progress + plan
    const newProcessed = endIdx;
    const currentMin = Math.round((timestamps[Math.min(endIdx, timestamps.length - 1)] || 0) / 60);

    // Count games detected so far
    const { data: gamesCount } = await sb
      .from("raw_evidences")
      .select("game_detected", { count: "exact", head: false })
      .eq("vod_id", audit.vod_id)
      .not("game_detected", "is", null);
    const uniqueGames = new Set((gamesCount || []).map((r: any) => r.game_detected)).size;

    plan.processed_until = newProcessed;
    await sb.from("vod_audits").update({
      progress_phase: "analyzing",
      progress_current_minute: currentMin,
      progress_games_found: uniqueGames,
      progress_message: `Agente assistindo... minuto ${currentMin}/${totalMinutes} | ${uniqueGames} jogos detectados`,
      processed_frames: newProcessed,
      pending_audit_segments: { plan, flagged } as any,
    }).eq("id", audit_id);

    // If more remains, self-invoke
    if (newProcessed < timestamps.length) {
      selfInvokeResume(audit_id);
      return jsonResponse({
        status: "chunk_done",
        processed: newProcessed,
        total: timestamps.length,
      });
    }

    // Otherwise finalize
    await finalizeAudit(sb, audit, flagged);
    return jsonResponse({ status: "completed" });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACTION: report — consolidated audit report
  // ─────────────────────────────────────────────────────────────────────────
  if (action === "report") {
    const { audit_id } = body;
    if (!audit_id) return jsonResponse({ error: "audit_id required" }, 400);

    const { data: audit } = await sb.from("vod_audits").select("*").eq("id", audit_id).single();
    if (!audit) return jsonResponse({ error: "audit not found" }, 404);

    const { data: evidences } = await sb
      .from("raw_evidences")
      .select("game_detected, provider_detected, timestamp_seconds, confidence_score")
      .eq("vod_id", audit.vod_id)
      .not("game_detected", "is", null);

    // Group by game
    const byGame = new Map<string, { game: string; provider: string; frames: number; seconds: number; avgConfidence: number; }>();
    for (const ev of evidences || []) {
      const key = `${ev.game_detected}|${ev.provider_detected || "Unknown"}`;
      const existing = byGame.get(key);
      if (existing) {
        existing.frames += 1;
        existing.seconds += SAMPLE_INTERVAL;
        existing.avgConfidence = (existing.avgConfidence * (existing.frames - 1) + (ev.confidence_score || 0)) / existing.frames;
      } else {
        byGame.set(key, {
          game: ev.game_detected!,
          provider: ev.provider_detected || "Unknown",
          frames: 1,
          seconds: SAMPLE_INTERVAL,
          avgConfidence: ev.confidence_score || 0,
        });
      }
    }

    const games = Array.from(byGame.values()).sort((a, b) => b.seconds - a.seconds);
    const totalCasinoSeconds = games.reduce((s, g) => s + g.seconds, 0);
    const vodDuration = audit.vod_duration_seconds || 0;
    const otherSeconds = Math.max(0, vodDuration - totalCasinoSeconds);

    const fmt = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.round((sec % 3600) / 60);
      return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
    };

    const summaryLines = games
      .filter((g) => g.frames >= 2) // only show games with at least 30s
      .map((g) => `${fmt(g.seconds)} de ${g.game}${g.provider !== "Unknown" ? ` (${g.provider})` : ""}`)
      .slice(0, 10);

    const summary = `O streamer "${audit.streamer_login}" jogou ${fmt(vodDuration)}, sendo ${fmt(totalCasinoSeconds)} de jogos de cassino e ${fmt(otherSeconds)} de Conteúdo Geral. Detalhe: ${summaryLines.join(", ")}.`;

    return jsonResponse({
      audit_id,
      vod_id: audit.vod_id,
      streamer_login: audit.streamer_login,
      vod_duration_seconds: vodDuration,
      total_casino_seconds: totalCasinoSeconds,
      total_other_seconds: otherSeconds,
      games,
      summary,
      sullygnome: audit.sullygnome_snapshot,
      pending_audits: ((audit.pending_audit_segments as any)?.flagged || []).length,
    });
  }

  return jsonResponse({ error: "Unknown action. Use start | resume | report." }, 400);
});

async function finalizeAudit(sb: any, audit: any, flagged: any[]) {
  const totalMin = Math.round((audit.vod_duration_seconds || 0) / 60);
  const { data: evs } = await sb
    .from("raw_evidences")
    .select("game_detected", { count: "exact" })
    .eq("vod_id", audit.vod_id)
    .not("game_detected", "is", null);

  const uniqueGames = new Set((evs || []).map((r: any) => r.game_detected)).size;

  const segments = (audit.pending_audit_segments as any) || {};
  segments.flagged = flagged;
  // Clear plan after completion to save space
  delete segments.plan;

  await sb.from("vod_audits").update({
    status: flagged.length > 0 ? "needs_review" : "completed",
    progress_phase: "completed",
    progress_current_minute: totalMin,
    progress_games_found: uniqueGames,
    progress_message: `Auditoria concluída: ${uniqueGames} jogos | ${flagged.length} segmentos pendentes`,
    completed_at: new Date().toISOString(),
    coverage_percent: 100,
    pending_audit_segments: segments as any,
  }).eq("id", audit.id);

  console.log(`[Watcher ${audit.id}] FINALIZED: ${uniqueGames} games, ${flagged.length} flagged`);
}
