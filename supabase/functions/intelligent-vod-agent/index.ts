// Intelligent VOD Agent — learns game profiles + provides second-opinion VOD analysis
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── Learn a single game profile via Lovable AI ───────────────────────
async function learnGame(gameLibraryId: string) {
  const { data: game, error } = await sb
    .from("game_visual_library")
    .select("*")
    .eq("id", gameLibraryId)
    .single();
  if (error || !game) throw new Error("Game not found");

  const dna = game.visual_dna || {};
  const context = `
Jogo: ${game.game_name}
Provedor: ${game.provider_name}
Source URL: ${game.source_url || "—"}
Visual DNA existente: ${JSON.stringify(dna).slice(0, 2000)}
`.trim();

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content:
            "Você é um especialista em identificação visual de jogos de cassino online. Extraia palavras-chave e marcadores visuais únicos que permitam reconhecer este jogo em capturas de tela ou OCR de VODs da Twitch.",
        },
        {
          role: "user",
          content: `Analise os dados deste jogo e gere o perfil de detecção:\n\n${context}\n\nGere:\n- agent_keywords: 15-25 termos textuais únicos (nome do jogo, símbolos especiais, frases do HUD/paytable, mecânicas próprias). Em PT e EN. Curtos.\n- agent_visual_markers: 8-15 marcadores visuais (cores dominantes em hex, elementos de UI únicos, formato de grid, personagens, ícones de bônus).`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "save_game_profile",
            description: "Save the agent's learned profile for this game",
            parameters: {
              type: "object",
              properties: {
                agent_keywords: {
                  type: "array",
                  items: { type: "string" },
                  description: "15-25 unique textual keywords",
                },
                agent_visual_markers: {
                  type: "array",
                  items: { type: "string" },
                  description: "8-15 visual markers",
                },
              },
              required: ["agent_keywords", "agent_visual_markers"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "save_game_profile" } },
    }),
  });

  if (!aiResp.ok) {
    const txt = await aiResp.text();
    if (aiResp.status === 429) throw new Error("Rate limit excedido. Tente novamente em alguns minutos.");
    if (aiResp.status === 402) throw new Error("Créditos do Lovable AI esgotados. Adicione créditos em Settings > Workspace > Usage.");
    throw new Error(`AI error ${aiResp.status}: ${txt.slice(0, 200)}`);
  }

  const aiData = await aiResp.json();
  const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("AI did not return a profile");
  const profile = JSON.parse(toolCall.function.arguments);

  const { error: upErr } = await sb
    .from("game_visual_library")
    .update({
      agent_keywords: profile.agent_keywords || [],
      agent_visual_markers: profile.agent_visual_markers || [],
      agent_learned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameLibraryId);
  if (upErr) throw upErr;

  return {
    game_id: gameLibraryId,
    game_name: game.game_name,
    keywords_count: profile.agent_keywords?.length || 0,
    markers_count: profile.agent_visual_markers?.length || 0,
  };
}

// ─── Learn all pending (trained but not yet profiled) ─────────────────
async function learnAllPending() {
  const { data, error } = await sb
    .from("game_visual_library")
    .select("id, game_name")
    .eq("training_status", "trained")
    .is("agent_learned_at", null);
  if (error) throw error;

  const list = data || [];
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const g of list) {
    try {
      await learnGame(g.id);
      results.push({ id: g.id, ok: true });
      await new Promise((r) => setTimeout(r, 800)); // throttle
    } catch (e: unknown) {
      results.push({
        id: g.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    total: list.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

// ─── Helpers for analysis ─────────────────────────────────────────────
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ");
}

function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(/\s+/).filter((w) => w.length >= 2));
}

function keywordScore(haystack: Set<string>, kws: string[]): number {
  if (!kws?.length) return 0;
  let hits = 0;
  for (const kw of kws) {
    const tokens = normalize(kw).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const allMatch = tokens.every((t) => haystack.has(t));
    if (allMatch) hits++;
  }
  return Math.min(1, hits / Math.max(1, Math.min(kws.length, 10)));
}

function visualScore(haystack: Set<string>, markers: string[]): number {
  if (!markers?.length) return 0;
  let hits = 0;
  for (const m of markers) {
    const tokens = normalize(m).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const anyMatch = tokens.some((t) => haystack.has(t));
    if (anyMatch) hits++;
  }
  return Math.min(1, hits / Math.max(1, Math.min(markers.length, 6)));
}

// ─── Analyze VOD: compute agent's second opinion from raw_evidences ──
async function analyzeVod(vodId: string) {
  // Load all learned profiles
  const { data: games, error: gErr } = await sb
    .from("game_visual_library")
    .select(
      "id, game_name, provider_name, agent_keywords, agent_visual_markers, agent_confidence_threshold",
    )
    .not("agent_learned_at", "is", null);
  if (gErr) throw gErr;
  const profiles = (games || []).filter(
    (g) => (g.agent_keywords?.length || 0) + (g.agent_visual_markers?.length || 0) > 0,
  );
  if (profiles.length === 0) {
    return { vod_id: vodId, blocks: 0, message: "Nenhum perfil aprendido. Treine os jogos primeiro." };
  }

  // Load evidences for this VOD
  const { data: evidences, error: eErr } = await sb
    .from("raw_evidences")
    .select(
      "id, timestamp_seconds, game_detected, provider_detected, extra_metadata, screen_state, casino_brand",
    )
    .eq("vod_id", vodId)
    .order("timestamp_seconds", { ascending: true });
  if (eErr) throw eErr;
  if (!evidences || evidences.length === 0) {
    return { vod_id: vodId, blocks: 0, message: "Nenhuma evidência encontrada para este VOD." };
  }

  // Streamer login from VOD audit
  const { data: audit } = await sb
    .from("vod_audits")
    .select("streamer_login")
    .eq("vod_id", vodId)
    .maybeSingle();
  const streamerLogin = audit?.streamer_login || "unknown";

  // Pipeline blocks for agreement check
  const { data: pipelineBlocks } = await sb
    .from("gameplay_blocks")
    .select("game_name, start_seconds, end_seconds")
    .eq("vod_id", vodId);

  // For each evidence, find best matching profile
  type Detection = { ts: number; game: typeof profiles[0]; conf: number; kc: number; vc: number };
  const detections: Detection[] = [];

  for (const ev of evidences) {
    const meta = (ev.extra_metadata as Record<string, unknown>) || {};
    const textParts = [
      ev.game_detected,
      ev.provider_detected,
      ev.casino_brand,
      ev.screen_state,
      typeof meta.ocr === "string" ? meta.ocr : "",
      typeof meta.evidence === "string" ? meta.evidence : "",
      typeof meta.title === "string" ? meta.title : "",
    ].filter(Boolean).join(" ");

    const visualParts = [
      typeof meta.color_palette === "string" ? meta.color_palette : "",
      Array.isArray(meta.visual_markers) ? meta.visual_markers.join(" ") : "",
      Array.isArray(meta.colors) ? meta.colors.join(" ") : "",
      ev.screen_state || "",
    ].join(" ");

    const textTokens = tokenize(textParts + " " + visualParts);
    const visualTokens = tokenize(visualParts + " " + textParts);

    let best: Detection | null = null;
    for (const p of profiles) {
      const kc = keywordScore(textTokens, p.agent_keywords || []);
      const vc = visualScore(visualTokens, p.agent_visual_markers || []);
      const conf = kc * 0.6 + vc * 0.4;
      const threshold = Number(p.agent_confidence_threshold) || 0.7;
      if (conf >= threshold && (!best || conf > best.conf)) {
        best = { ts: ev.timestamp_seconds || 0, game: p, conf, kc, vc };
      }
    }
    if (best) detections.push(best);
  }

  // Group consecutive detections of the same game into blocks (gap ≤ 90s)
  const GAP = 90;
  const blocks: Array<{
    game_id: string;
    game_name: string;
    provider_name: string;
    start: number;
    end: number;
    confSum: number;
    kcSum: number;
    vcSum: number;
    n: number;
  }> = [];
  for (const d of detections) {
    const last = blocks[blocks.length - 1];
    if (last && last.game_id === d.game.id && d.ts - last.end <= GAP) {
      last.end = d.ts;
      last.confSum += d.conf;
      last.kcSum += d.kc;
      last.vcSum += d.vc;
      last.n++;
    } else {
      blocks.push({
        game_id: d.game.id,
        game_name: d.game.game_name,
        provider_name: d.game.provider_name || "",
        start: d.ts,
        end: d.ts,
        confSum: d.conf,
        kcSum: d.kc,
        vcSum: d.vc,
        n: 1,
      });
    }
  }

  // Clear previous agent analyses for this VOD (idempotent re-run)
  await sb.from("agent_analyses").delete().eq("vod_id", vodId);

  const rows = blocks
    .filter((b) => b.end - b.start >= 30 || b.n >= 2)
    .map((b) => {
      const agrees = (pipelineBlocks || []).some(
        (pb) =>
          pb.game_name?.toLowerCase() === b.game_name.toLowerCase() &&
          pb.start_seconds <= b.end &&
          pb.end_seconds >= b.start,
      );
      return {
        vod_id: vodId,
        streamer_login: streamerLogin,
        game_library_id: b.game_id,
        game_name: b.game_name,
        provider_name: b.provider_name,
        start_seconds: b.start,
        end_seconds: b.end,
        duration_seconds: Math.max(b.end - b.start, 30),
        confidence: Number((b.confSum / b.n).toFixed(3)),
        keyword_confidence: Number((b.kcSum / b.n).toFixed(3)),
        visual_confidence: Number((b.vcSum / b.n).toFixed(3)),
        agrees_with_pipeline: pipelineBlocks ? agrees : null,
      };
    });

  if (rows.length > 0) {
    const { error: insErr } = await sb.from("agent_analyses").insert(rows);
    if (insErr) throw insErr;

    // Update game stats
    const byGame = new Map<string, { count: number; sum: number }>();
    for (const r of rows) {
      const g = byGame.get(r.game_library_id) || { count: 0, sum: 0 };
      g.count++;
      g.sum += r.confidence;
      byGame.set(r.game_library_id, g);
    }
    for (const [gid, stats] of byGame) {
      const { data: cur } = await sb
        .from("game_visual_library")
        .select("agent_times_identified, agent_average_confidence")
        .eq("id", gid)
        .single();
      const prevN = cur?.agent_times_identified || 0;
      const prevAvg = Number(cur?.agent_average_confidence) || 0;
      const newN = prevN + stats.count;
      const newAvg = (prevAvg * prevN + stats.sum) / newN;
      await sb
        .from("game_visual_library")
        .update({
          agent_times_identified: newN,
          agent_average_confidence: Number(newAvg.toFixed(3)),
          agent_last_identified_at: new Date().toISOString(),
        })
        .eq("id", gid);
    }
  }

  return {
    vod_id: vodId,
    blocks: rows.length,
    profiles_used: profiles.length,
    evidences_processed: evidences.length,
    agreements: rows.filter((r) => r.agrees_with_pipeline === true).length,
    divergences: rows.filter((r) => r.agrees_with_pipeline === false).length,
  };
}

// ─── Submit feedback ─────────────────────────────────────────────────
async function submitFeedback(p: {
  analysis_id: string;
  corrected_game_id?: string | null;
  correction_type: string;
  notes?: string;
  user_id?: string;
}) {
  const { data: an, error } = await sb
    .from("agent_analyses")
    .select("game_library_id")
    .eq("id", p.analysis_id)
    .single();
  if (error || !an) throw new Error("Analysis not found");

  const { error: insErr } = await sb.from("agent_feedback").insert({
    analysis_id: p.analysis_id,
    original_game_id: an.game_library_id,
    corrected_game_id: p.corrected_game_id || null,
    correction_type: p.correction_type,
    notes: p.notes || null,
    created_by: p.user_id || null,
  });
  if (insErr) throw insErr;
  return { ok: true };
}

// ─── Dashboard metrics ───────────────────────────────────────────────
async function getDashboard() {
  const [{ count: total }, { count: corrections }, { count: confirmed }] = await Promise.all([
    sb.from("agent_analyses").select("*", { count: "exact", head: true }),
    sb.from("agent_analyses").select("*", { count: "exact", head: true }).eq("user_corrected", true),
    sb.from("agent_analyses").select("*", { count: "exact", head: true }).eq("user_confirmed", true),
  ]);

  const { data: learnedGames } = await sb
    .from("game_visual_library")
    .select("id, game_name, provider_name, agent_times_identified, agent_times_corrected, agent_average_confidence, agent_confidence_threshold, agent_learned_at")
    .not("agent_learned_at", "is", null)
    .order("agent_average_confidence", { ascending: false });

  const totalNum = total || 0;
  const correctionsNum = corrections || 0;
  const accuracy = totalNum > 0 ? (totalNum - correctionsNum) / totalNum : 0;

  const games = learnedGames || [];
  const top = [...games]
    .filter((g) => (g.agent_times_identified || 0) > 0)
    .sort((a, b) => Number(b.agent_average_confidence) - Number(a.agent_average_confidence))
    .slice(0, 10);
  const needsRetraining = [...games]
    .filter((g) => (g.agent_times_corrected || 0) > 0)
    .sort((a, b) => (b.agent_times_corrected || 0) - (a.agent_times_corrected || 0))
    .slice(0, 10);

  const { data: recentFeedback } = await sb
    .from("agent_feedback")
    .select("id, correction_type, notes, created_at, original_game_id, corrected_game_id")
    .order("created_at", { ascending: false })
    .limit(20);

  return {
    metrics: {
      total_analyses: totalNum,
      total_corrections: correctionsNum,
      total_confirmed: confirmed || 0,
      accuracy,
      learned_games: games.length,
    },
    top_games: top,
    needs_retraining: needsRetraining,
    recent_feedback: recentFeedback || [],
  };
}

// ─── HTTP handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "learn_game":
        return json(await learnGame(body.game_library_id));
      case "learn_all_pending":
        return json(await learnAllPending());
      case "analyze_vod":
        return json(await analyzeVod(body.vod_id));
      case "submit_feedback":
        return json(await submitFeedback(body));
      case "get_dashboard":
        return json(await getDashboard());
      case "get_vod_analyses": {
        const { data, error } = await sb
          .from("agent_analyses")
          .select("*")
          .eq("vod_id", body.vod_id)
          .order("start_seconds", { ascending: true });
        if (error) throw error;
        return json({ analyses: data || [] });
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("intelligent-vod-agent error:", msg);
    return json({ error: msg }, 500);
  }
});
