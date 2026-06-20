// weekly-report — gera um resumo executivo por org e salva em public.reports
// Disparado por cron (terça 9h UTC) ou manualmente via POST { org_id? }.
// Usa service_role (bypass RLS) e filtra por org_id manualmente onde aplicável.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

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

async function gather(admin: any, orgId: string) {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const data: Record<string, any> = {};

  // Per-org
  const { count: vodCount } = await admin
    .from("vod_audits")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("created_at", since);
  const { data: vodSum } = await admin
    .from("vod_audits")
    .select("processed_duration_seconds")
    .eq("org_id", orgId)
    .gte("created_at", since);
  const totalSeconds = (vodSum || []).reduce(
    (s: number, r: any) => s + (r.processed_duration_seconds || 0),
    0,
  );
  data.vods_audited_7d = { total: vodCount || 0, seconds: totalSeconds };

  const { count: prospCount, data: prospRows } = await admin
    .from("discovery_prospects")
    .select("match_score", { count: "exact" })
    .eq("org_id", orgId)
    .gte("created_at", since);
  const avgScore =
    prospRows && prospRows.length
      ? prospRows.reduce((s: number, r: any) => s + (r.match_score || 0), 0) / prospRows.length
      : 0;
  data.new_prospects_7d = { total: prospCount || 0, avg_score: Number(avgScore.toFixed(2)) };

  // Globais (mercado)
  const { data: detections } = await admin
    .from("detections")
    .select("game_name, provider_name, exposure_seconds")
    .gte("detected_at", since)
    .limit(50000);
  const gameAgg: Record<string, { detections: number; seconds: number }> = {};
  const provAgg: Record<string, { detections: number; seconds: number }> = {};
  for (const d of detections || []) {
    if (d.game_name) {
      const g = (gameAgg[d.game_name] ||= { detections: 0, seconds: 0 });
      g.detections++;
      g.seconds += d.exposure_seconds || 0;
    }
    if (d.provider_name) {
      const p = (provAgg[d.provider_name] ||= { detections: 0, seconds: 0 });
      p.detections++;
      p.seconds += d.exposure_seconds || 0;
    }
  }
  data.top_games_7d = Object.entries(gameAgg)
    .sort((a, b) => b[1].detections - a[1].detections)
    .slice(0, 10)
    .map(([game_name, v]) => ({ game_name, ...v }));
  data.top_providers_7d = Object.entries(provAgg)
    .sort((a, b) => b[1].detections - a[1].detections)
    .slice(0, 10)
    .map(([provider_name, v]) => ({ provider_name, ...v }));

  const { data: blocks } = await admin
    .from("exposure_blocks")
    .select("streamer_login, viewer_minutes")
    .gte("start_at", since)
    .limit(50000);
  const strAgg: Record<string, { viewer_minutes: number; blocks: number }> = {};
  for (const b of blocks || []) {
    if (!b.streamer_login) continue;
    const s = (strAgg[b.streamer_login] ||= { viewer_minutes: 0, blocks: 0 });
    s.viewer_minutes += b.viewer_minutes || 0;
    s.blocks++;
  }
  data.top_streamers_7d = Object.entries(strAgg)
    .sort((a, b) => b[1].viewer_minutes - a[1].viewer_minutes)
    .slice(0, 10)
    .map(([streamer_login, v]) => ({ streamer_login, ...v }));

  return data;
}

async function runForOrg(admin: any, orgId: string) {
  const data = await gather(admin, orgId);
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
  const day = weekStart.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  weekStart.setUTCDate(weekStart.getUTCDate() + diff);

  const { error } = await admin.from("reports").insert({
    org_id: orgId,
    week_start: weekStart.toISOString().slice(0, 10),
    summary_text: summary,
    data,
  });
  if (error) throw error;

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
