// Backfill de imagens de referência (logo_url) para game_visual_library.
// Estratégia: SlotCatalog (busca → página do slot → og:image), com fallback futuro.
// Processa em chunks via self-invoke pra respeitar timeout de edge function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE = 5;
const FETCH_TIMEOUT_MS = 15_000;
const REQUEST_GAP_MS = 800;
const MIN_IMAGE_BYTES = 5_000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

function selfInvoke(body: Record<string, unknown>) {
  fetch(`${SUPABASE_URL}/functions/v1/backfill-game-references`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  }).catch((e) => console.warn("self-invoke failed:", e));
}

async function findSlotCatalogPage(gameName: string, providerName: string | null): Promise<string | null> {
  const q = encodeURIComponent(`${gameName} ${providerName || ""}`.trim());
  const url = `https://slotcatalog.com/en/search?q=${q}`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/href="(\/en\/slots\/[^"#?]+)"/);
    if (!m) return null;
    return `https://slotcatalog.com${m[1]}`;
  } catch {
    return null;
  }
}

async function extractOgImage(pageUrl: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(pageUrl);
    if (!r.ok) return null;
    const html = await r.text();
    const m =
      html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (!m) return null;
    return m[1];
  } catch {
    return null;
  }
}

async function downloadImage(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    if (ab.byteLength < MIN_IMAGE_BYTES) return null;
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

type GameRow = { id: string; game_name: string; provider_name: string | null; metadata: Record<string, unknown> | null };

async function backfillOne(game: GameRow): Promise<{ ok: boolean; reason?: string; page?: string; image?: string }> {
  const pageUrl = await findSlotCatalogPage(game.game_name, game.provider_name);
  if (!pageUrl) return { ok: false, reason: "search-miss" };

  const imageUrl = await extractOgImage(pageUrl);
  if (!imageUrl) return { ok: false, reason: "no-og-image" };

  const bytes = await downloadImage(imageUrl);
  if (!bytes) return { ok: false, reason: "download-failed" };

  const path = `${game.id}/logo.jpg`;
  const { error: upErr } = await sb.storage.from("game-references").upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (upErr) return { ok: false, reason: `upload-failed: ${upErr.message}` };

  const { data: pub } = sb.storage.from("game-references").getPublicUrl(path);

  const nextMeta = {
    ...(game.metadata || {}),
    logo_source: "slotcatalog",
    logo_source_page: pageUrl,
    logo_needs_review: true,
    logo_backfilled_at: new Date().toISOString(),
  };

  const { error: updErr } = await sb
    .from("game_visual_library")
    .update({ logo_url: pub.publicUrl, metadata: nextMeta })
    .eq("id", game.id);
  if (updErr) return { ok: false, reason: `db-update-failed: ${updErr.message}` };

  return { ok: true, page: pageUrl, image: imageUrl };
}

async function markFailure(game: GameRow, reason: string) {
  const nextMeta = {
    ...(game.metadata || {}),
    logo_backfill_failed: true,
    logo_backfill_failed_at: new Date().toISOString(),
    logo_backfill_failed_reason: reason,
  };
  await sb.from("game_visual_library").update({ metadata: nextMeta }).eq("id", game.id);
}

async function pendingGames(): Promise<GameRow[]> {
  // Pega um lote grande e filtra "failed" no cliente. Total de jogos é da ordem
  // de centenas, então um limit alto aqui ainda é barato e evita perder pending
  // quando muitos jogos no início do resultset já tinham falhado.
  const { data, error } = await sb
    .from("game_visual_library")
    .select("id, game_name, provider_name, metadata")
    .not("agent_learned_at", "is", null)
    .is("logo_url", null)
    .limit(500);
  if (error || !data) return [];
  return (data as GameRow[]).filter((g) => !(g.metadata as any)?.logo_backfill_failed).slice(0, BATCH_SIZE);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action || "start";

    if (action === "status") {
      const total = await sb
        .from("game_visual_library")
        .select("*", { count: "exact", head: true })
        .not("agent_learned_at", "is", null);
      const withLogo = await sb
        .from("game_visual_library")
        .select("*", { count: "exact", head: true })
        .not("agent_learned_at", "is", null)
        .not("logo_url", "is", null);
      const failed = await sb
        .from("game_visual_library")
        .select("*", { count: "exact", head: true })
        .not("agent_learned_at", "is", null)
        .is("logo_url", null)
        .filter("metadata->>logo_backfill_failed", "eq", "true");
      return json({
        ok: true,
        total_trained: total.count ?? 0,
        with_logo: withLogo.count ?? 0,
        failed: failed.count ?? 0,
        pending: (total.count ?? 0) - (withLogo.count ?? 0) - (failed.count ?? 0),
      });
    }

    if (action === "reset_failures") {
      const { data: rows } = await sb
        .from("game_visual_library")
        .select("id, metadata")
        .filter("metadata->>logo_backfill_failed", "eq", "true");
      let reset = 0;
      for (const r of rows || []) {
        const m = { ...((r as any).metadata || {}) };
        delete m.logo_backfill_failed;
        delete m.logo_backfill_failed_at;
        delete m.logo_backfill_failed_reason;
        await sb.from("game_visual_library").update({ metadata: m }).eq("id", (r as any).id);
        reset++;
      }
      return json({ ok: true, reset });
    }

    if (action === "start") {
      selfInvoke({ action: "tick" });
      return json({ ok: true, status: "started" });
    }

    if (action === "tick") {
      const pending = await pendingGames();
      if (pending.length === 0) return json({ ok: true, status: "completed" });

      const results: Array<{ game: string; ok: boolean; reason?: string }> = [];
      for (const g of pending) {
        const r = await backfillOne(g);
        results.push({ game: g.game_name, ok: r.ok, reason: r.reason });
        if (!r.ok && r.reason) await markFailure(g, r.reason);
        await new Promise((res) => setTimeout(res, REQUEST_GAP_MS));
      }

      selfInvoke({ action: "tick" });
      return json({ ok: true, status: "running", processed: results });
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
