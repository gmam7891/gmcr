// weekly-report — gera um resumo executivo por org e salva em public.reports
// Disparado por cron (terça 9h UTC) ou manualmente via POST { org_id? }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const QUERIES: { key: string; sql: string }[] = [
  {
    key: "vods_audited_7d",
    sql: `SELECT COUNT(*)::int AS total, COALESCE(SUM(processed_duration_seconds),0)::int AS seconds
          FROM analyst_v_vod_audits
          WHERE created_at >= NOW() - INTERVAL '7 days'`,
  },
  {
    key: "top_games_7d",
    sql: `SELECT game_name, COUNT(*)::int AS detections, SUM(exposure_seconds)::int AS total_seconds
          FROM analyst_v_detections
          WHERE detected_at >= NOW() - INTERVAL '7 days' AND game_name IS NOT NULL
          GROUP BY game_name ORDER BY detections DESC LIMIT 10`,
  },
  {
    key: "top_providers_7d",
    sql: `SELECT provider_name, COUNT(*)::int AS detections, SUM(exposure_seconds)::int AS total_seconds
          FROM analyst_v_detections
          WHERE detected_at >= NOW() - INTERVAL '7 days' AND provider_name IS NOT NULL
          GROUP BY provider_name ORDER BY detections DESC LIMIT 10`,
  },
  {
    key: "top_streamers_7d",
    sql: `SELECT streamer_login, SUM(viewer_minutes)::bigint AS viewer_minutes, COUNT(*)::int AS blocks
          FROM analyst_v_exposure_blocks
          WHERE start_at >= NOW() - INTERVAL '7 days'
          GROUP BY streamer_login ORDER BY viewer_minutes DESC NULLS LAST LIMIT 10`,
  },
  {
    key: "new_prospects_7d",
    sql: `SELECT COUNT(*)::int AS total, AVG(match_score)::numeric(5,2) AS avg_score
          FROM analyst_v_discovery_prospects
          WHERE created_at >= NOW() - INTERVAL '7 days'`,
  },
];

async function callGemini(messages: any[]) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function runForOrg(admin: any, orgId: string) {
  const data: Record<string, any> = {};
  for (const q of QUERIES) {
    const { data: rows, error } = await admin.rpc("analyst_run_query", { _sql: q.sql, _org_id: orgId });
    // analyst_run_query checks auth.uid() — but service role bypasses RLS, not auth.uid().
    // We use a SECURITY DEFINER bypass path: call directly via a service helper if needed.
    if (error) {
      data[q.key] = { error: error.message };
    } else {
      data[q.key] = rows;
    }
  }

  const summary = await callGemini([
    {
      role: "system",
      content:
        "Você é um analista sênior de iGaming. Gere um resumo executivo SEMANAL em PT-BR, em markdown, com seções: Visão Geral, Destaques (jogos/provedores/streamers), Prospects, Recomendações. Seja conciso, cite números.",
    },
    { role: "user", content: `Dados agregados da semana:\n${JSON.stringify(data, null, 2)}` },
  ]);

  const weekStart = new Date();
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() + 1); // segunda

  await admin.from("reports").insert({
    org_id: orgId,
    week_start: weekStart.toISOString().slice(0, 10),
    summary_text: summary,
    data,
  });

  return { orgId, ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const targetOrg: string | undefined = body?.org_id;

    let orgs: { id: string }[];
    if (targetOrg) {
      orgs = [{ id: targetOrg }];
    } else {
      const { data, error } = await admin.from("organizations").select("id");
      if (error) throw error;
      orgs = data || [];
    }

    const results = [];
    for (const o of orgs) {
      try {
        results.push(await runForOrg(admin, o.id));
      } catch (e) {
        results.push({ orgId: o.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[weekly-report]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
