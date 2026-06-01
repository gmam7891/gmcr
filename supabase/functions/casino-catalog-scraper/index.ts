// Casino Catalog Scraper
// Scrapes online casino lobby pages (e.g. BullsBet), extracts game tiles,
// computes perceptual hashes (pHash) of thumbnails, and merges them into
// game_visual_library.
//
// Actions:
//   - scrape_casino     { casino_slug, casino_name?, urls[] }
//   - ingest_html       { casino_slug, casino_name?, html, source_page_url? }
//   - status            { casino_slug }
//   - merge_to_library  { casino_slug }
//   - list_casinos
//   - upsert_casino     { casino_slug, casino_name, urls[], is_active? }
//   - delete_casino     { casino_slug }
//
// All actions require an authenticated admin user — the function relies on the
// shared `authenticate`/`requireAdmin` helpers used by scanner-write et al.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  authenticate,
  corsHeaders,
  jsonResponse as json,
  requireAdmin,
} from "../_shared/scanner-actions.ts";
import {
  bytesToHex,
  bytesToPgHex,
  computePHashFromBytes,
} from "../_shared/phash.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

// Service-role client for the actual data work (storage uploads, batched
// upserts). The user identity / admin gate is enforced before any of this
// runs — see the Deno.serve handler.
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ─── Utils ────────────────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(s: string): string {
  return normalizeName(s).replace(/\s+/g, "-");
}

// Escapes the PostgREST LIKE/ILIKE wildcards so a game name like "100% Lucky"
// is matched literally instead of treating `%` as a wildcard.
function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

// ─── Firecrawl ─────────────────────────────────────────────────────────

async function firecrawlScrape(url: string): Promise<string | null> {
  if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY missing");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      onlyMainContent: false,
      waitFor: 3000,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Firecrawl error", res.status, data);
    return null;
  }
  return (data?.data?.html ?? data?.html ?? null) as string | null;
}

// ─── Tile extraction ───────────────────────────────────────────────────

interface TileCandidate {
  game_name: string;
  provider: string;
  thumbnail_url: string;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function absolutize(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function inferProvider(name: string, src: string): string {
  const hay = (name + " " + src).toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/pragmatic/i, "Pragmatic Play"],
    [/pgsoft|pg[-_ ]?soft|pg\b/i, "PG Soft"],
    [/evolution/i, "Evolution"],
    [/spinomenal/i, "Spinomenal"],
    [/playngo|play[-_ ]?n[-_ ]?go/i, "Play'n GO"],
    [/netent/i, "NetEnt"],
    [/hacksaw/i, "Hacksaw Gaming"],
    [/nolimit/i, "Nolimit City"],
    [/relax/i, "Relax Gaming"],
    [/red[-_ ]?tiger/i, "Red Tiger"],
    [/popok/i, "PopOK"],
  ];
  for (const [re, label] of map) {
    if (re.test(hay)) return label;
  }
  return "";
}

function extractTiles(html: string, baseUrl: string): TileCandidate[] {
  const tiles: TileCandidate[] = [];
  const seen = new Set<string>();
  const imgRe = /<img\b[^>]*>/gi;
  const attrRe = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, "i");
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const get = (attr: string): string | null => {
      const mm = attrRe(attr).exec(tag);
      if (!mm) return null;
      return decodeHtmlEntities(mm[1] || mm[2] || "").trim() || null;
    };
    const srcRaw =
      get("src") || get("data-src") || get("data-lazy-src") ||
      get("data-original");
    if (!srcRaw) continue;
    const hasExt = /\.(jpe?g|png|webp|avif)(\?|#|$)/i.test(srcRaw);
    const isImageCdn = /(imagedelivery\.net|imgix\.net|cloudinary\.com|res\.cloudinary|akamaized\.net\/.*\/(thumb|tile|game)|cdn\..*\/(games?|thumbs?|tiles?)\/)/i.test(srcRaw);
    if (!hasExt && !isImageCdn) continue;
    if (/icon|logo|sprite|placeholder|loader|avatar/i.test(srcRaw)) continue;

    const src = absolutize(srcRaw, baseUrl);
    if (seen.has(src)) continue;

    const alt = get("alt") || get("title") || get("aria-label") || "";
    const name = alt.trim();
    if (!name || name.length < 2 || name.length > 80) continue;
    if (/^(banner|background|cover|menu|search|close)$/i.test(name)) continue;

    seen.add(src);
    tiles.push({
      game_name: name,
      provider: inferProvider(name, src),
      thumbnail_url: src,
    });
  }
  return tiles;
}

// ─── Download + upload thumbnail ───────────────────────────────────────

async function downloadAndStore(
  thumbUrl: string,
  casinoSlug: string,
  gameSlug: string,
): Promise<
  { storagePath: string; phashBytes: Uint8Array | null } | null
> {
  try {
    const res = await fetch(thumbUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; StarklyticBot/1.0; +https://starklytic.com)",
      },
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
      ? "webp"
      : "jpg";
    const path = `${casinoSlug}/${gameSlug}.${ext}`;
    const { error } = await sb.storage.from("game-thumbnails").upload(
      path,
      bytes,
      { contentType, upsert: true },
    );
    if (error) {
      console.error("storage upload error", error);
      return null;
    }
    const phashBytes = await computePHashFromBytes(bytes);
    return { storagePath: path, phashBytes };
  } catch (e) {
    console.error("downloadAndStore failed", thumbUrl, e);
    return null;
  }
}

// ─── Actions ───────────────────────────────────────────────────────────

// Idempotent tile persistence. The previous implementation upserted with
// `status: "pending"` hard-coded, which on re-scrape silently reset rows that
// were already matched / new_pending_dna back to pending, causing
// merge_to_library to push duplicate entries into game_visual_library.thumbnails.
// Strategy: read which (casino, normalized_name, provider) combos already
// exist, UPDATE only the volatile fields on those, INSERT the rest.
async function processTiles(
  casino_slug: string,
  casino_name: string,
  pageUrl: string,
  tiles: TileCandidate[],
): Promise<{ stored: number; failed: number; refreshed: number }> {
  let stored = 0;
  let failed = 0;
  let refreshed = 0;

  // Download + hash everything first (network-bound, parallelizable).
  type Prepared = {
    tile: TileCandidate;
    normalized: string;
    storagePath: string;
    phashHex: string | null;
    phashPg: string | null;
  };
  const prepared: Prepared[] = [];
  for (const tile of tiles) {
    const normalized = normalizeName(tile.game_name);
    if (!normalized) continue;
    const gameSlug = slugify(tile.game_name);
    const r = await downloadAndStore(tile.thumbnail_url, casino_slug, gameSlug);
    if (!r) {
      failed++;
      continue;
    }
    prepared.push({
      tile,
      normalized,
      storagePath: r.storagePath,
      phashHex: r.phashBytes ? bytesToHex(r.phashBytes) : null,
      phashPg: r.phashBytes ? bytesToPgHex(r.phashBytes) : null,
    });
  }

  if (prepared.length === 0) return { stored, failed, refreshed };

  // Look up which combos already exist so we can split inserts from updates.
  const normalizedNames = prepared.map((p) => p.normalized);
  const { data: existingRows } = await sb
    .from("casino_catalog_thumbnails")
    .select("id, game_name_normalized, provider_name")
    .eq("casino_slug", casino_slug)
    .in("game_name_normalized", normalizedNames);

  const existingKey = (n: string, p: string) => `${n} ${p}`;
  const existing = new Map<string, string>();
  for (const row of existingRows ?? []) {
    existing.set(
      existingKey(row.game_name_normalized, row.provider_name ?? ""),
      row.id,
    );
  }

  const now = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];

  for (const p of prepared) {
    const provider = p.tile.provider ?? "";
    const id = existing.get(existingKey(p.normalized, provider));
    const base = {
      casino_slug,
      casino_name,
      game_name_raw: p.tile.game_name,
      game_name_normalized: p.normalized,
      provider_name: provider,
      thumbnail_url: p.storagePath,
      thumbnail_source_url: p.tile.thumbnail_url,
      source_page_url: pageUrl,
      phash: p.phashPg,
      last_seen_at: now,
      updated_at: now,
      metadata: { phash_hex: p.phashHex },
    };
    if (id) {
      // Existing row: refresh URL/phash/last_seen, but DO NOT touch
      // `status` or `game_library_id` — those belong to the merge step.
      const { error } = await sb
        .from("casino_catalog_thumbnails")
        .update(base)
        .eq("id", id);
      if (error) {
        console.error("update error", error, p.tile.game_name);
        failed++;
      } else {
        refreshed++;
      }
    } else {
      inserts.push({ ...base, status: "pending" });
    }
  }

  if (inserts.length > 0) {
    const { error } = await sb
      .from("casino_catalog_thumbnails")
      .insert(inserts);
    if (error) {
      console.error("bulk insert error", error);
      failed += inserts.length;
    } else {
      stored += inserts.length;
    }
  }

  return { stored, failed, refreshed };
}

async function actionScrapeCasino(payload: any) {
  const casino_slug = String(payload.casino_slug || "").trim();
  const casino_name = String(payload.casino_name || casino_slug).trim();
  const urls: string[] = Array.isArray(payload.urls) ? payload.urls : [];
  if (!casino_slug || urls.length === 0) {
    return json({ error: "casino_slug and urls[] required" }, 400);
  }
  if (!FIRECRAWL_API_KEY) return json({ error: "FIRECRAWL_API_KEY missing" }, 500);

  await sb.from("casino_catalogs").upsert(
    {
      casino_slug,
      casino_name,
      urls,
      is_active: true,
      last_scraped_at: new Date().toISOString(),
    },
    { onConflict: "casino_slug" },
  );

  const task = (async () => {
    let totalTiles = 0;
    let stored = 0;
    let refreshed = 0;
    let failed = 0;
    for (const pageUrl of urls) {
      try {
        const html = await firecrawlScrape(pageUrl);
        if (!html) {
          failed++;
          continue;
        }
        const tiles = extractTiles(html, pageUrl);
        totalTiles += tiles.length;
        const r = await processTiles(casino_slug, casino_name, pageUrl, tiles);
        stored += r.stored;
        refreshed += r.refreshed;
        failed += r.failed;
      } catch (e) {
        console.error("page error", pageUrl, e);
        failed++;
      }
    }
    console.log(
      `[scrape_casino] ${casino_slug} done — tiles=${totalTiles} stored=${stored} refreshed=${refreshed} failed=${failed}`,
    );
  })();

  try {
    // @ts-ignore
    EdgeRuntime?.waitUntil?.(task);
  } catch {
    // noop
  }

  return json({
    ok: true,
    casino_slug,
    urls_count: urls.length,
    message: "Scraping started in background. Poll /status for progress.",
  });
}

async function actionIngestHtml(payload: any) {
  const casino_slug = String(payload.casino_slug || "").trim();
  const casino_name = String(payload.casino_name || casino_slug).trim();
  const html = String(payload.html || "");
  const source_page_url = String(payload.source_page_url || "about:blank");
  if (!casino_slug || !html) {
    return json({ error: "casino_slug and html required" }, 400);
  }
  if (html.length > 12_000_000) {
    return json({ error: "html too large (>12MB)" }, 413);
  }

  await sb.from("casino_catalogs").upsert(
    {
      casino_slug,
      casino_name,
      urls: source_page_url && source_page_url !== "about:blank"
        ? [source_page_url]
        : [],
      is_active: true,
      last_scraped_at: new Date().toISOString(),
    },
    { onConflict: "casino_slug" },
  );

  const tiles = extractTiles(html, source_page_url);
  const tilesFound = tiles.length;

  const task = (async () => {
    const r = await processTiles(
      casino_slug,
      casino_name,
      source_page_url,
      tiles,
    );
    console.log(
      `[ingest_html] ${casino_slug} done — tiles=${tilesFound} stored=${r.stored} refreshed=${r.refreshed} failed=${r.failed}`,
    );
  })();

  try {
    // @ts-ignore
    EdgeRuntime?.waitUntil?.(task);
  } catch {
    // noop
  }

  return json({
    ok: true,
    casino_slug,
    tiles_found: tilesFound,
    message: tilesFound === 0
      ? "Nenhum tile detectado no HTML. Role a página até o fim antes de copiar para carregar os tiles lazy."
      : `${tilesFound} tiles detectados. Processando em background.`,
  });
}

async function actionStatus(payload: any) {
  const casino_slug = String(payload.casino_slug || "").trim();
  if (!casino_slug) return json({ error: "casino_slug required" }, 400);
  const { count: total } = await sb
    .from("casino_catalog_thumbnails")
    .select("*", { count: "exact", head: true })
    .eq("casino_slug", casino_slug);
  const { count: matched } = await sb
    .from("casino_catalog_thumbnails")
    .select("*", { count: "exact", head: true })
    .eq("casino_slug", casino_slug)
    .eq("status", "matched");
  const { count: pending } = await sb
    .from("casino_catalog_thumbnails")
    .select("*", { count: "exact", head: true })
    .eq("casino_slug", casino_slug)
    .eq("status", "pending");
  const { count: newPending } = await sb
    .from("casino_catalog_thumbnails")
    .select("*", { count: "exact", head: true })
    .eq("casino_slug", casino_slug)
    .eq("status", "new_pending_dna");
  const { data: catalog } = await sb
    .from("casino_catalogs")
    .select("*")
    .eq("casino_slug", casino_slug)
    .maybeSingle();
  const { data: samples } = await sb
    .from("casino_catalog_thumbnails")
    .select(
      "game_name_raw, provider_name, thumbnail_url, status, game_library_id, metadata",
    )
    .eq("casino_slug", casino_slug)
    .order("updated_at", { ascending: false })
    .limit(20);
  return json({
    casino: catalog,
    total: total ?? 0,
    matched: matched ?? 0,
    pending: pending ?? 0,
    new_pending_dna: newPending ?? 0,
    samples: samples ?? [],
  });
}

async function actionMergeToLibrary(payload: any) {
  const casino_slug = String(payload.casino_slug || "").trim();
  if (!casino_slug) return json({ error: "casino_slug required" }, 400);

  const { data: rows, error } = await sb
    .from("casino_catalog_thumbnails")
    .select("*")
    .eq("casino_slug", casino_slug)
    .in("status", ["pending"]);
  if (error) return json({ error: error.message }, 500);

  // pHash fallback config — distance ≤ N counts as a confident match.
  const { data: cfg } = await sb
    .from("pipeline_configs")
    .select("config_key, config_value")
    .eq("config_key", "solo_phash_max_distance")
    .maybeSingle();
  const phashMaxDistance = Number(cfg?.config_value ?? 10);

  let matched = 0;
  let matchedByPhash = 0;
  let created = 0;
  let failed = 0;

  for (const r of rows ?? []) {
    try {
      const escapedName = escapeIlike(r.game_name_raw);
      const { data: candidates } = await sb
        .from("game_visual_library")
        .select("id, game_name, provider_name, thumbnails, thumbnail_phash")
        .ilike("game_name", escapedName);

      let matchedRow = (candidates ?? []).find((c) =>
        normalizeName(c.game_name) === r.game_name_normalized &&
        (!r.provider_name || !c.provider_name ||
          normalizeName(c.provider_name) === normalizeName(r.provider_name))
      );
      let matchSource: "name" | "phash" = "name";

      // Name match failed — try perceptual hash before creating a new entry.
      // This catches the cross-casino case where the same game has slightly
      // different names ("Gates of Olympus" vs "Gates of Olympus 1000") but
      // identical key art.
      if (!matchedRow && r.phash) {
        const { data: phashHits } = await sb.rpc("find_game_by_phash", {
          query_phash: r.phash,
          max_distance: phashMaxDistance,
        });
        const top = (phashHits ?? []).find(
          (h: any) => h.source === "library" && h.game_library_id,
        );
        if (top) {
          const { data: row } = await sb
            .from("game_visual_library")
            .select("id, game_name, provider_name, thumbnails, thumbnail_phash")
            .eq("id", top.game_library_id)
            .maybeSingle();
          if (row) {
            matchedRow = row;
            matchSource = "phash";
            matchedByPhash++;
          }
        }
      }

      if (matchedRow) {
        const thumbs = Array.isArray(matchedRow.thumbnails)
          ? matchedRow.thumbnails
          : [];
        // Dedup by storage_path so re-runs don't accumulate identical entries
        // (this was happening even when the row was previously "matched").
        if (!thumbs.some((t: any) => t?.storage_path === r.thumbnail_url)) {
          thumbs.push({
            casino: casino_slug,
            storage_path: r.thumbnail_url,
            phash_hex: r.metadata?.phash_hex ?? null,
            captured_at: new Date().toISOString(),
            match_source: matchSource,
          });
        }
        await sb.from("game_visual_library").update({
          thumbnails: thumbs,
          // Seed phash on first match so subsequent VOD queries have it.
          thumbnail_phash: matchedRow.thumbnail_phash ?? r.phash,
          updated_at: new Date().toISOString(),
        }).eq("id", matchedRow.id);
        await sb.from("casino_catalog_thumbnails").update({
          status: "matched",
          game_library_id: matchedRow.id,
          updated_at: new Date().toISOString(),
        }).eq("id", r.id);
        matched++;
      } else {
        const { data: ins, error: insErr } = await sb
          .from("game_visual_library")
          .insert({
            game_name: r.game_name_raw,
            provider_name: r.provider_name || "Unknown",
            provider_slug: slugify(r.provider_name || "unknown"),
            source_url: r.thumbnail_url || r.source_page_url,
            // Já marca como "trained" pra que o agente possa aprender o
            // perfil a partir da thumbnail (key art do provedor). Origem
            // (casino_slug) é só metadado.
            training_status: "trained",
            thumbnail_phash: r.phash,
            thumbnails: [{
              casino: casino_slug,
              storage_path: r.thumbnail_url,
              phash_hex: r.metadata?.phash_hex ?? null,
              captured_at: new Date().toISOString(),
              match_source: "new",
            }],
            metadata: { origin: "casino_catalog", source_site: casino_slug },
          })
          .select("id")
          .single();
        if (insErr) {
          console.error("library insert error", insErr);
          failed++;
          continue;
        }
        await sb.from("casino_catalog_thumbnails").update({
          status: "new_pending_dna",
          game_library_id: ins.id,
          updated_at: new Date().toISOString(),
        }).eq("id", r.id);
        created++;
      }
    } catch (e) {
      console.error("merge row error", e);
      failed++;
    }
  }

  return json({
    ok: true,
    processed: rows?.length ?? 0,
    matched,
    matched_by_phash: matchedByPhash,
    created,
    failed,
  });
}

async function actionListCasinos() {
  const { data, error } = await sb
    .from("casino_catalogs")
    .select("*")
    .order("casino_name");
  if (error) return json({ error: error.message }, 500);
  return json({ casinos: data ?? [] });
}

async function actionUpsertCasino(payload: any) {
  const casino_slug = String(payload.casino_slug || "").trim();
  const casino_name = String(payload.casino_name || "").trim();
  const urls: string[] = Array.isArray(payload.urls) ? payload.urls : [];
  const is_active = payload.is_active !== false;
  if (!casino_slug || !casino_name) {
    return json({ error: "casino_slug and casino_name required" }, 400);
  }
  const { error } = await sb.from("casino_catalogs").upsert(
    { casino_slug, casino_name, urls, is_active, updated_at: new Date().toISOString() },
    { onConflict: "casino_slug" },
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function actionDeleteCasino(payload: any) {
  const casino_slug = String(payload.casino_slug || "").trim();
  if (!casino_slug) return json({ error: "casino_slug required" }, 400);
  const { error: e1 } = await sb
    .from("casino_catalog_thumbnails")
    .delete()
    .eq("casino_slug", casino_slug);
  if (e1) return json({ error: e1.message }, 500);
  const { error: e2 } = await sb
    .from("casino_catalogs")
    .delete()
    .eq("casino_slug", casino_slug);
  if (e2) return json({ error: e2.message }, 500);
  return json({ ok: true });
}

// ─── HTTP entry ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Admin gate — consistent with scanner-write / game-scrapper. Without this,
  // anyone with the anon key (shipped in the frontend bundle) could call
  // delete_casino or hammer scrape_casino against arbitrary URLs.
  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const adminCheck = await requireAdmin(authResult.supabase, authResult.userId);
  if (adminCheck) return adminCheck;

  try {
    const payload = await req.json();
    const action = String(payload.action || "");
    switch (action) {
      case "scrape_casino":
        return await actionScrapeCasino(payload);
      case "ingest_html":
        return await actionIngestHtml(payload);
      case "status":
        return await actionStatus(payload);
      case "merge_to_library":
        return await actionMergeToLibrary(payload);
      case "list_casinos":
        return await actionListCasinos();
      case "upsert_casino":
        return await actionUpsertCasino(payload);
      case "delete_casino":
        return await actionDeleteCasino(payload);
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("handler error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
