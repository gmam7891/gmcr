// Shared action handlers for scanner-* edge functions.
// Split: READ_ACTIONS = safe queries; WRITE_ACTIONS = mutations (require admin).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const RAPIDAPI_KEY = Deno.env.get("RAPIDAPI_KEY") || "";
const TWITCH_SCRAPER_HOST = "twitch-scraper-v2.p.rapidapi.com";

/**
 * Resposta normalizada do status de live de um canal Twitch.
 * Não importa se vem do Apify, Helix ou RapidAPI — todos preenchem isso.
 */
export interface TwitchLiveStatus {
  user_id: string;
  is_live: boolean;
  stream_id: string | null;
  game_id: string | null;
  game_name: string | null;
  game_slug: string | null;
  started_at: string | null;
  source: "rapidapi" | "helix" | "apify";
}

/**
 * Consulta status de live de um streamer Twitch via RapidAPI.
 * Endpoint testado: GET /api/channels/stream/info?channel={username}
 *
 * @returns null se RAPIDAPI_KEY não estiver configurada ou se a chamada falhar.
 */
export async function getTwitchLiveStatusViaRapidAPI(
  login: string
): Promise<TwitchLiveStatus | null> {
  if (!RAPIDAPI_KEY) {
    console.warn("[twitch-scraper-v2] RAPIDAPI_KEY não configurada");
    return null;
  }

  try {
    const url = `https://${TWITCH_SCRAPER_HOST}/api/channels/stream/info?channel=${encodeURIComponent(login)}`;
    console.log(`[twitch-scraper-v2] Calling: ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-host": TWITCH_SCRAPER_HOST,
        "x-rapidapi-key": RAPIDAPI_KEY,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`[twitch-scraper-v2] HTTP ${res.status} para login=${login}`);
      return null;
    }

    const json = await res.json();
    if (json?.status !== "ok" || !json?.data?.user) {
      console.warn("[twitch-scraper-v2] Response inesperado:", json);
      return null;
    }

    const user = json.data.user;
    const stream = user.stream;

    return {
      user_id: String(user.id || ""),
      is_live: !!stream,
      stream_id: stream?.id ? String(stream.id) : null,
      game_id: stream?.game?.id ? String(stream.game.id) : null,
      game_name: stream?.game?.name || null,
      game_slug: stream?.game?.slug || null,
      started_at: stream?.createdAt || null,
      source: "rapidapi",
    };
  } catch (e: any) {
    console.warn(`[twitch-scraper-v2] Error fetching ${login}:`, e.message);
    return null;
  }
}

/**
 * Resposta normalizada com dados completos de um canal Twitch.
 */
export interface TwitchChannelInfo {
  user_id: string;
  login: string;
  display_name: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  view_count: number;
  follower_count: number;
  created_at: string | null;
  is_partner: boolean;
  is_affiliate: boolean;
  broadcaster_type: string;
  source: "rapidapi";
}

/**
 * Busca dados completos de um canal Twitch via RapidAPI.
 * Endpoint: GET /api/channels/info/{login}
 *
 * @returns null se RAPIDAPI_KEY não estiver configurada ou se a chamada falhar.
 */
export async function getTwitchChannelInfoViaRapidAPI(
  login: string
): Promise<TwitchChannelInfo | null> {
  if (!RAPIDAPI_KEY) {
    console.warn("[twitch-scraper-v2] RAPIDAPI_KEY não configurada");
    return null;
  }

  try {
    const url = `https://${TWITCH_SCRAPER_HOST}/api/channels/info/${encodeURIComponent(login)}`;
    console.log(`[twitch-scraper-v2] Calling channel info: ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-host": TWITCH_SCRAPER_HOST,
        "x-rapidapi-key": RAPIDAPI_KEY,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`[twitch-scraper-v2] HTTP ${res.status} para channel info ${login}`);
      return null;
    }

    const json = await res.json();
    console.log(`[twitch-scraper-v2] channel info FULL response:`, JSON.stringify(json));

    const root = json?.data?.user
      ?? json?.data?.channel
      ?? json?.data
      ?? json;

    if (!root || typeof root !== "object") {
      console.warn("[twitch-scraper-v2] channel info: raiz não encontrada");
      return null;
    }

    return {
      user_id: String(root.id || root.userId || root.user_id || ""),
      login: String(root.login || root.username || login),
      display_name: String(root.displayName || root.display_name || root.name || login),
      description: String(root.description || root.bio || ""),
      profile_image_url: String(root.profileImageURL || root.profile_image_url || root.avatar || ""),
      offline_image_url: String(root.offlineImageURL || root.offline_image_url || ""),
      view_count: Number(root.viewCount || root.view_count || root.totalViews || 0),
      follower_count: Number(root.followers || root.follower_count || root.followerCount || 0),
      created_at: root.createdAt || root.created_at || null,
      is_partner: !!(root.isPartner || root.is_partner || root.partner),
      is_affiliate: !!(root.isAffiliate || root.is_affiliate || root.affiliate),
      broadcaster_type: String(root.broadcasterType || root.broadcaster_type || ""),
      source: "rapidapi",
    };
  } catch (e: any) {
    console.warn(`[twitch-scraper-v2] Error fetching channel info ${login}:`, e.message);
    return null;
  }
}

export const READ_ACTIONS = new Set([
  "get_status",
  "get_dashboard",
  "get_rankings",
  "get_trend_weekly",
  "get_results_aggregated",
  "get_review_queue",
  "get_quality_metrics",
  "get_pipeline_config",
  "get_vod_audit_detail",
  "get_queue",
  "get_chat_stats",
  "test_rapidapi_twitch",
]);

export const WRITE_ACTIONS = new Set([
  "save_raw_evidences",
  "validate_vod",
  "consolidate_vod",
  "compute_metrics",
  "run_pipeline",
  "review_block",
  "request_reprocess",
  "update_pipeline_config",
  "enqueue_job",
  "save_detections",
  "reconcile",
  "process_vod",
]);

// ─────────────── READS ───────────────
const HARD_LIMIT_BLOCKS = 5000;
const HARD_LIMIT_RANKINGS = 5000;
const HARD_LIMIT_RESULTS = 5000;

async function resolveProviderNames(
  supabase: SupabaseClient,
  providerIds: string[],
): Promise<string[]> {
  if (!providerIds || providerIds.length === 0) return [];
  const { data } = await supabase.from("providers").select("name").in("id", providerIds);
  return (data || []).map((r: any) => String(r.name)).filter(Boolean);
}

async function resolveGameName(
  supabase: SupabaseClient,
  gameId: string | null | undefined,
): Promise<string | null> {
  if (!gameId) return null;
  const { data } = await supabase.from("games").select("name").eq("id", gameId).maybeSingle();
  return data?.name ? String(data.name) : null;
}

function applyBlockFilters(
  query: any,
  body: any,
  resolvedProviderNames: string[],
  resolvedGameName: string | null,
) {
  const {
    date_from, date_to, platform, streamer, streamers,
    source_type, block_status_filter,
  } = body;
  const streamerList: string[] = Array.isArray(streamers) ? streamers.filter(Boolean) : [];
  if (streamerList.length === 1) query = query.eq("streamer_login", streamerList[0]);
  else if (streamerList.length > 1) query = query.in("streamer_login", streamerList);
  else if (streamer) query = query.eq("streamer_login", streamer);
  if (platform) query = query.eq("platform", platform);
  if (source_type) query = query.eq("source_type", source_type);
  if (resolvedProviderNames.length === 1) query = query.eq("provider_name", resolvedProviderNames[0]);
  else if (resolvedProviderNames.length > 1) query = query.in("provider_name", resolvedProviderNames);
  if (resolvedGameName) query = query.eq("game_name", resolvedGameName);
  if (block_status_filter && block_status_filter !== "all") query = query.eq("status", block_status_filter);
  if (date_from) query = query.gte("created_at", date_from);
  if (date_to) query = query.lte("created_at", date_to);
  return query;
}

export async function handleRead(supabase: SupabaseClient, body: any) {
  const { action } = body;

  if (action === "test_rapidapi_twitch") {
    const { login } = body;
    if (!login) return { error: "login é obrigatório" };
    const [liveStatus, channelInfo] = await Promise.all([
      getTwitchLiveStatusViaRapidAPI(String(login)),
      getTwitchChannelInfoViaRapidAPI(String(login)),
    ]);
    return { login, live_status: liveStatus, channel_info: channelInfo, raw_secret_configured: !!Deno.env.get("RAPIDAPI_KEY") };
  }

  if (action === "get_status") {
    const [audits, blocks, queue] = await Promise.all([
      supabase.from("vod_audits").select("id", { count: "exact", head: true }),
      supabase.from("gameplay_blocks").select("id", { count: "exact", head: true }),
      supabase.from("processing_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    return { total_vods_audited: audits.count || 0, total_blocks: blocks.count || 0, pending_jobs: queue.count || 0 };
  }

  if (action === "get_dashboard") {
    const { provider_ids, game_id } = body;
    const resolvedProviderNames = await resolveProviderNames(supabase, provider_ids || []);
    const resolvedGameName = await resolveGameName(supabase, game_id);
    let query = supabase.from("gameplay_blocks").select("*");
    query = applyBlockFilters(query, body, resolvedProviderNames, resolvedGameName);
    const { data: blocks } = await query.order("created_at", { ascending: false }).limit(HARD_LIMIT_BLOCKS);
    const truncated = (blocks?.length || 0) >= HARD_LIMIT_BLOCKS;
    if (!blocks?.length) {
      return {
        total_exposure_seconds: 0, total_viewer_minutes: 0, unique_streamers: 0,
        total_detections: 0, avg_vod_coverage: 0,
        provider_share: {}, game_share: {}, chat_sentiment: {},
        truncated: false,
        applied_filters: { provider_names: resolvedProviderNames, game_name: resolvedGameName },
      };
    }
    const totalExposure = blocks.reduce((s: number, b: any) => s + (b.duration_seconds || 0), 0);
    const uniqueStreamers = new Set(blocks.map((b: any) => b.streamer_login)).size;
    const vodIdsInScope = new Set(blocks.map((b: any) => b.vod_id).filter(Boolean));
    type ShareEntry = { canonical: string; seconds: number };
    const providerShareNorm: Record<string, ShareEntry> = {};
    const gameShareNorm: Record<string, ShareEntry> = {};
    const trackShare = (
      bucket: Record<string, ShareEntry>,
      raw: string | null | undefined,
      seconds: number,
    ) => {
      if (!raw) return;
      const key = String(raw).trim().toLowerCase();
      if (!key) return;
      if (!bucket[key]) bucket[key] = { canonical: String(raw).trim(), seconds: 0 };
      bucket[key].seconds += seconds;
    };
    for (const b of blocks) {
      trackShare(providerShareNorm, b.provider_name, b.duration_seconds || 0);
      trackShare(gameShareNorm, b.game_name, b.duration_seconds || 0);
    }
    const providerShare: Record<string, number> = {};
    const gameShare: Record<string, number> = {};
    for (const e of Object.values(providerShareNorm)) providerShare[e.canonical] = e.seconds;
    for (const e of Object.values(gameShareNorm)) gameShare[e.canonical] = e.seconds;
    let auditQuery = supabase.from("vod_audits").select("coverage_percent, pending_audit_segments, vod_duration_seconds, streamer_login, platform, vod_id, created_at");
    const { date_from, date_to, platform, streamer, streamers } = body;
    const streamerList: string[] = Array.isArray(streamers) ? streamers.filter(Boolean) : [];
    if (streamerList.length === 1) auditQuery = auditQuery.eq("streamer_login", streamerList[0]);
    else if (streamerList.length > 1) auditQuery = auditQuery.in("streamer_login", streamerList);
    else if (streamer) auditQuery = auditQuery.eq("streamer_login", streamer);
    if (platform) auditQuery = auditQuery.eq("platform", platform);
    if (date_from) auditQuery = auditQuery.gte("created_at", date_from);
    if (date_to) auditQuery = auditQuery.lte("created_at", date_to);
    const { data: audits } = await auditQuery.limit(500);
    const avgCoverage = audits?.length ? audits.reduce((s: number, a: any) => s + (a.coverage_percent || 0), 0) / audits.length : 0;
    const twitchCategoryShare: Record<string, number> = {};
    for (const a of audits || []) {
      if (vodIdsInScope.size > 0 && !vodIdsInScope.has((a as any).vod_id)) continue;
      const segs: any = (a as any).pending_audit_segments;
      const chapters = segs?.plan?.chapters;
      if (Array.isArray(chapters)) {
        for (const ch of chapters) {
          const name = (ch.game || "Unknown").trim();
          twitchCategoryShare[name] = (twitchCategoryShare[name] || 0) + (ch.durationSeconds || 0);
        }
      }
    }
    const allKeys = new Set([...Object.keys(gameShare), ...Object.keys(twitchCategoryShare)]);
    const aiVsTwitch = Array.from(allKeys).map((name) => ({
      name, ai_seconds: gameShare[name] || 0, twitch_seconds: twitchCategoryShare[name] || 0,
    })).sort((a, b) => (b.ai_seconds + b.twitch_seconds) - (a.ai_seconds + a.twitch_seconds)).slice(0, 10);
    const viewerMinutes = blocks.reduce((sum: number, b: any) => {
      const durationMin = (b.duration_seconds || 0) / 60;
      const avgViewers = b.avg_viewers || b.peak_viewers || 0;
      return sum + durationMin * avgViewers;
    }, 0);
    return {
      total_exposure_seconds: totalExposure, total_viewer_minutes: Math.round(viewerMinutes),
      unique_streamers: uniqueStreamers, total_detections: blocks.length, avg_vod_coverage: avgCoverage,
      provider_share: providerShare, game_share: gameShare, twitch_category_share: twitchCategoryShare,
      ai_vs_twitch: aiVsTwitch, chat_sentiment: {},
      truncated,
      applied_filters: { provider_names: resolvedProviderNames, game_name: resolvedGameName },
    };
  }

  if (action === "get_rankings") {
    const { rank_by, provider_ids, game_id } = body;
    const resolvedProviderNames = await resolveProviderNames(supabase, provider_ids || []);
    const resolvedGameName = await resolveGameName(supabase, game_id);
    let query = supabase.from("gameplay_blocks").select("*");
    const effectiveBody = {
      ...body,
      block_status_filter: body.block_status_filter ?? "confirmed",
    };
    query = applyBlockFilters(query, effectiveBody, resolvedProviderNames, resolvedGameName);
    const { data: blocks } = await query.limit(HARD_LIMIT_RANKINGS);
    const truncated = (blocks?.length || 0) >= HARD_LIMIT_RANKINGS;
    if (!blocks?.length) return { rankings: [], truncated: false };
    const agg: Record<string, any> = {};
    for (const b of blocks) {
      const k = rank_by === "streamer" ? b.streamer_login
        : rank_by === "provider" ? (b.provider_name || "Unknown")
        : (b.game_name || "Unknown");
      if (!agg[k]) agg[k] = { key: k, exposure: 0, sessions: 0, viewer_minutes: 0, peak: 0 };
      agg[k].exposure += b.duration_seconds || 0;
      agg[k].sessions++;
      agg[k].viewer_minutes += Math.round((b.duration_seconds || 0) / 60);
    }
    const rankings = Object.values(agg).sort((a: any, b: any) => b.exposure - a.exposure).slice(0, 20);
    return { rankings, truncated };
  }

  if (action === "get_trend_weekly") {
    const { date_to, streamers, platform } = body;
    const refTo = date_to ? new Date(date_to) : new Date();
    const endCur = new Date(refTo);
    const startCur = new Date(endCur.getTime() - 7 * 86400000);
    const startPrev = new Date(startCur.getTime() - 7 * 86400000);
    async function fetchRange(from: Date, to: Date) {
      let q = supabase.from("gameplay_blocks")
        .select("provider_name,duration_seconds,streamer_login,platform,created_at,status")
        .eq("status", "confirmed")
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString());
      if (platform) q = q.eq("platform", platform);
      if (Array.isArray(streamers) && streamers.length) q = q.in("streamer_login", streamers);
      const { data } = await q.limit(5000);
      const share: Record<string, number> = {};
      for (const b of data || []) {
        const k = (b as any).provider_name || "Unknown";
        share[k] = (share[k] || 0) + ((b as any).duration_seconds || 0);
      }
      return share;
    }
    const [cur, prev] = await Promise.all([fetchRange(startCur, endCur), fetchRange(startPrev, startCur)]);
    const keys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
    const trend = Array.from(keys).map((name) => {
      const c = cur[name] || 0;
      const p = prev[name] || 0;
      const delta = c - p;
      const deltaPct = p > 0 ? (delta / p) * 100 : (c > 0 ? 100 : 0);
      return { name, current: c, previous: p, delta, delta_pct: deltaPct };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12);
    return {
      range: {
        current: { from: startCur.toISOString(), to: endCur.toISOString() },
        previous: { from: startPrev.toISOString(), to: startCur.toISOString() },
      },
      trend,
    };
  }

  if (action === "get_results_aggregated") {
    const { group_by, provider_ids, game_id } = body;
    const resolvedProviderNames = await resolveProviderNames(supabase, provider_ids || []);
    const resolvedGameName = await resolveGameName(supabase, game_id);
    let query = supabase.from("gameplay_blocks").select("*");
    const effectiveBody = {
      ...body,
      block_status_filter: body.block_status_filter ?? "confirmed",
    };
    query = applyBlockFilters(query, effectiveBody, resolvedProviderNames, resolvedGameName);
    const { data: blocks } = await query.order("created_at", { ascending: false }).limit(HARD_LIMIT_RESULTS);
    const truncated = (blocks?.length || 0) >= HARD_LIMIT_RESULTS;
    if (!blocks?.length) {
      return {
        aggregated: [],
        totals: { games: 0, blocks: 0, exposure_seconds: 0, vods: 0, streamers: 0 },
        blocks: [],
        truncated: false,
      };
    }
    const agg: Record<string, any> = {};
    for (const b of blocks) {
      const game = b.game_name || "Unknown";
      const provider = b.provider_name || "Unknown";
      const key = group_by === "vod" ? `${b.vod_id}::${game}` : group_by === "streamer_game" ? `${b.streamer_login}::${game}` : game;
      if (!agg[key]) agg[key] = { key, game, provider, exposure_seconds: 0, sessions: 0, avg_confidence: 0, vods: new Set(), streamers: new Set() };
      agg[key].exposure_seconds += b.duration_seconds || 0;
      agg[key].sessions++;
      agg[key].avg_confidence += Number(b.confidence_avg) || 0;
      agg[key].vods.add(b.vod_id);
      agg[key].streamers.add(b.streamer_login);
    }
    const aggregated = Object.values(agg).map((a: any) => ({
      key: a.key, game: a.game, provider: a.provider, exposure_seconds: a.exposure_seconds,
      exposure_minutes: Math.round(a.exposure_seconds / 60), sessions: a.sessions,
      avg_confidence: a.sessions > 0 ? a.avg_confidence / a.sessions : 0,
      vods_count: a.vods.size, streamers_count: a.streamers.size,
    })).sort((a: any, b: any) => b.exposure_seconds - a.exposure_seconds);
    const totalExposure = blocks.reduce((s: number, b: any) => s + (b.duration_seconds || 0), 0);
    return {
      aggregated,
      totals: {
        games: new Set(blocks.map((b: any) => b.game_name || "Unknown")).size,
        blocks: blocks.length, exposure_seconds: totalExposure, exposure_minutes: Math.round(totalExposure / 60),
        vods: new Set(blocks.map((b: any) => b.vod_id)).size,
        streamers: new Set(blocks.map((b: any) => b.streamer_login)).size,
      },
      blocks: blocks.slice(0, 500).map((b: any) => ({
        id: b.id, vod_id: b.vod_id, streamer_login: b.streamer_login, game_name: b.game_name, provider_name: b.provider_name,
        start_seconds: b.start_seconds, end_seconds: b.end_seconds, duration_seconds: b.duration_seconds,
        confidence_avg: b.confidence_avg, status: b.status, created_at: b.created_at,
      })),
      truncated,
      applied_filters: { provider_names: resolvedProviderNames, game_name: resolvedGameName },
    };
  }

  if (action === "get_review_queue") {
    const { data } = await supabase.from("gameplay_blocks").select("*")
      .in("status", ["suspect", "needs_review"]).order("created_at", { ascending: false }).limit(50);
    return { queue: data || [] };
  }

  if (action === "get_quality_metrics") {
    const { data: audits } = await supabase.from("vod_audits").select("*").limit(200);
    if (!audits?.length) return { confirmed_blocks: 0, suspect_blocks: 0, false_positive_rate: 0, avg_coverage: 0, avg_confidence: 0 };
    const confirmed = audits.reduce((s: number, a: any) => s + (a.confirmed_blocks || 0), 0);
    const suspect = audits.reduce((s: number, a: any) => s + (a.suspect_blocks || 0), 0);
    const discarded = audits.reduce((s: number, a: any) => s + (a.discarded_blocks || 0), 0);
    const total = confirmed + suspect + discarded;
    const fpr = total > 0 ? (discarded / total) * 100 : 0;
    const avgCoverage = audits.reduce((s: number, a: any) => s + (a.coverage_percent || 0), 0) / audits.length;
    const avgConfidence = audits.reduce((s: number, a: any) => s + (a.confidence_score || 0), 0) / audits.length;
    return { confirmed_blocks: confirmed, suspect_blocks: suspect, false_positive_rate: fpr, avg_coverage: avgCoverage, avg_confidence: avgConfidence };
  }

  if (action === "get_pipeline_config") {
    const { data } = await supabase.from("pipeline_configs").select("*").order("config_key");
    return { configs: data || [] };
  }

  if (action === "get_vod_audit_detail") {
    const { vod_id } = body;
    const [blocksRes, evidencesRes, logsRes] = await Promise.all([
      supabase.from("gameplay_blocks").select("*").eq("vod_id", vod_id).order("start_seconds"),
      supabase.from("raw_evidences").select("id, is_valid, validation_status, confidence_score, game_detected, provider_detected").eq("vod_id", vod_id),
      supabase.from("pipeline_audit_logs").select("*").eq("vod_id", vod_id).order("created_at", { ascending: false }).limit(20),
    ]);
    const evidences = evidencesRes.data || [];
    return {
      blocks: blocksRes.data || [], logs: logsRes.data || [],
      evidence_summary: {
        total: evidences.length,
        valid: evidences.filter((e: any) => e.is_valid).length,
        discarded: evidences.filter((e: any) => !e.is_valid).length,
      },
    };
  }

  if (action === "get_queue") {
    const { status } = body;
    let query = supabase.from("processing_queue").select("*");
    if (status) query = query.eq("status", status);
    const { data } = await query.order("created_at", { ascending: false }).limit(50);
    return { queue: data || [] };
  }

  if (action === "get_chat_stats") {
    const { streamer_login, date_from, date_to } = body;
    let query = supabase.from("chat_messages").select("sentiment_label");
    if (streamer_login) query = query.eq("streamer_login", streamer_login);
    if (date_from) query = query.gte("message_at", date_from);
    if (date_to) query = query.lte("message_at", date_to);
    const { data } = await query.limit(1000);
    const sentiment: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
    for (const m of data || []) {
      if ((m as any).sentiment_label && sentiment[(m as any).sentiment_label] !== undefined) {
        sentiment[(m as any).sentiment_label]++;
      }
    }
    return { sentiment, total: data?.length || 0 };
  }

  return null;
}

// ─────────────── WRITES (admin only) ───────────────
export async function handleWrite(supabase: SupabaseClient, body: any): Promise<any> {
  const { action } = body;

  if (action === "save_raw_evidences") {
    const { evidences, processing_batch_id } = body;
    if (!evidences?.length) return { saved: 0 };
    const rows = evidences.map((e: any) => ({
      vod_id: e.vod_id, streamer_login: e.streamer_login, platform: e.platform || "twitch",
      source_type: e.source_type || "vod", source_id: e.source_id || e.vod_id,
      timestamp_seconds: e.timestamp_seconds || 0, game_detected: e.game || null,
      provider_detected: e.provider || null, confidence_score: e.confidence || 0,
      processing_batch_id: processing_batch_id || null, validation_status: "pending", is_valid: true,
    }));
    const { error } = await supabase.from("raw_evidences").insert(rows);
    if (error) throw new Error(`save_raw_evidences: ${error.message}`);
    return { saved: rows.length };
  }

  if (action === "validate_vod") {
    const { vod_id } = body;
    // Re-validate ALL evidences for this VOD, not just the pending ones.
    // Otherwise stale rows from earlier runs (or rows the agent inserted with
    // is_valid already set) keep their old status and the consolidate step sees
    // an inconsistent mix of validation rules.
    const { data: evidences } = await supabase.from("raw_evidences").select("*")
      .eq("vod_id", vod_id);
    if (!evidences?.length) return { validated: 0 };
    let valid = 0, discarded = 0;
    for (const ev of evidences) {
      const screenState = (ev as any).screen_state || "gameplay";
      const isValid = screenState === "gameplay" && !!(ev as any).game_detected && ((ev as any).confidence_score || 0) >= 0.3;
      await supabase.from("raw_evidences").update({
        is_valid: isValid,
        validation_status: isValid ? "valid" : "discarded",
        discard_reason: isValid
          ? null
          : (screenState !== "gameplay" ? `not_gameplay:${screenState}` : "low_confidence"),
      }).eq("id", (ev as any).id);
      if (isValid) valid++; else discarded++;
    }
    return { validated: valid, discarded };
  }

  if (action === "consolidate_vod") {
    const { vod_id } = body;
    const { data: evidences } = await supabase.from("raw_evidences").select("*")
      .eq("vod_id", vod_id)
      .eq("is_valid", true)
      .or("screen_state.eq.gameplay,screen_state.is.null")
      .order("timestamp_seconds", { ascending: true });
    if (!evidences?.length) return { blocks: 0 };

    // Fetch audit metadata for interval calculation
    const { data: auditMeta } = await supabase
      .from("vod_audits")
      .select("expected_frames, vod_duration_seconds")
      .eq("vod_id", vod_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Derive frame interval from audit metadata (vod_duration / expected_frames).
    // Fallback to 39s only if metadata is missing.
    const frameInterval =
      auditMeta?.expected_frames && auditMeta?.vod_duration_seconds
        ? Math.max(15, Math.round(auditMeta.vod_duration_seconds / auditMeta.expected_frames))
        : 39;

    const halfInterval = Math.round(frameInterval / 2);

    type RawBlock = {
      game: string;
      provider: string;
      firstFrameTs: number;
      lastFrameTs: number;
      confidences: number[];
      count: number;
    };

    const rawBlocks: RawBlock[] = [];
    let current: RawBlock | null = null;
    // 1.5× tolerates one missed frame without splitting; 3× was allowing
    // ~2-minute breaks to inflate the previous block's duration.
    const gapThreshold = Math.round(frameInterval * 1.5);

    for (const ev of evidences as any[]) {
      if (!current || current.game !== ev.game_detected || (ev.timestamp_seconds - current.lastFrameTs) > gapThreshold) {
        if (current) rawBlocks.push(current);
        current = {
          game: ev.game_detected,
          provider: ev.provider_detected,
          firstFrameTs: ev.timestamp_seconds,
          lastFrameTs: ev.timestamp_seconds,
          confidences: [ev.confidence_score],
          count: 1,
        };
      } else {
        current.lastFrameTs = ev.timestamp_seconds;
        current.confidences.push(ev.confidence_score);
        current.count++;
      }
    }
    if (current) rawBlocks.push(current);

    const refinedBlocks = rawBlocks.map((b, idx) => {
      const prev = rawBlocks[idx - 1];
      const next = rawBlocks[idx + 1];
      const startSec = prev ? Math.round((prev.lastFrameTs + b.firstFrameTs) / 2) : Math.max(0, b.firstFrameTs - halfInterval);
      const endSec = next ? Math.round((b.lastFrameTs + next.firstFrameTs) / 2) : b.lastFrameTs + halfInterval;
      return { ...b, startSec, endSec: Math.max(endSec, startSec + halfInterval) };
    });

    const merged: typeof refinedBlocks = [];
    for (const block of refinedBlocks) {
      const last = merged[merged.length - 1];
      if (last && last.game === block.game && block.startSec - last.endSec <= Math.round(frameInterval * 1.5)) {
        last.endSec = block.endSec;
        last.lastFrameTs = block.lastFrameTs;
        last.confidences.push(...block.confidences);
        last.count += block.count;
      } else {
        merged.push({ ...block });
      }
    }

    const streamerLogin = (evidences[0] as any).streamer_login;
    const rows = merged.map((b) => {
      const avgConfidence = b.confidences.reduce((a, c) => a + c, 0) / b.confidences.length;
      const isLowConfidence = b.count === 1 || avgConfidence < 0.5;
      return {
        vod_id, streamer_login: streamerLogin, platform: "twitch", source_type: "vod", source_id: vod_id,
        game_name: b.game, provider_name: b.provider, start_seconds: b.startSec, end_seconds: b.endSec,
        duration_seconds: b.endSec - b.startSec, evidence_count: b.count,
        confidence_avg: avgConfidence,
        confidence_min: Math.min(...b.confidences), confidence_max: Math.max(...b.confidences),
        status: isLowConfidence ? "suspect" : "confirmed",
      };
    });
    // Replace existing blocks for this VOD instead of appending. Without the
    // delete, every re-run of the pipeline (agent finalize, watchdog re-invoke,
    // manual re-scan) duplicated rows in gameplay_blocks, inflating durations
    // and detection counts in the dashboard/audit views.
    await supabase.from("gameplay_blocks").delete().eq("vod_id", vod_id);
    if (rows.length) await supabase.from("gameplay_blocks").insert(rows);
    return { confirmed: rows.filter((r) => r.status === "confirmed").length, suspect: rows.filter((r) => r.status === "suspect").length };
  }

  if (action === "compute_metrics") {
    const { vod_id, vod_duration_seconds } = body;
    const { data: evidences } = await supabase.from("raw_evidences").select("id, is_valid").eq("vod_id", vod_id);
    const { data: blocks } = await supabase.from("gameplay_blocks").select("*").eq("vod_id", vod_id);
    const totalEv = evidences?.length || 0;
    const validEv = evidences?.filter((e: any) => e.is_valid)?.length || 0;
    const confirmed = blocks?.filter((b: any) => b.status === "confirmed") || [];
    const processedDur = confirmed.reduce((s: number, b: any) => s + (b.duration_seconds || 0), 0);
    const vodDur = vod_duration_seconds || 3600;
    const coverage = Math.min(100, Math.round((processedDur / vodDur) * 100));
    const confs = confirmed.map((b: any) => b.confidence_avg || 0);
    const avgConf = confs.length ? confs.reduce((a: number, c: number) => a + c, 0) / confs.length : 0;
    const auditRow = {
      vod_id, streamer_login: (blocks?.[0] as any)?.streamer_login || "unknown", platform: "twitch",
      status: "completed" as const, vod_duration_seconds: vodDur, processed_duration_seconds: processedDur,
      coverage_percent: coverage, confidence_score: Math.round(avgConf * 100),
      total_evidences: totalEv, valid_evidences: validEv, discarded_evidences: totalEv - validEv,
      confirmed_blocks: confirmed.length,
      suspect_blocks: blocks?.filter((b: any) => b.status === "suspect")?.length || 0,
      discarded_blocks: blocks?.filter((b: any) => b.status === "discarded")?.length || 0,
      completed_at: new Date().toISOString(),
    };
    const { data: existing } = await supabase.from("vod_audits").select("id").eq("vod_id", vod_id).maybeSingle();
    if (existing) await supabase.from("vod_audits").update(auditRow).eq("vod_id", vod_id);
    else await supabase.from("vod_audits").insert(auditRow);
    return { coverage, confidence: Math.round(avgConf * 100), confirmed: confirmed.length };
  }

  if (action === "run_pipeline") {
    const { vod_id, streamer_login, vod_duration_seconds } = body;
    const validate: any = await handleWrite(supabase, { action: "validate_vod", vod_id });
    const consolidate: any = await handleWrite(supabase, { action: "consolidate_vod", vod_id });
    const metrics: any = await handleWrite(supabase, { action: "compute_metrics", vod_id, vod_duration_seconds });
    await supabase.from("pipeline_audit_logs").insert({
      action: "run_pipeline", entity_type: "vod", entity_id: vod_id, vod_id,
      details: { streamer_login, validate, consolidate, metrics },
    });
    return { pipeline: "completed", vod_id, validate, consolidate, metrics };
  }

  if (action === "review_block") {
    const { block_id, new_status, review_notes, reviewer_id } = body;
    const { error } = await supabase.from("gameplay_blocks").update({
      status: new_status, review_notes, reviewed_by: reviewer_id || null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", block_id);
    if (error) throw new Error(error.message);
    await supabase.from("pipeline_audit_logs").insert({
      action: "review_block", entity_type: "gameplay_block", entity_id: block_id,
      details: { new_status, review_notes }, performed_by: reviewer_id || null,
    });
    return { success: true };
  }

  if (action === "request_reprocess") {
    const { vod_id } = body;
    await supabase.from("gameplay_blocks").delete().eq("vod_id", vod_id);
    await supabase.from("raw_evidences").delete().eq("vod_id", vod_id);
    await supabase.from("vod_audits").update({ status: "reprocessed" as const }).eq("vod_id", vod_id);
    return { reprocessed: true, vod_id };
  }

  if (action === "update_pipeline_config") {
    const { config_key, config_value } = body;
    const { error } = await supabase.from("pipeline_configs").upsert({
      config_key, config_value, updated_at: new Date().toISOString(),
    }, { onConflict: "config_key" });
    if (error) throw new Error(error.message);
    return { success: true };
  }

  if (action === "enqueue_job") {
    const { job_type, streamer_login, platform, source_id, priority, metadata } = body;
    const { error } = await supabase.from("processing_queue").insert({
      job_type, streamer_login, platform: platform || "twitch", source_id,
      priority: priority || "normal", metadata: metadata || {},
    });
    if (error) throw new Error(error.message);
    return { enqueued: true };
  }

  return null;
}

// ─────────────── AUTH HELPERS ───────────────
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function authenticate(req: Request): Promise<{ userId: string; supabase: SupabaseClient } | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized: missing bearer token" }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return jsonResponse({ error: "Unauthorized: invalid token" }, 401);
  }
  return {
    userId: userData.user.id,
    supabase: createClient(supabaseUrl, serviceKey),
  };
}

export async function requireAdmin(supabase: SupabaseClient, userId: string): Promise<Response | null> {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) return jsonResponse({ error: "Forbidden: admin role required" }, 403);
  return null;
}
