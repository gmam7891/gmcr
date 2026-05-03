// ============================================================================
// AI Vision Test — Playground for validating game/provider detection
// ----------------------------------------------------------------------------
// Receives a base64 image (or URL), runs it through Gemini Vision with the
// forensic prompt and returns the raw + parsed result. Optionally saves to
// game_visual_library as a new DNA entry.
//
// Actions:
//   - test:                    one-off vision call on a single image
//   - save_dna:                manual upsert of a Visual DNA row
//   - train_from_screenshots:  one-shot training from 1-5 user screenshots
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const FORENSIC_PROMPT = `Você é um auditor forense de iGaming/Casino. Analise a imagem e identifique jogo, provedora, categoria e elementos visuais.

REGRAS DE RESPOSTA (CRÍTICO):
- Responda APENAS com um objeto JSON puro.
- NÃO inclua texto antes ou depois do JSON.
- NÃO use blocos de código markdown (sem \`\`\`json, sem \`\`\`).
- NÃO escreva explicações fora do JSON. Toda explicação deve ir dentro do campo "evidence".
- Use null (não a string "null") quando um campo não for detectável.

Categorias permitidas: slots | live_casino | table_game | crash_game | not_game.
Provedoras conhecidas: Pragmatic Play, PG Soft, Hacksaw, Push Gaming, NetEnt, Play'n GO, Nolimit City, Evolution, BGaming, Spribe, Relax Gaming, Yggdrasil.

Schema obrigatório:
{
  "game": "string ou null",
  "provider": "string (use \\"Unknown\\" se não souber)",
  "category": "slots|live_casino|table_game|crash_game|not_game",
  "confidence": 0,
  "balance": "string ou null",
  "bet_amount": "string ou null",
  "visual_elements": ["string"],
  "bonus_hud": false,
  "free_spins_active": false,
  "big_win_banner": false,
  "evidence": "string"
}`;

const DNA_TRAINING_PROMPT = `Você é um especialista em análise visual de jogos de cassino online (slots e similares).
Você vai receber 1 a 5 screenshots do MESMO jogo, em momentos diferentes (lobby, gameplay, bônus, paytable, etc.).

Sua tarefa: extrair o "Visual DNA" desse jogo — um conjunto compacto de pistas visuais
que permitam a outro modelo identificar esse jogo em thumbnails pequenas (storyboard) no futuro.

REGRAS DE RESPOSTA (CRÍTICO):
- Responda APENAS com um objeto JSON puro.
- NÃO inclua texto antes ou depois do JSON.
- NÃO use blocos de código markdown (sem \`\`\`json, sem \`\`\`).
- NÃO escreva nada fora do JSON.

Schema obrigatório:
{
  "detected_game_name": "string (nome canônico do jogo)",
  "provider_canonical": "string (nome canônico da provedora)",
  "unique_visual_traits": [
    "frase curta descrevendo um traço único",
    "outra frase curta",
    "..."
  ],
  "hud_layout": {
    "reels": "ex: 6x5 cluster pays / 5x3 paylines / etc",
    "balance_position": "ex: bottom-left",
    "bet_position": "ex: bottom-center",
    "spin_button_position": "ex: bottom-right",
    "logo_position": "ex: top-center"
  },
  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "detection_keywords": [
    "palavra/símbolo único 1",
    "palavra/símbolo único 2",
    "palavra/símbolo único 3",
    "palavra/símbolo único 4",
    "palavra/símbolo único 5",
    "palavra/símbolo único 6"
  ],
  "volatility_indicators": ["ex: multiplicadores 5x-100x", "free spins com sticky wilds", "..."],
  "browser_title_pattern": "ex: Gates of Olympus 1000 - Pragmatic Play"
}

DIRETRIZES:
- "unique_visual_traits": 3-6 frases curtas e ESPECÍFICAS (símbolos icônicos, personagem central,
  estilo de arte, fundo característico). Evite genéricos como "tem rolos" ou "tem botões".
- "detection_keywords": 4-6 termos curtos (1-3 palavras cada), em pt-BR ou inglês,
  que apareceriam visualmente nesse jogo (nome, símbolo principal, cor dominante,
  elemento icônico). Esses termos viram "pistas" para o modelo de detecção.
- "color_palette": 4-6 cores HEX dominantes (sem alpha).
- "hud_layout": use null em campos que você não consegue ver claramente.
- Se as imagens mostram o jogo em estados diferentes (lobby, bônus etc), CONSOLIDE em
  um único Visual DNA representando o jogo todo.`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Robust JSON extraction: strips markdown fences, leading/trailing prose, and
// falls back to extracting the largest balanced { ... } block.
function robustJsonParse(content: string): any {
  if (!content || typeof content !== "string") return { parse_error: true, reason: "empty" };
  let txt = content.trim();
  txt = txt.replace(/^```(?:json|JSON)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(txt); } catch (_) { /* fall through */ }
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = txt.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (_) { /* fall through */ }
    const noTrailing = candidate.replace(/,(\s*[}\]])/g, "$1");
    try { return JSON.parse(noTrailing); } catch (_) { /* fall through */ }
  }
  return { parse_error: true, reason: "invalid_json", raw_preview: txt.slice(0, 200) };
}

/**
 * Generic vision call. Accepts one or more images plus a system prompt and
 * an optional user-text segment. Returns the raw content + parsed JSON.
 */
async function callVision(
  imageUrls: string | string[],
  systemPrompt: string = FORENSIC_PROMPT,
  userText: string = "",
) {
  const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  const userContent: any[] = [];
  if (userText) userContent.push({ type: "text", text: userText });
  const imageContent = urls.map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  const res = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: [...userContent, ...imageContent] },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI gateway ${res.status}: ${txt}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content || "";
  const parsed = robustJsonParse(content);
  return { raw: content, parsed, usage: body?.usage };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) {
      return json({ error: "LOVABLE_API_KEY não configurada" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json().catch(() => ({}));
    const action = body.action || "test";

    if (action === "test") {
      const { image_data_url, persist_snapshot, streamer_login } = body;
      if (!image_data_url || typeof image_data_url !== "string") {
        return json({ error: "image_data_url obrigatório (data URL base64)" }, 400);
      }
      const t0 = Date.now();
      const result = await callVision(image_data_url);

      let snapshot_id: string | null = null;
      const p: any = result.parsed;
      if (persist_snapshot && p && !p.parse_error && p.category !== "not_game" && p.game) {
        const { data: snap, error: snapErr } = await supabase
          .from("stream_snapshots")
          .insert({
            streamer_login: String(streamer_login || "ai_playground"),
            is_live: false,
            viewer_count: 0,
            game_name: p.game,
            ai_confidence: typeof p.confidence === "number" ? p.confidence / 100 : null,
            ai_evidence: p.evidence || null,
            is_ai_verified: true,
            stream_title: `[playground] ${p.provider || "Unknown"} • ${p.game}`,
          })
          .select("id")
          .single();
        if (snapErr) console.error("[ai-vision-test] persist snapshot error", snapErr);
        else snapshot_id = snap?.id || null;
      }

      return json({
        ok: true,
        elapsed_ms: Date.now() - t0,
        snapshot_id,
        ...result,
      });
    }

    if (action === "save_dna") {
      const { game_name, provider_name, visual_dna, source_image_url } = body;
      if (!game_name || !provider_name) {
        return json({ error: "game_name e provider_name obrigatórios" }, 400);
      }
      const slug = String(provider_name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const { data, error } = await supabase
        .from("game_visual_library")
        .insert({
          game_name,
          provider_name,
          provider_slug: slug,
          source_url: source_image_url || null,
          visual_dna: visual_dna || {},
          training_status: "trained",
          metadata: { source: "ai_vision_playground", saved_at: new Date().toISOString() },
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, entry: data });
    }

    if (action === "train_from_screenshots") {
      // One-shot training: receives 1-5 screenshots + game/provider names,
      // extracts Visual DNA via Gemini, and upserts the library row as
      // training_status="trained". Used by the upload-print flow in the UI.
      const { game_name, provider_name, image_data_urls } = body;
      if (!game_name || !provider_name) {
        return json({ error: "game_name e provider_name obrigatórios" }, 400);
      }
      const urls: string[] = Array.isArray(image_data_urls) ? image_data_urls : [];
      if (urls.length === 0) {
        return json({ error: "image_data_urls (array) obrigatório" }, 400);
      }
      if (urls.length > 5) {
        return json({ error: "máximo 5 imagens por treinamento" }, 400);
      }

      const t0 = Date.now();
      const userText = `Jogo: "${game_name}"
Provedora: "${provider_name}"
Use estes nomes EXATAMENTE em "detected_game_name" e "provider_canonical".
Extraia o Visual DNA olhando as ${urls.length} imagem(ns) enviadas.`;

      let result;
      try {
        result = await callVision(urls, DNA_TRAINING_PROMPT, userText);
      } catch (e: any) {
        return json({ error: `IA falhou: ${e.message}` }, 502);
      }

      const dna: any = result.parsed;
      if (!dna || dna.parse_error) {
        return json({
          error: "IA não retornou JSON válido",
          raw: result.raw,
        }, 502);
      }

      // Force user-provided names to overrule any AI deviation
      dna.detected_game_name = game_name;
      dna.provider_canonical = provider_name;

      const slug = String(provider_name).toLowerCase().replace(/[^a-z0-9]+/g, "_");

      // Upsert: if the (game_name, provider_slug) pair already exists, update
      // it instead of creating a duplicate. Otherwise insert new row.
      const { data: existing } = await supabase
        .from("game_visual_library")
        .select("id")
        .eq("game_name", game_name)
        .eq("provider_slug", slug)
        .maybeSingle();

      const payload = {
        game_name,
        provider_name,
        provider_slug: slug,
        visual_dna: dna,
        training_status: "trained" as const,
        error_message: null,
        metadata: {
          source: "screenshot_upload",
          saved_at: new Date().toISOString(),
          screenshot_count: urls.length,
        },
      };

      let entry: any;
      if (existing?.id) {
        const { data, error } = await supabase
          .from("game_visual_library")
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single();
        if (error) return json({ error: error.message }, 500);
        entry = data;
      } else {
        const { data, error } = await supabase
          .from("game_visual_library")
          .insert(payload)
          .select()
          .single();
        if (error) return json({ error: error.message }, 500);
        entry = data;
      }

      return json({
        ok: true,
        elapsed_ms: Date.now() - t0,
        entry,
        visual_dna: dna,
        updated: !!existing?.id,
      });
    }

    return json({ error: "action inválida" }, 400);
  } catch (err: any) {
    console.error("[ai-vision-test] error", err);
    return json({ error: err?.message || String(err) }, 500);
  }
});
