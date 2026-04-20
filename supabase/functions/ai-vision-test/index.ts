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

const FORENSIC_PROMPT = `Você é um auditor forense de iGaming/Casino. Analise a imagem e identifique:

1. JOGO: nome canônico do slot/jogo de cassino (ex: "Fortune Tiger", "Sweet Bonanza")
2. PROVEDORA: ex Pragmatic Play, PG Soft, Hacksaw, Push Gaming, NetEnt, Play'n GO, Nolimit City, Evolution, BGaming, Spribe, Relax Gaming, Yggdrasil
3. CATEGORIA: slots | live_casino | table_game | crash_game | not_game
4. ELEMENTOS VISUAIS encontrados na tela: liste TUDO que viu (logo, botão de spin, saldo, HUD de bônus, free spins, paytable, jackpot, banner de big win, multiplicador, etc)
5. Confiança 0-100

Se NÃO houver jogo de cassino, use category="not_game" e explique no campo evidence.

RESPONDA APENAS JSON (sem markdown):
{
  "game": "nome_do_jogo_ou_null",
  "provider": "provedora_ou_Unknown",
  "category": "slots|live_casino|table_game|crash_game|not_game",
  "confidence": 85,
  "balance": "R$ 1.234,56 ou null",
  "bet_amount": "R$ 5,00 ou null",
  "visual_elements": ["logo do jogo", "botão de spin", "HUD de bônus", "..."],
  "bonus_hud": false,
  "free_spins_active": false,
  "big_win_banner": false,
  "evidence": "descrição do que viu"
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
  let parsed: any = null;
  try {
    const cleaned = content.replace(/```json\s*|\s*```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (_) {
    parsed = { parse_error: true };
  }
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
