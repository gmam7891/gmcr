import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.99.2/cors";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twitch";

// ──────────────────────────────────────────────
// Pipeline Config defaults (overridden from DB)
// ──────────────────────────────────────────────
interface PipelineConfig {
  min_confidence_score: number;
  min_consecutive_hits: number;
  min_valid_duration_seconds: number;
  max_gap_to_merge_blocks: number;
  ignore_loading_screens: boolean;
  ignore_lobby_screens: boolean;
  ignore_overlay_only_frames: boolean;
  suspect_confidence_threshold: number;
  max_coverage_gap_percent: number;
}

const DEFAULT_CONFIG: PipelineConfig = {
  min_confidence_score: 50,
  min_consecutive_hits: 3,
  min_valid_duration_seconds: 60,
  max_gap_to_merge_blocks: 120,
  ignore_loading_screens: true,
  ignore_lobby_screens: true,
  ignore_overlay_only_frames: true,
  suspect_confidence_threshold: 70,
  max_coverage_gap_percent: 10,
};

async function loadConfig(supabase: any): Promise<PipelineConfig> {
  const { data } = await supabase.from("pipeline_configs").select("config_key, config_value");
  const cfg = { ...DEFAULT_CONFIG };
  if (data) {
    for (const row of data) {
      const key = row.config_key as keyof PipelineConfig;
      if (key in cfg) {
        if (typeof cfg[key] === "boolean") {
          (cfg as any)[key] = row.config_value === 1;
        } else {
          (cfg as any)[key] = Number(row.config_value);
        }
      }
    }
  }
  return cfg;
}

// Safe math utilities
function safeDivide(a: number, b: number, fallback = 0): number {
  if (!b || !isFinite(b) || b === 0) return fallback;
  const result = a / b;
  return isFinite(result) ? result : fallback;
}

function safePercent(part: number, total: number): number {
  return Math.min(100, Math.max(0, safeDivide(part, total) * 100));
}

function safeSum(arr: number[]): number {
  return arr.reduce((s, v) => s + (isFinite(v) ? v : 0), 0);
}

// ──────────────────────────────────────────────
// Audit log helper
// ──────────────────────────────────────────────
async function auditLog(supabase: any, action: string, entityType: string, entityId: string | null, vodId: string | null, details: any) {
  await supabase.from("pipeline_audit_logs").insert({
    action,
    entity_type: entityType,
    entity_id: entityId,
    vod_id: vodId,
    details,
  }).catch(() => {}); // non-blocking
}

// ──────────────────────────────────────────────
// STAGE A: Save raw evidences
// ──────────────────────────────────────────────
async function saveRawEvidences(supabase: any, params: any) {
  const { evidences, processing_batch_id } = params;
  if (!evidences || !Array.isArray(evidences) || evidences.length === 0) {
    return { error: "No evidences to save", saved: 0 };
  }

  // Load alias maps for normalization
  const [{ data: providerAliases }, { data: providers }, { data: gameAliases }, { data: games }] = await Promise.all([
    supabase.from("provider_aliases").select("alias, provider_id"),
    supabase.from("providers").select("id, name, slug"),
    supabase.from("game_aliases").select("alias, game_id"),
    supabase.from("games").select("id, name, slug"),
  ]);

  const providerMap: Record<string, string> = {};
  (providerAliases || []).forEach((a: any) => { providerMap[a.alias.toLowerCase()] = a.provider_id; });
  (providers || []).forEach((p: any) => {
    providerMap[p.name.toLowerCase()] = p.id;
    providerMap[p.slug.toLowerCase()] = p.id;
  });

  const gameMap: Record<string, string> = {};
  (gameAliases || []).forEach((a: any) => { gameMap[a.alias.toLowerCase()] = a.game_id; });
  (games || []).forEach((g: any) => {
    gameMap[g.name.toLowerCase()] = g.id;
    gameMap[g.slug.toLowerCase()] = g.id;
  });

  const batchId = processing_batch_id || crypto.randomUUID();

  // Deduplicate by vod_id + timestamp_seconds + image_hash
  const seen = new Set<string>();
  const rows = [];

  for (const e of evidences) {
    const dedupeKey = `${e.vod_id}|${e.timestamp_seconds}|${e.image_hash || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const providerLower = (e.provider_detected || "").toLowerCase();
    const gameLower = (e.game_detected || "").toLowerCase();

    rows.push({
      vod_id: e.vod_id,
      source_id: e.source_id || e.vod_id,
      streamer_login: e.streamer_login,
      platform: e.platform || "twitch",
      source_type: e.source_type || "vod",
      timestamp_seconds: e.timestamp_seconds || 0,
      frame_index: e.frame_index,
      provider_detected: e.provider_detected,
      game_detected: e.game_detected,
      provider_id: providerMap[providerLower] || e.provider_id || null,
      game_id: gameMap[gameLower] || e.game_id || null,
      confidence_score: e.confidence_score ?? 0,
      image_hash: e.image_hash || null,
      processing_batch_id: batchId,
      is_valid: true,
      validation_status: "pending",
    });
  }

  const { data, error } = await supabase.from("raw_evidences").insert(rows).select("id");
  if (error) throw error;

  await auditLog(supabase, "raw_capture", "raw_evidences", batchId, rows[0]?.vod_id, {
    batch_id: batchId,
    total_captured: rows.length,
    duplicates_removed: evidences.length - rows.length,
  });

  return { saved: data?.length || 0, batch_id: batchId, duplicates_removed: evidences.length - rows.length };
}

// ──────────────────────────────────────────────
// STAGE B: Validate evidences for a VOD
// ──────────────────────────────────────────────
async function validateEvidences(supabase: any, vodId: string, config: PipelineConfig) {
  const { data: evidences } = await supabase
    .from("raw_evidences")
    .select("*")
    .eq("vod_id", vodId)
    .order("timestamp_seconds", { ascending: true });

  if (!evidences || evidences.length === 0) {
    return { validated: 0, discarded: 0, gaps: 0 };
  }

  let validated = 0;
  let discarded = 0;
  const updates: { id: string; is_valid: boolean; validation_status: string; discard_reason: string | null }[] = [];

  for (const ev of evidences) {
    let valid = true;
    let reason: string | null = null;

    // Rule 1: Below minimum confidence
    if (ev.confidence_score < config.min_confidence_score) {
      valid = false;
      reason = `low_confidence: ${ev.confidence_score} < ${config.min_confidence_score}`;
    }

    // Rule 2: Ignore loading/lobby/overlay screens
    if (valid && config.ignore_loading_screens && ev.game_detected?.toLowerCase().includes("loading")) {
      valid = false;
      reason = "loading_screen_detected";
    }
    if (valid && config.ignore_lobby_screens && ev.game_detected?.toLowerCase().includes("lobby")) {
      valid = false;
      reason = "lobby_screen_detected";
    }
    if (valid && config.ignore_overlay_only_frames && ev.game_detected?.toLowerCase().includes("overlay")) {
      valid = false;
      reason = "overlay_only_frame";
    }

    // Rule 3: No provider or game detected
    if (valid && !ev.provider_detected && !ev.game_detected) {
      valid = false;
      reason = "no_detection";
    }

    updates.push({
      id: ev.id,
      is_valid: valid,
      validation_status: valid ? "valid" : "discarded",
      discard_reason: reason,
    });

    if (valid) validated++;
    else discarded++;
  }

  // Batch update
  for (const u of updates) {
    await supabase.from("raw_evidences").update({
      is_valid: u.is_valid,
      validation_status: u.validation_status,
      discard_reason: u.discard_reason,
    }).eq("id", u.id);
  }

  // Detect gaps in coverage
  const validEvidences = evidences.filter((_: any, i: number) => updates[i].is_valid);
  let gaps = 0;
  let totalGapSeconds = 0;
  for (let i = 1; i < validEvidences.length; i++) {
    const gap = validEvidences[i].timestamp_seconds - validEvidences[i - 1].timestamp_seconds;
    if (gap > config.max_gap_to_merge_blocks * 2) {
      gaps++;
      totalGapSeconds += gap;
    }
  }

  await auditLog(supabase, "validation", "raw_evidences", vodId, vodId, {
    total_evidences: evidences.length,
    validated,
    discarded,
    gaps,
    total_gap_seconds: totalGapSeconds,
    config_used: config,
  });

  return { validated, discarded, gaps, total_gap_seconds: totalGapSeconds };
}

// ──────────────────────────────────────────────
// STAGE C: Consolidate into gameplay blocks
// ──────────────────────────────────────────────
async function consolidateBlocks(supabase: any, vodId: string, config: PipelineConfig) {
  // Get only valid evidences
  const { data: evidences } = await supabase
    .from("raw_evidences")
    .select("*")
    .eq("vod_id", vodId)
    .eq("is_valid", true)
    .order("timestamp_seconds", { ascending: true });

  if (!evidences || evidences.length === 0) {
    return { blocks_created: 0, confirmed: 0, suspect: 0, discarded: 0 };
  }

  // Delete old blocks for this VOD before reconsolidation
  await supabase.from("gameplay_blocks").delete().eq("vod_id", vodId);

  // Group consecutive evidences by provider+game with gap tolerance
  const rawBlocks: any[] = [];
  let current: any = null;

  for (const ev of evidences) {
    const providerKey = ev.provider_id || ev.provider_detected || "unknown";
    const gameKey = ev.game_id || ev.game_detected || "unknown";

    if (!current) {
      current = {
        provider_id: ev.provider_id,
        game_id: ev.game_id,
        provider_name: ev.provider_detected,
        game_name: ev.game_detected,
        provider_key: providerKey,
        game_key: gameKey,
        start_seconds: ev.timestamp_seconds,
        end_seconds: ev.timestamp_seconds,
        evidences: [ev],
      };
      continue;
    }

    const gap = ev.timestamp_seconds - current.end_seconds;
    const sameContent = providerKey === current.provider_key && gameKey === current.game_key;

    if (sameContent && gap <= config.max_gap_to_merge_blocks) {
      // Extend current block
      current.end_seconds = ev.timestamp_seconds;
      current.evidences.push(ev);
    } else {
      // Save current and start new
      rawBlocks.push(current);
      current = {
        provider_id: ev.provider_id,
        game_id: ev.game_id,
        provider_name: ev.provider_detected,
        game_name: ev.game_detected,
        provider_key: providerKey,
        game_key: gameKey,
        start_seconds: ev.timestamp_seconds,
        end_seconds: ev.timestamp_seconds,
        evidences: [ev],
      };
    }
  }
  if (current) rawBlocks.push(current);

  // STAGE D: Classify each block
  const streamerLogin = evidences[0].streamer_login;
  const platform = evidences[0].platform;
  const sourceType = evidences[0].source_type;

  let confirmed = 0, suspect = 0, discarded = 0;
  const blockRows: any[] = [];

  for (const block of rawBlocks) {
    const duration = block.end_seconds - block.start_seconds;
    const evidenceCount = block.evidences.length;
    const confidences = block.evidences.map((e: any) => e.confidence_score);
    const avgConf = safeSum(confidences) / Math.max(1, confidences.length);
    const minConf = Math.min(...confidences);
    const maxConf = Math.max(...confidences);

    let status: string;
    let discardReason: string | null = null;

    // Rule: Must have minimum consecutive hits
    if (evidenceCount < config.min_consecutive_hits) {
      status = "discarded";
      discardReason = `insufficient_evidence: ${evidenceCount} < ${config.min_consecutive_hits} hits`;
      discarded++;
    }
    // Rule: Must have minimum duration
    else if (duration < config.min_valid_duration_seconds) {
      status = "discarded";
      discardReason = `too_short: ${duration}s < ${config.min_valid_duration_seconds}s`;
      discarded++;
    }
    // Rule: Suspect if confidence below threshold
    else if (avgConf < config.suspect_confidence_threshold) {
      status = "suspect";
      discardReason = `low_avg_confidence: ${avgConf.toFixed(1)} < ${config.suspect_confidence_threshold}`;
      suspect++;
    }
    // Confirmed
    else {
      status = "confirmed";
      confirmed++;
    }

    blockRows.push({
      vod_id: vodId,
      source_id: block.evidences[0].source_id,
      streamer_login: streamerLogin,
      platform,
      source_type: sourceType,
      provider_id: block.provider_id,
      game_id: block.game_id,
      provider_name: block.provider_name,
      game_name: block.game_name,
      start_seconds: block.start_seconds,
      end_seconds: block.end_seconds,
      duration_seconds: Math.max(0, duration),
      evidence_count: evidenceCount,
      confidence_avg: Math.round(avgConf * 100) / 100,
      confidence_min: Math.round(minConf * 100) / 100,
      confidence_max: Math.round(maxConf * 100) / 100,
      status,
      discard_reason: discardReason,
    });
  }

  if (blockRows.length > 0) {
    const { error } = await supabase.from("gameplay_blocks").insert(blockRows);
    if (error) throw error;
  }

  await auditLog(supabase, "consolidation", "gameplay_blocks", vodId, vodId, {
    total_blocks: blockRows.length,
    confirmed,
    suspect,
    discarded,
    config_used: {
      min_consecutive_hits: config.min_consecutive_hits,
      min_valid_duration_seconds: config.min_valid_duration_seconds,
      suspect_confidence_threshold: config.suspect_confidence_threshold,
      max_gap_to_merge_blocks: config.max_gap_to_merge_blocks,
    },
  });

  return { blocks_created: blockRows.length, confirmed, suspect, discarded };
}

// ──────────────────────────────────────────────
// STAGE E: Compute final metrics from confirmed blocks
// ──────────────────────────────────────────────
async function computeVodMetrics(supabase: any, vodId: string, vodDurationSeconds?: number) {
  const { data: blocks } = await supabase
    .from("gameplay_blocks")
    .select("*")
    .eq("vod_id", vodId);

  if (!blocks || blocks.length === 0) {
    return { error: "No blocks found for this VOD" };
  }

  const confirmedBlocks = blocks.filter((b: any) => b.status === "confirmed");
  const suspectBlocks = blocks.filter((b: any) => b.status === "suspect");
  const discardedBlocks = blocks.filter((b: any) => b.status === "discarded");

  const confirmedDuration = safeSum(confirmedBlocks.map((b: any) => b.duration_seconds));
  const suspectDuration = safeSum(suspectBlocks.map((b: any) => b.duration_seconds));

  // Consistency check: sum of all block durations
  const totalBlockDuration = safeSum(blocks.map((b: any) => b.duration_seconds));
  const confirmedAvgConfidence = confirmedBlocks.length > 0
    ? safeSum(confirmedBlocks.map((b: any) => b.confidence_avg)) / confirmedBlocks.length
    : 0;

  // Coverage: confirmed duration vs VOD total duration
  const coveragePercent = vodDurationSeconds
    ? safePercent(confirmedDuration, vodDurationSeconds)
    : 0;

  // Get evidence counts
  const { count: totalEvidences } = await supabase
    .from("raw_evidences").select("*", { count: "exact", head: true }).eq("vod_id", vodId);
  const { count: validEvidences } = await supabase
    .from("raw_evidences").select("*", { count: "exact", head: true }).eq("vod_id", vodId).eq("is_valid", true);

  // Determine data quality status
  let dataQuality = "good";
  if (coveragePercent < 50) dataQuality = "poor";
  else if (coveragePercent < 80) dataQuality = "fair";
  else if (suspectBlocks.length > confirmedBlocks.length) dataQuality = "fair";

  // Determine VOD status
  let vodStatus = "completed";
  if (confirmedBlocks.length === 0 && suspectBlocks.length === 0) vodStatus = "failed";
  else if (coveragePercent < 90 && vodDurationSeconds) vodStatus = "partial";
  else if (suspectBlocks.length > 0 && confirmedBlocks.length === 0) vodStatus = "needs_review";

  // Update vod_audits
  await supabase.from("vod_audits").update({
    status: vodStatus,
    coverage_percent: Math.round(coveragePercent * 100) / 100,
    confidence_score: Math.round(confirmedAvgConfidence * 100) / 100,
    processed_duration_seconds: confirmedDuration,
    total_evidences: totalEvidences || 0,
    valid_evidences: validEvidences || 0,
    discarded_evidences: (totalEvidences || 0) - (validEvidences || 0),
    confirmed_blocks: confirmedBlocks.length,
    suspect_blocks: suspectBlocks.length,
    discarded_blocks: discardedBlocks.length,
    data_quality_status: dataQuality,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("vod_id", vodId);

  // Sync to exposure_blocks for dashboard (only confirmed blocks)
  await supabase.from("exposure_blocks").delete().eq("source_id", vodId);

  if (confirmedBlocks.length > 0) {
    const firstEvidence = blocks[0];
    const baseTime = new Date();

    const exposureRows = confirmedBlocks.map((b: any) => ({
      streamer_login: b.streamer_login,
      platform: b.platform,
      source_type: b.source_type,
      source_id: vodId,
      provider_id: b.provider_id,
      game_id: b.game_id,
      start_at: new Date(baseTime.getTime() + b.start_seconds * 1000).toISOString(),
      end_at: new Date(baseTime.getTime() + b.end_seconds * 1000).toISOString(),
      duration_seconds: b.duration_seconds,
      avg_viewers: 0,
      peak_viewers: 0,
      viewer_minutes: 0,
      confidence_avg: b.confidence_avg,
      is_reconciled: true,
      block_status: "confirmed",
    }));

    await supabase.from("exposure_blocks").insert(exposureRows);
  }

  await auditLog(supabase, "metrics_computed", "vod_audits", vodId, vodId, {
    confirmed_duration: confirmedDuration,
    suspect_duration: suspectDuration,
    coverage_percent: coveragePercent,
    data_quality: dataQuality,
    vod_status: vodStatus,
    confirmed_blocks: confirmedBlocks.length,
    suspect_blocks: suspectBlocks.length,
    discarded_blocks: discardedBlocks.length,
  });

  return {
    vod_id: vodId,
    vod_status: vodStatus,
    data_quality: dataQuality,
    confirmed_duration: confirmedDuration,
    suspect_duration: suspectDuration,
    coverage_percent: coveragePercent,
    avg_confidence: confirmedAvgConfidence,
    total_evidences: totalEvidences || 0,
    valid_evidences: validEvidences || 0,
    confirmed_blocks: confirmedBlocks.length,
    suspect_blocks: suspectBlocks.length,
    discarded_blocks: discardedBlocks.length,
  };
}

// ──────────────────────────────────────────────
// Full pipeline: A → B → C → D → E
// ──────────────────────────────────────────────
async function runFullPipeline(supabase: any, vodId: string, streamerLogin: string, vodDurationSeconds?: number) {
  const config = await loadConfig(supabase);

  // Ensure vod_audit exists
  await supabase.from("vod_audits").upsert({
    vod_id: vodId,
    streamer_login: streamerLogin,
    status: "processing",
    started_at: new Date().toISOString(),
    vod_duration_seconds: vodDurationSeconds || 0,
  }, { onConflict: "vod_id" });

  await auditLog(supabase, "pipeline_start", "vod_audits", vodId, vodId, { streamer: streamerLogin });

  // Stage B: Validate
  const validation = await validateEvidences(supabase, vodId, config);

  // Stage C+D: Consolidate + Classify
  const consolidation = await consolidateBlocks(supabase, vodId, config);

  // Stage E: Compute metrics
  const metrics = await computeVodMetrics(supabase, vodId, vodDurationSeconds);

  await auditLog(supabase, "pipeline_complete", "vod_audits", vodId, vodId, {
    validation,
    consolidation,
    metrics,
  });

  return { validation, consolidation, metrics };
}

// ──────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const twitchKey = Deno.env.get("TWITCH_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { action, ...params } = await req.json();

    switch (action) {
      // ─── PIPELINE ACTIONS ──────────────────
      case "save_raw_evidences": {
        const result = await saveRawEvidences(supabase, params);
        return json(result);
      }

      case "validate_vod": {
        const config = await loadConfig(supabase);
        const result = await validateEvidences(supabase, params.vod_id, config);
        return json(result);
      }

      case "consolidate_vod": {
        const config = await loadConfig(supabase);
        const result = await consolidateBlocks(supabase, params.vod_id, config);
        return json(result);
      }

      case "compute_metrics": {
        const result = await computeVodMetrics(supabase, params.vod_id, params.vod_duration_seconds);
        return json(result);
      }

      case "run_pipeline": {
        const result = await runFullPipeline(supabase, params.vod_id, params.streamer_login, params.vod_duration_seconds);
        return json(result);
      }

      // ─── REVIEW ACTIONS ──────────────────
      case "review_block": {
        const { block_id, new_status, review_notes, reviewer_id, new_game_id, new_provider_id } = params;
        const updateData: any = {
          status: new_status,
          review_notes,
          reviewed_by: reviewer_id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (new_game_id) updateData.game_id = new_game_id;
        if (new_provider_id) updateData.provider_id = new_provider_id;

        const { error } = await supabase.from("gameplay_blocks").update(updateData).eq("id", block_id);
        if (error) throw error;

        await auditLog(supabase, "manual_review", "gameplay_blocks", block_id, null, {
          new_status,
          review_notes,
          reviewer_id,
        });

        return json({ success: true });
      }

      case "request_reprocess": {
        const { vod_id, streamer_login: sl } = params;
        // Reset evidences and blocks
        await supabase.from("raw_evidences").update({ validation_status: "pending", is_valid: true, discard_reason: null }).eq("vod_id", vod_id);
        await supabase.from("gameplay_blocks").delete().eq("vod_id", vod_id);
        await supabase.from("vod_audits").update({
          status: "reprocessed",
          updated_at: new Date().toISOString(),
        }).eq("vod_id", vod_id);

        await auditLog(supabase, "reprocess_requested", "vod_audits", vod_id, vod_id, { streamer: sl });

        return json({ success: true, message: "VOD queued for reprocessing" });
      }

      // ─── GET AUDIT DATA ──────────────────
      case "get_vod_audit_detail": {
        const { vod_id } = params;

        const [{ data: audit }, { data: blocks }, { data: logs }] = await Promise.all([
          supabase.from("vod_audits").select("*").eq("vod_id", vod_id).single(),
          supabase.from("gameplay_blocks").select("*").eq("vod_id", vod_id).order("start_seconds"),
          supabase.from("pipeline_audit_logs").select("*").eq("vod_id", vod_id).order("created_at", { ascending: false }).limit(50),
        ]);

        const { count: totalEvidences } = await supabase.from("raw_evidences").select("*", { count: "exact", head: true }).eq("vod_id", vod_id);
        const { count: validEvidences } = await supabase.from("raw_evidences").select("*", { count: "exact", head: true }).eq("vod_id", vod_id).eq("is_valid", true);

        return json({
          audit,
          blocks: blocks || [],
          logs: logs || [],
          evidence_summary: {
            total: totalEvidences || 0,
            valid: validEvidences || 0,
            discarded: (totalEvidences || 0) - (validEvidences || 0),
          },
        });
      }

      case "get_review_queue": {
        // Get blocks that need review
        const { data: suspectBlocks } = await supabase
          .from("gameplay_blocks")
          .select("*")
          .eq("status", "suspect")
          .order("created_at", { ascending: false })
          .limit(100);

        // Get VODs with issues
        const { data: problemVods } = await supabase
          .from("vod_audits")
          .select("*")
          .in("status", ["needs_review", "partial", "failed"])
          .order("created_at", { ascending: false })
          .limit(50);

        // Get recent discarded blocks that might be false negatives
        const { data: recentDiscarded } = await supabase
          .from("gameplay_blocks")
          .select("*")
          .eq("status", "discarded")
          .order("created_at", { ascending: false })
          .limit(50);

        return json({
          suspect_blocks: suspectBlocks || [],
          problem_vods: problemVods || [],
          recent_discarded: recentDiscarded || [],
        });
      }

      // ─── QUALITY METRICS ──────────────────
      case "get_quality_metrics": {
        const [
          { count: totalBlocks },
          { count: confirmedBlocks },
          { count: suspectBlocks },
          { count: discardedBlocks },
          { data: recentVods },
        ] = await Promise.all([
          supabase.from("gameplay_blocks").select("*", { count: "exact", head: true }),
          supabase.from("gameplay_blocks").select("*", { count: "exact", head: true }).eq("status", "confirmed"),
          supabase.from("gameplay_blocks").select("*", { count: "exact", head: true }).eq("status", "suspect"),
          supabase.from("gameplay_blocks").select("*", { count: "exact", head: true }).eq("status", "discarded"),
          supabase.from("vod_audits").select("coverage_percent, confidence_score, data_quality_status, status").order("created_at", { ascending: false }).limit(100),
        ]);

        const vods = recentVods || [];
        const avgCoverage = vods.length > 0
          ? safeSum(vods.map((v: any) => v.coverage_percent || 0)) / vods.length
          : 0;
        const avgConfidence = vods.length > 0
          ? safeSum(vods.map((v: any) => v.confidence_score || 0)) / vods.length
          : 0;
        const failedVods = vods.filter((v: any) => v.status === "failed").length;
        const lowConfVods = vods.filter((v: any) => (v.confidence_score || 0) < 50).length;

        const falsePositiveRate = totalBlocks ? safePercent(discardedBlocks || 0, totalBlocks) : 0;
        const suspectRate = totalBlocks ? safePercent(suspectBlocks || 0, totalBlocks) : 0;

        return json({
          total_blocks: totalBlocks || 0,
          confirmed_blocks: confirmedBlocks || 0,
          suspect_blocks: suspectBlocks || 0,
          discarded_blocks: discardedBlocks || 0,
          false_positive_rate: Math.round(falsePositiveRate * 100) / 100,
          suspect_rate: Math.round(suspectRate * 100) / 100,
          avg_coverage: Math.round(avgCoverage * 100) / 100,
          avg_confidence: Math.round(avgConfidence * 100) / 100,
          failed_vods: failedVods,
          low_confidence_vods: lowConfVods,
          total_vods_analyzed: vods.length,
        });
      }

      // ─── CONFIG ──────────────────
      case "get_pipeline_config": {
        const { data } = await supabase.from("pipeline_configs").select("*").order("config_key");
        return json({ configs: data || [] });
      }

      case "update_pipeline_config": {
        const { config_key, config_value } = params;
        const { error } = await supabase.from("pipeline_configs")
          .update({ config_value, updated_at: new Date().toISOString() })
          .eq("config_key", config_key);
        if (error) throw error;
        return json({ success: true });
      }

      // ─── EXISTING ACTIONS (kept for compatibility) ──────────────────
      case "get_status": {
        const [{ count: pendingJobs }, { count: runningJobs }, { data: activeStreamers }] = await Promise.all([
          supabase.from("processing_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("processing_queue").select("*", { count: "exact", head: true }).eq("status", "running"),
          supabase.from("monitored_streamers").select("*").eq("is_active", true),
        ]);

        let liveCount = 0;
        if (lovableKey && twitchKey && activeStreamers && activeStreamers.length > 0) {
          const logins = activeStreamers.map((s: any) => s.login).join("&user_login=");
          try {
            const res = await fetch(`${GATEWAY_URL}/streams?user_login=${logins}`, {
              headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": twitchKey! },
            });
            const data = await res.json();
            liveCount = data?.data?.length || 0;
          } catch { /* ignore */ }
        }

        // Quality summary
        const { data: qualityData } = await supabase.from("vod_audits")
          .select("status, data_quality_status")
          .order("created_at", { ascending: false }).limit(50);

        const qualitySummary = {
          good: 0, fair: 0, poor: 0, unknown: 0,
        };
        (qualityData || []).forEach((v: any) => {
          const q = v.data_quality_status || "unknown";
          if (q in qualitySummary) qualitySummary[q as keyof typeof qualitySummary]++;
        });

        return json({
          pending_jobs: pendingJobs || 0,
          running_jobs: runningJobs || 0,
          active_lives: liveCount,
          monitored_streamers: activeStreamers?.length || 0,
          data_quality: qualitySummary,
        });
      }

      case "get_dashboard": {
        const { date_from, date_to, platform, provider_id, game_id, streamer, source_type, block_status_filter } = params;
        
        // Use only confirmed blocks by default
        const statusFilter = block_status_filter || "confirmed";
        
        let query = supabase.from("exposure_blocks").select("*");
        if (statusFilter !== "all") query = query.eq("block_status", statusFilter);
        if (date_from) query = query.gte("start_at", date_from);
        if (date_to) query = query.lte("end_at", date_to);
        if (platform) query = query.eq("platform", platform);
        if (provider_id) query = query.eq("provider_id", provider_id);
        if (game_id) query = query.eq("game_id", game_id);
        if (streamer) query = query.eq("streamer_login", streamer);
        if (source_type) query = query.eq("source_type", source_type);

        const { data: blocks } = await query.order("start_at", { ascending: false }).limit(1000);

        // VOD audits
        let vodQuery = supabase.from("vod_audits").select("*");
        if (streamer) vodQuery = vodQuery.eq("streamer_login", streamer);
        if (platform) vodQuery = vodQuery.eq("platform", platform);
        const { data: vodAudits } = await vodQuery.order("created_at", { ascending: false }).limit(200);

        // Chat stats
        let chatQuery = supabase.from("chat_messages").select("sentiment_label, intent_label");
        if (date_from) chatQuery = chatQuery.gte("message_at", date_from);
        if (date_to) chatQuery = chatQuery.lte("message_at", date_to);
        if (streamer) chatQuery = chatQuery.eq("streamer_login", streamer);
        const { data: chatMsgs } = await chatQuery.limit(1000);

        // Compute aggregations from CONFIRMED blocks only
        const safeBlocks = blocks || [];
        const totalExposure = safeSum(safeBlocks.map((b: any) => b.duration_seconds || 0));
        const totalViewerMinutes = safeSum(safeBlocks.map((b: any) => b.viewer_minutes || 0));
        const uniqueStreamers = new Set(safeBlocks.map((b: any) => b.streamer_login)).size;
        
        // Provider share - safe aggregation
        const providerMap: Record<string, number> = {};
        for (const b of safeBlocks) {
          const key = b.provider_id || "unknown";
          providerMap[key] = (providerMap[key] || 0) + (b.duration_seconds || 0);
        }

        // Game share
        const gameMap: Record<string, number> = {};
        for (const b of safeBlocks) {
          const key = b.game_id || "unknown";
          gameMap[key] = (gameMap[key] || 0) + (b.duration_seconds || 0);
        }

        // Consistency validation: sum of parts must equal total
        const providerTotal = safeSum(Object.values(providerMap));
        const gameTotal = safeSum(Object.values(gameMap));

        // VOD quality
        const completedVods = (vodAudits || []).filter((v: any) => v.status === "completed" || v.status === "partial");
        const avgCoverage = completedVods.length > 0
          ? safeSum(completedVods.map((v: any) => v.coverage_percent || 0)) / completedVods.length
          : 0;

        // Chat sentiment
        const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
        for (const m of chatMsgs || []) {
          if (m.sentiment_label && m.sentiment_label in sentimentCounts) {
            sentimentCounts[m.sentiment_label as keyof typeof sentimentCounts]++;
          }
        }

        return json({
          total_exposure_seconds: totalExposure,
          total_viewer_minutes: totalViewerMinutes,
          unique_streamers: uniqueStreamers,
          provider_share: providerMap,
          game_share: gameMap,
          avg_vod_coverage: Math.round(avgCoverage * 100) / 100,
          chat_sentiment: sentimentCounts,
          total_detections: safeBlocks.length,
          vod_audits: vodAudits || [],
          blocks: safeBlocks,
          // Consistency metadata
          _meta: {
            data_source: statusFilter,
            provider_total_seconds: providerTotal,
            game_total_seconds: gameTotal,
            exposure_total_seconds: totalExposure,
            consistency_check: providerTotal === totalExposure && gameTotal === totalExposure,
          },
        });
      }

      case "get_rankings": {
        const { date_from, date_to, rank_by, block_status_filter } = params;
        const statusFilter = block_status_filter || "confirmed";
        
        let query = supabase.from("exposure_blocks").select("*");
        if (statusFilter !== "all") query = query.eq("block_status", statusFilter);
        if (date_from) query = query.gte("start_at", date_from);
        if (date_to) query = query.lte("end_at", date_to);
        const { data: blocks } = await query.limit(1000);

        const rankings: Record<string, { exposure: number; viewer_minutes: number; sessions: number; peak: number; avg_confidence: number; confidence_sum: number }> = {};
        
        for (const b of blocks || []) {
          let key: string;
          if (rank_by === "provider") key = b.provider_id || "unknown";
          else if (rank_by === "game") key = b.game_id || "unknown";
          else key = b.streamer_login;

          if (!rankings[key]) rankings[key] = { exposure: 0, viewer_minutes: 0, sessions: 0, peak: 0, avg_confidence: 0, confidence_sum: 0 };
          rankings[key].exposure += b.duration_seconds || 0;
          rankings[key].viewer_minutes += b.viewer_minutes || 0;
          rankings[key].sessions += 1;
          rankings[key].peak = Math.max(rankings[key].peak, b.peak_viewers || 0);
          rankings[key].confidence_sum += b.confidence_avg || 0;
        }

        // Compute averages
        const sorted = Object.entries(rankings)
          .map(([key, val]) => ({
            key,
            ...val,
            avg_confidence: val.sessions > 0 ? Math.round(safeDivide(val.confidence_sum, val.sessions) * 100) / 100 : 0,
          }))
          .sort((a, b) => b.exposure - a.exposure);

        return json({ rankings: sorted });
      }

      case "enqueue_job": {
        const { job_type, streamer_login, platform: plat, source_id, priority, metadata } = params;
        const { data, error } = await supabase.from("processing_queue").insert({
          job_type,
          streamer_login,
          platform: plat || "twitch",
          source_id,
          priority: priority || "normal",
          metadata: metadata || {},
        }).select().single();
        if (error) throw error;
        return json({ job: data });
      }

      case "process_vod": {
        const { vod_id, streamer_login } = params;
        await supabase.from("vod_audits").upsert({
          vod_id,
          streamer_login,
          status: "processing",
          started_at: new Date().toISOString(),
        }, { onConflict: "vod_id" });
        return json({ message: "VOD processing started" });
      }

      // Legacy save_detections - maps to new pipeline
      case "save_detections": {
        const { detections: dets } = params;
        if (!dets || !Array.isArray(dets) || dets.length === 0) {
          return json({ error: "No detections to save" }, 400);
        }

        // Convert to raw_evidences format
        const evidences = dets.map((d: any) => ({
          vod_id: d.source_id || d.vod_id || "unknown",
          source_id: d.source_id,
          streamer_login: d.streamer_login,
          platform: d.platform || "twitch",
          source_type: d.source_type || "vod",
          timestamp_seconds: d.offset_seconds || 0,
          provider_detected: d.provider_name,
          game_detected: d.game_name,
          provider_id: d.provider_id,
          game_id: d.game_id,
          confidence_score: d.confidence || 0,
        }));

        const result = await saveRawEvidences(supabase, { evidences });

        // Also save to legacy detections table for backward compat
        const { data: providerAliases } = await supabase.from("provider_aliases").select("alias, provider_id");
        const { data: providers } = await supabase.from("providers").select("id, name, slug");
        const aliasMap: Record<string, string> = {};
        (providerAliases || []).forEach((a: any) => { aliasMap[a.alias.toLowerCase()] = a.provider_id; });
        (providers || []).forEach((p: any) => { aliasMap[p.name.toLowerCase()] = p.id; aliasMap[p.slug.toLowerCase()] = p.id; });

        const normalized = dets.map((d: any) => ({
          streamer_login: d.streamer_login,
          platform: d.platform || "twitch",
          source_type: d.source_type || "vod",
          source_id: d.source_id,
          provider_id: aliasMap[(d.provider_name || "").toLowerCase()] || d.provider_id || null,
          game_id: d.game_id || null,
          provider_name: d.provider_name,
          game_name: d.game_name,
          confidence: d.confidence || 0,
          detected_at: d.detected_at || new Date().toISOString(),
          exposure_seconds: d.exposure_seconds || 0,
          viewer_count: d.viewer_count || 0,
          offset_seconds: d.offset_seconds || 0,
        }));

        await supabase.from("detections").insert(normalized);

        return json({ saved: result.saved, batch_id: result.batch_id });
      }

      // Legacy reconcile - now runs the full pipeline
      case "reconcile": {
        const { streamer_login, source_id } = params;
        if (source_id) {
          const result = await runFullPipeline(supabase, source_id, streamer_login);
          return json(result);
        }
        return json({ error: "source_id (vod_id) is required for pipeline reconciliation" }, 400);
      }

      case "get_queue": {
        const { status: qStatus } = params;
        let query = supabase.from("processing_queue").select("*");
        if (qStatus) query = query.eq("status", qStatus);
        const { data } = await query.order("created_at", { ascending: false }).limit(100);
        return json({ jobs: data || [] });
      }

      case "get_chat_stats": {
        const { streamer_login, date_from, date_to } = params;
        let query = supabase.from("chat_messages").select("*").eq("is_spam", false).eq("is_bot", false);
        if (streamer_login) query = query.eq("streamer_login", streamer_login);
        if (date_from) query = query.gte("message_at", date_from);
        if (date_to) query = query.lte("message_at", date_to);
        const { data: msgs } = await query.order("message_at", { ascending: false }).limit(1000);

        const sentiments = { positive: 0, neutral: 0, negative: 0 };
        const intents: Record<string, number> = {};
        for (const m of msgs || []) {
          if (m.sentiment_label) sentiments[m.sentiment_label as keyof typeof sentiments]++;
          if (m.intent_label) intents[m.intent_label] = (intents[m.intent_label] || 0) + 1;
        }

        return json({
          total_messages: (msgs || []).length,
          sentiments,
          intents,
          messages: msgs || [],
        });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("Scanner pipeline error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
