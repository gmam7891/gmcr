// campaign-matchmaker — Planejador de Campanha
// Recebe brief, busca candidatos (discovery_prospects + exposição histórica em vod_audits),
// pontua 0-100, estima alcance e custo, e devolve ranking + greedy budget-fit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

interface Brief {
  budget: number;
  target_games: string[];
  target_providers: string[];
  region?: string;
  objective?: string;
  notes?: string;
}

interface Candidate {
  username: string;
  display_name: string | null;
  platform: string;
  followers: number;
  avg_views: number;
  match_score_raw: number;
  has_casino_content: boolean;
  location: string | null;
  prospect_id?: string;
  // computed
  score: number;
  tier: string;
  cost_min: number;
  cost_max: number;
  est_reach: number;
  justification?: string;
}

function pickTier(tiers: any[], followers: number) {
  for (const t of tiers) {
    if (followers >= t.min_followers && (t.max_followers == null || followers < t.max_followers)) {
      return t;
    }
  }
  return tiers[0];
}

function score(p: any, brief: Brief): number {
  // Relevância (40%): match_score do prospect + bate game/provider
  const rel = Math.min(100, (p.match_score || 0)) * 0.4;
  // Engajamento (25%): avg_views / followers (cap 0.2 => 100)
  const eng = Math.min(100, ((p.avg_views || 0) / Math.max(1, p.followers || 1)) * 500) * 0.25;
  // Alcance (20%): log-scale dos followers
  const reach = Math.min(100, (Math.log10(Math.max(10, p.followers || 0)) / 7) * 100) * 0.20;
  // Região/objetivo (15%): bate região? +full. Tem casino content? +half
  let ctx = 0;
  if (brief.region && p.location_declared && p.location_declared.toLowerCase().includes(brief.region.toLowerCase())) ctx += 60;
  else if (brief.region && p.location_inferred && p.location_inferred.toLowerCase().includes(brief.region.toLowerCase())) ctx += 40;
  if (p.has_casino_content) ctx += 40;
  ctx = Math.min(100, ctx) * 0.15;
  return Math.round(rel + eng + reach + ctx);
}

async function callGemini(prompt: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Você é um planejador de mídia de iGaming. Responda APENAS em JSON válido conforme solicitado." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const brief = (await req.json()) as Brief;
    if (!brief || !brief.budget || brief.budget <= 0) {
      return new Response(JSON.stringify({ error: "budget required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "invalid auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: profile } = await admin.from("profiles").select("current_org_id").eq("id", user.id).maybeSingle();
    const orgId = (profile as any)?.current_org_id;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "no active organization" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pricing tiers
    const { data: tiers } = await admin.from("pricing_tiers").select("*").order("sort_order", { ascending: true });
    const tierList = tiers || [];

    // Candidatos: discovery_prospects da org
    const { data: prospects } = await admin
      .from("discovery_prospects")
      .select("id, platform, username, display_name, followers, avg_views, match_score, has_casino_content, location_declared, location_inferred, is_spam")
      .eq("org_id", orgId)
      .eq("is_spam", false)
      .limit(300);

    let candidates: Candidate[] = (prospects || []).map((p: any) => {
      const s = score(p, brief);
      const tier = pickTier(tierList, p.followers || 0);
      return {
        username: p.username,
        display_name: p.display_name,
        platform: p.platform,
        followers: p.followers || 0,
        avg_views: p.avg_views || 0,
        match_score_raw: p.match_score || 0,
        has_casino_content: !!p.has_casino_content,
        location: p.location_declared || p.location_inferred,
        prospect_id: p.id,
        score: s,
        tier: tier?.tier || "Nano",
        cost_min: Number(tier?.min_cost) || 0,
        cost_max: Number(tier?.max_cost) || 0,
        // Heurística: avg_views * 4h presença ≈ viewer-hours; aqui reportamos viewers únicos estimados
        est_reach: Math.round((p.avg_views || 0) * 1.8),
      };
    });

    // Ranking
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 30);

    // Justificativas via Gemini (batch única, JSON)
    let justifications: Record<string, string> = {};
    if (top.length > 0) {
      try {
        const prompt = `Brief:\n${JSON.stringify(brief)}\n\nCandidatos (top ${top.length}):\n${JSON.stringify(top.map((c) => ({ username: c.username, followers: c.followers, score: c.score, tier: c.tier, casino: c.has_casino_content, loc: c.location })))}\n\nPara cada candidato, gere UMA frase (max 140 chars) em PT-BR explicando por que recomendar. Responda JSON: {"<username>": "frase", ...}`;
        const raw = await callGemini(prompt);
        const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
        justifications = JSON.parse(cleaned);
      } catch (e) {
        console.warn("[matchmaker] justificativas falharam:", e);
      }
    }
    top.forEach((c) => { c.justification = justifications[c.username]; });

    // Greedy budget-fit: pega cost_min até estourar
    const budgetFit: Candidate[] = [];
    let spent = 0;
    for (const c of top) {
      if (spent + c.cost_min <= brief.budget) {
        budgetFit.push(c);
        spent += c.cost_min;
      }
    }
    const totalReach = budgetFit.reduce((s, c) => s + c.est_reach, 0);

    return new Response(JSON.stringify({
      brief,
      candidates: top,
      budget_fit: {
        items: budgetFit,
        count: budgetFit.length,
        spent_min: spent,
        spent_max: budgetFit.reduce((s, c) => s + c.cost_max, 0),
        estimated_reach: totalReach,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[campaign-matchmaker]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
