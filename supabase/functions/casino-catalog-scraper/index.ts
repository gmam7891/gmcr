// Casino Catalog Scraper
// Scrapes online casino lobby pages (e.g. BullsBet), extracts game tiles,
// computes perceptual hashes (pHash) of thumbnails, and merges them into
// game_visual_library.
//
// Actions:
//   - scrape_casino  { casino_slug, casino_name?, urls[] }
//   - status         { casino_slug }
//   - merge_to_library { casino_slug }
//   - list_casinos
//   - upsert_casino  { casino_slug, casino_name, urls[], is_active? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ─── Utils ────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(s: string): string {
  return normalizeName(s).replace(/\s+/g, "-");
}

// ─── pHash (DCT 8x8) in pure TS ───────────────────────────────────────
// Reduces image to 32x32 grayscale, runs 2D DCT, keeps the top-left 8x8
// low-frequency block, compares each coefficient to the median, outputs
// 64-bit hash. Industry-standard pHash.

async function decodeImageToGrayscale32(
  bytes: Uint8Array,
): Promise<Float64Array | null> {
  try {
    // Deno has no native image decoder; use ImageScript via esm.sh
    const { Image } = await import("https://esm.sh/imagescript@1.2.17");
    const img = await Image.decode(bytes);
    const resized = img.resize(32, 32);
    const gray = new Float64Array(32 * 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const pixel = resized.getPixelAt(x + 1, y + 1); // 1-indexed
        const r = (pixel >> 24) & 0xff;
        const g = (pixel >> 16) & 0xff;
        const b = (pixel >> 8) & 0xff;
        gray[y * 32 + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }
    return gray;
  } catch (e) {
    console.error("decodeImageToGrayscale32 failed:", e);
    return null;
  }
}

function dct1d(input: Float64Array, N: number): Float64Array {
  const out = new Float64Array(N);
  const factor = Math.PI / N;
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += input[n] * Math.cos((n + 0.5) * k * factor);
    }
    out[k] = sum;
  }
  return out;
}

function dct2d(matrix: Float64Array, N: number): Float64Array {
  const tmp = new Float64Array(N * N);
  const row = new Float64Array(N);
  // rows
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) row[x] = matrix[y * N + x];
    const r = dct1d(row, N);
    for (let x = 0; x < N; x++) tmp[y * N + x] = r[x];
  }
  // cols
  const out = new Float64Array(N * N);
  const col = new Float64Array(N);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) col[y] = tmp[y * N + x];
    const c = dct1d(col, N);
    for (let y = 0; y < N; y++) out[y * N + x] = c[y];
  }
  return out;
}

async function computePHash(bytes: Uint8Array): Promise<Uint8Array | null> {
  const gray = await decodeImageToGrayscale32(bytes);
  if (!gray) return null;
  const dct = dct2d(gray, 32);
  // top-left 8x8, skip DC (0,0)
  const coefs: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      coefs.push(dct[y * 32 + x]);
    }
  }
  // median excluding DC
  const sorted = [...coefs.slice(1)].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bits: number[] = coefs.map((c) => (c > median ? 1 : 0));
  // pack 64 bits into 8 bytes
  const out = new Uint8Array(8);
  for (let i = 0; i < 64; i++) {
    if (bits[i]) out[i >> 3] |= 1 << (7 - (i & 7));
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// supabase-js passes bytea as `\x...` hex string in postgrest
function bytesToPgHex(b: Uint8Array): string {
  return "\\x" + bytesToHex(b);
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
// Extracts {game_name, provider?, thumbnail_url} tuples from HTML.
// Generic extractor: finds <img> tags whose src looks like a game tile
// (CDN image, jpg/png/webp) and pulls name from alt/title/data attrs or
// nearby text. Works for most casino lobbies including BullsBet.

interface TileCandidate {
  game_name: string;
  provider: string | null;
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

function inferProvider(name: string, src: string): string | null {
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
  return null;
}

function extractTiles(html: string, baseUrl: string): TileCandidate[] {
  const tiles: TileCandidate[] = [];
  const seen = new Set<string>();
  // Match all <img ...> tags
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
    if (!/\.(jpe?g|png|webp|avif)(\?|#|$)/i.test(srcRaw)) continue;
    if (/icon|logo|sprite|placeholder|loader|avatar/i.test(srcRaw)) continue;

    const src = absolutize(srcRaw, baseUrl);
    if (seen.has(src)) continue;

    const alt = get("alt") || get("title") || get("aria-label") || "";
    const name = alt.trim();
    if (!name || name.length < 2 || name.length > 80) continue;
    // Skip generic UI labels
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
  { storagePath: string; phashBytes: Uint8Array | null; bytes: Uint8Array } | null
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
    const phashBytes = await computePHash(bytes);
    return { storagePath: path, phashBytes, bytes };
  } catch (e) {
    console.error("downloadAndStore failed", thumbUrl, e);
    return null;
  }
}

// ─── Actions ───────────────────────────────────────────────────────────

async function processTiles(
  casino_slug: string,
  casino_name: string,
  pageUrl: string,
  tiles: TileCandidate[],
): Promise<{ stored: number; failed: number }> {
  let stored = 0;
  let failed = 0;
  for (const tile of tiles) {
    try {
      const normalized = normalizeName(tile.game_name);
      if (!normalized) continue;
      const gameSlug = slugify(tile.game_name);
      const result = await downloadAndStore(
        tile.thumbnail_url,
        casino_slug,
        gameSlug,
      );
      if (!result) {
        failed++;
        continue;
      }
      const row = {
        casino_slug,
        casino_name,
        game_name_raw: tile.game_name,
        game_name_normalized: normalized,
        provider_name: tile.provider,
        thumbnail_url: result.storagePath,
        thumbnail_source_url: tile.thumbnail_url,
        source_page_url: pageUrl,
        phash: result.phashBytes ? bytesToPgHex(result.phashBytes) : null,
        status: "pending",
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          phash_hex: result.phashBytes ? bytesToHex(result.phashBytes) : null,
        },
      };
      const { error } = await sb
        .from("casino_catalog_thumbnails")
        .upsert(row, {
          onConflict: "casino_slug,game_name_normalized,provider_name",
        });
      if (error) {
        console.error("upsert error", error, row.game_name_raw);
        failed++;
      } else {
        stored++;
      }
    } catch (e) {
      console.error("tile error", e);
      failed++;
    }
  }
  return { stored, failed };
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
        failed += r.failed;
      } catch (e) {
        console.error("page error", pageUrl, e);
        failed++;
      }
    }
    console.log(
      `[scrape_casino] ${casino_slug} done — tiles=${totalTiles} stored=${stored} failed=${failed}`,
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
      `[ingest_html] ${casino_slug} done — tiles=${tilesFound} stored=${r.stored} failed=${r.failed}`,
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

  let matched = 0;
  let created = 0;
  let failed = 0;

  for (const r of rows ?? []) {
    try {
      // Try exact match by normalized name (and provider when present)
      const q = sb
        .from("game_visual_library")
        .select("id, game_name, provider_name, thumbnails, thumbnail_phash")
        .ilike("game_name", r.game_name_raw);
      const { data: candidates } = await q;
      let matchedRow = (candidates ?? []).find((c) =>
        normalizeName(c.game_name) === r.game_name_normalized &&
        (!r.provider_name || !c.provider_name ||
          normalizeName(c.provider_name) === normalizeName(r.provider_name))
      );

      if (matchedRow) {
        const thumbs = Array.isArray(matchedRow.thumbnails)
          ? matchedRow.thumbnails
          : [];
        thumbs.push({
          casino: casino_slug,
          storage_path: r.thumbnail_url,
          phash_hex: r.metadata?.phash_hex ?? null,
          captured_at: new Date().toISOString(),
        });
        await sb.from("game_visual_library").update({
          thumbnails: thumbs,
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
        // Create new library entry as pending DNA
        const { data: ins, error: insErr } = await sb
          .from("game_visual_library")
          .insert({
            game_name: r.game_name_raw,
            provider_name: r.provider_name ?? "Unknown",
            provider_slug: slugify(r.provider_name ?? "unknown"),
            source_url: r.source_page_url,
            training_status: "pending",
            thumbnail_phash: r.phash,
            thumbnails: [{
              casino: casino_slug,
              storage_path: r.thumbnail_url,
              phash_hex: r.metadata?.phash_hex ?? null,
              captured_at: new Date().toISOString(),
            }],
            metadata: { origin: "casino_catalog", casino: casino_slug },
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

  return json({ ok: true, processed: rows?.length ?? 0, matched, created, failed });
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

// ─── HTTP entry ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const payload = await req.json();
    const action = String(payload.action || "");
    switch (action) {
      case "scrape_casino":
        return await actionScrapeCasino(payload);
      case "status":
        return await actionStatus(payload);
      case "merge_to_library":
        return await actionMergeToLibrary(payload);
      case "list_casinos":
        return await actionListCasinos();
      case "upsert_casino":
        return await actionUpsertCasino(payload);
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("handler error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
