// ai-analyst — Analista Virtual
// Recebe { question } e devolve { answer, rows, sql }.
// Fluxo: Gemini gera SELECT → valida → RPC analyst_run_query → Gemini sintetiza resposta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SCHEMA_DICT = `
Você é um analista SQL. Use APENAS as views abaixo (PostgreSQL). NUNCA referencie tabelas raw.

VIEWS ESCOPADAS POR ORG (já filtradas pela org ativa do usuário):
- analyst_v_vod_audits(id, org_id, streamer_login, platform, vod_id, vod_duration_seconds, processed_duration_seconds, coverage_percent, processed_frames, expected_frames, failed_frames, confirmed_blocks, suspect_blocks, discarded_blocks, progress_games_found, confidence_score, status, created_at, updated_at, completed_at, vod_created_at)
- analyst_v_discovery_prospects(id, org_id, briefing_id, platform, username, display_name, bio, followers, avg_views, posts_last_30d, lives_last_30d, location_declared, location_inferred, has_casino_content, match_score, follower_following_ratio, is_spam, briefing_text, search_keywords, created_at)
- analyst_v_monitored_streamers(*) — streamers monitorados pela org

VIEWS GLOBAIS DE MERCADO (dados comuns a todas as orgs):
- analyst_v_detections(id, streamer_login, platform, source_type, source_id, provider_id, game_id, provider_name, game_name, confidence, detected_at, exposure_seconds, viewer_count, offset_seconds, created_at)
- analyst_v_exposure_blocks(id, streamer_login, platform, source_type, source_id, provider_id, game_id, start_at, end_at, duration_seconds, avg_viewers, peak_viewers, viewer_minutes, confidence_avg, is_reconciled, block_status, created_at)
- analyst_v_gameplay_blocks(id, vod_id, streamer_login, platform, source_type, provider_id, game_id, provider_name, game_name, start_seconds, end_seconds)

REGRAS:
- Retorne APENAS a query SQL. SEM markdown, SEM comentários, SEM ponto e vírgula.
- Use SELECT (ou WITH ... SELECT).
- Sempre LIMIT 100 ou menos.
- Para perguntas de "top N", use ORDER BY ... DESC LIMIT N.
- Datas: filtre com NOW() - INTERVAL '7 days' etc.
- Joins permitidos entre as views acima (por streamer_login, game_id, provider_id).
`;

async function callGemini(messages: Array<{ role: string; content: string }>, model = "google/gemini-2.5-flash") {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

function cleanSql(raw: string): string {
  let s = raw.trim();
  // remove ```sql ... ```
  s = s.replace(/^```(?:sql)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // remove trailing ;
  s = s.replace(/;+\s*$/, "");
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const question: string = body?.question?.toString()?.trim() || "";
    if (!question) {
      return new Response(JSON.stringify({ error: "question required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Client com JWT do usuário pra validar auth
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "invalid auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pega org ativa do user
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: profile } = await admin
      .from("profiles")
      .select("current_org_id")
      .eq("id", user.id)
      .maybeSingle();

    const orgId = (profile as any)?.current_org_id;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "no active organization" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Gerar SQL
    const sqlRaw = await callGemini([
      { role: "system", content: SCHEMA_DICT },
      { role: "user", content: `Pergunta: ${question}\n\nGere a query SQL.` },
    ]);
    const sql = cleanSql(sqlRaw);

    // 2) Executar via RPC (a RPC valida tudo de novo + injeta org_id)
    const { data: rows, error: rpcErr } = await userClient.rpc("analyst_run_query", {
      _sql: sql,
      _org_id: orgId,
    });

    if (rpcErr) {
      return new Response(JSON.stringify({
        answer: `Não consegui executar a consulta: ${rpcErr.message}`,
        sql,
        rows: [],
        error: rpcErr.message,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rowsArr = Array.isArray(rows) ? rows : [];

    // 3) Sintetizar resposta em PT-BR
    const sample = rowsArr.slice(0, 30);
    const answer = await callGemini([
      { role: "system", content: "Você é um analista de dados em português. Seja conciso, cite números e mencione tendências. Se não houver dados, diga isso." },
      { role: "user", content: `Pergunta: ${question}\n\nDados (${rowsArr.length} linhas, mostrando até 30):\n${JSON.stringify(sample, null, 2)}\n\nResponda em PT-BR.` },
    ]);

    return new Response(JSON.stringify({ answer, sql, rows: rowsArr }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-analyst]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
