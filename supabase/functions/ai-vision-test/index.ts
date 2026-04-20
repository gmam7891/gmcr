// ============================================================================
// AI Vision Test — Playground for validating game/provider detection
// ----------------------------------------------------------------------------
// Receives a base64 image (or URL), runs it through Gemini Vision with the
// forensic prompt and returns the raw + parsed result. Optionally saves to
// game_visual_library as a new DNA entry.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callVision(imageDataUrl: string) {
  const res = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: FORENSIC_PROMPT },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
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

// Robust JSON extraction: strips markdown fences, leading/trailing prose, and
// falls back to extracting the largest balanced { ... } block.
function robustJsonParse(content: string): any {
  if (!content || typeof content !== "string") return { parse_error: true, reason: "empty" };
  let txt = content.trim();
  // 1. Strip markdown code fences
  txt = txt.replace(/^```(?:json|JSON)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  // 2. Direct parse
  try { return JSON.parse(txt); } catch (_) { /* fall through */ }
  // 3. Extract largest {...} block via brace matching
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = txt.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (_) { /* fall through */ }
    // 4. Try removing trailing commas
    const noTrailing = candidate.replace(/,(\s*[}\]])/g, "$1");
    try { return JSON.parse(noTrailing); } catch (_) { /* fall through */ }
  }
  return { parse_error: true, reason: "invalid_json", raw_preview: txt.slice(0, 200) };
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
      const { image_data_url } = body;
      if (!image_data_url || typeof image_data_url !== "string") {
        return json({ error: "image_data_url obrigatório (data URL base64)" }, 400);
      }
      const t0 = Date.now();
      const result = await callVision(image_data_url);
      return json({
        ok: true,
        elapsed_ms: Date.now() - t0,
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

    return json({ error: "action inválida" }, 400);
  } catch (err: any) {
    console.error("[ai-vision-test] error", err);
    return json({ error: err?.message || String(err) }, 500);
  }
});
