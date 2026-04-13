import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sbUrl() {
  return Deno.env.get("SUPABASE_URL")!;
}

function sbHeaders() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
  };
}

async function sbSelect(table: string, params = "") {
  const res = await fetch(`${sbUrl()}/rest/v1/${table}?${params}`, { headers: sbHeaders() });
  return res.json();
}

async function sbInsert(table: string, rows: any[]) {
  const res = await fetch(`${sbUrl()}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  return res.json();
}

async function sbUpdate(table: string, filter: string, body: any) {
  const res = await fetch(`${sbUrl()}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// ─── Confidence mapping ───
function mapConfidence(label: string): number {
  if (label === "high") return 0.95;
  if (label === "medium") return 0.75;
  return 0.4;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ─── SAVE RAW EVIDENCES ───
    if (action === "save_raw_evidences") {
      const { evidences, processing_batch_id } = body;
      if (!evidences || !Array.isArray(evidences) || evidences.length === 0) {
        return jsonResponse({ error: "evidences array required" }, 400);
      }
      const rows = evidences.map((e: any) => ({
        vod_id: e.vod_id || "",
        streamer_login: e.streamer_login || "",
        platform: e.platform || "twitch",
        source_type: e.source_type || "vod",
        source_id: e.source_id || null,
        timestamp_seconds: e.timestamp_seconds || 0,
        frame_index: e.frame_index ?? null,
        game_detected: e.game || e.game_detected || null,
        provider_detected: e.provider || e.provider_detected || null,
        confidence_score: typeof e.confidence === "number" ? e.confidence : mapConfidence(e.confidence || "low"),
        processing_batch_id: processing_batch_id || null,
        is_valid: true,
        validation_status: "pending",
      }));
      const data = await sbInsert("raw_evidences", rows);
      return jsonResponse({ saved: Array.isArray(data) ? data.length : 0 });
    }

    // ─── VALIDATE VOD ───
    if (action === "validate_vod") {
      const { vod_id } = body;
      if (!vod_id) return jsonResponse({ error: "vod_id required" }, 400);

      const evidences = await sbSelect("raw_evidences", `vod_id=eq.${encodeURIComponent(vod_id)}&validation_status=eq.pending&order=timestamp_seconds.asc`);
      if (!Array.isArray(evidences)) return jsonResponse({ validated: 0, discarded: 0 });

      let validated = 0, discarded = 0;
      for (const ev of evidences) {
        const isValid = ev.confidence_score >= 0.4 && ev.game_detected && ev.game_detected !== "Unknown" && ev.game_detected !== "Noise/Outlier";
        const status = isValid ? "valid" : "discarded";
        const reason = !isValid ? (ev.confidence_score < 0.4 ? "low_confidence" : "no_game_detected") : null;
        await sbUpdate("raw_evidences", `id=eq.${ev.id}`, { is_valid: isValid, validation_status: status, discard_reason: reason });
        if (isValid) validated++; else discarded++;
      }
      return jsonResponse({ validated, discarded, total: evidences.length });
    }

    // ─── CONSOLIDATE VOD ───
    if (action === "consolidate_vod") {
      const { vod_id } = body;
      if (!vod_id) return jsonResponse({ error: "vod_id required" }, 400);

      const evidences = await sbSelect("raw_evidences", `vod_id=eq.${encodeURIComponent(vod_id)}&is_valid=eq.true&validation_status=eq.valid&order=timestamp_seconds.asc`);
      if (!Array.isArray(evidences) || evidences.length === 0) return jsonResponse({ blocks: 0 });

      // Group consecutive same-game evidences into blocks
      const blocks: any[] = [];
      let current = {
        game: evidences[0].game_detected,
        provider: evidences[0].provider_detected,
        start: evidences[0].timestamp_seconds,
        end: evidences[0].timestamp_seconds,
        scores: [evidences[0].confidence_score],
        count: 1,
      };

      for (let i = 1; i < evidences.length; i++) {
        const ev = evidences[i];
        const gap = ev.timestamp_seconds - current.end;
        if (ev.game_detected === current.game && ev.provider_detected === current.provider && gap <= 180) {
          current.end = ev.timestamp_seconds;
          current.scores.push(ev.confidence_score);
          current.count++;
        } else {
          blocks.push(current);
          current = {
            game: ev.game_detected,
            provider: ev.provider_detected,
            start: ev.timestamp_seconds,
            end: ev.timestamp_seconds,
            scores: [ev.confidence_score],
            count: ev.count || 1,
          };
        }
      }
      blocks.push(current);

      // Filter: minimum 2 consecutive evidences (persistence rule)
      const MIN_CONSECUTIVE = 2;
      const streamer = evidences[0].streamer_login;
      const platform = evidences[0].platform;

      const blockRows = blocks
        .filter(b => b.count >= MIN_CONSECUTIVE)
        .map(b => {
          const avg = b.scores.reduce((a: number, c: number) => a + c, 0) / b.scores.length;
          const duration = Math.max(60, b.end - b.start + 60);
          return {
            vod_id,
            streamer_login: streamer,
            platform,
            source_type: "vod",
            game_name: b.game,
            provider_name: b.provider,
            start_seconds: b.start,
            end_seconds: b.end + 60,
            duration_seconds: duration,
            evidence_count: b.count,
            confidence_avg: Math.round(avg * 100) / 100,
            confidence_min: Math.min(...b.scores),
            confidence_max: Math.max(...b.scores),
            status: avg >= 0.75 ? "confirmed" : "suspect",
          };
        });

      if (blockRows.length > 0) {
        await sbInsert("gameplay_blocks", blockRows);
      }

      // Mark discarded blocks (noise)
      const discardedCount = blocks.filter(b => b.count < MIN_CONSECUTIVE).length;

      return jsonResponse({ blocks: blockRows.length, discarded_as_noise: discardedCount });
    }

    // ─── COMPUTE METRICS (update vod_audits) ───
    if (action === "compute_metrics") {
      const { vod_id, vod_duration_seconds } = body;
      if (!vod_id) return jsonResponse({ error: "vod_id required" }, 400);

      const evidences = await sbSelect("raw_evidences", `vod_id=eq.${encodeURIComponent(vod_id)}&select=id,is_valid,validation_status,confidence_score`);
      const blocks = await sbSelect("gameplay_blocks", `vod_id=eq.${encodeURIComponent(vod_id)}&select=id,status,duration_seconds,confidence_avg`);

      const totalEv = Array.isArray(evidences) ? evidences.length : 0;
      const validEv = Array.isArray(evidences) ? evidences.filter((e: any) => e.is_valid).length : 0;
      const discardedEv = totalEv - validEv;
      const confirmedBlocks = Array.isArray(blocks) ? blocks.filter((b: any) => b.status === "confirmed").length : 0;
      const suspectBlocks = Array.isArray(blocks) ? blocks.filter((b: any) => b.status === "suspect").length : 0;
      const discardedBlocks = Array.isArray(blocks) ? blocks.filter((b: any) => b.status === "discarded").length : 0;
      const processedDuration = Array.isArray(blocks) ? blocks.filter((b: any) => b.status === "confirmed").reduce((s: number, b: any) => s + (b.duration_seconds || 0), 0) : 0;
      const avgConf = Array.isArray(blocks) && blocks.length > 0 ? blocks.reduce((s: number, b: any) => s + (b.confidence_avg || 0), 0) / blocks.length : 0;
      const coverage = vod_duration_seconds && vod_duration_seconds > 0 ? Math.round((processedDuration / vod_duration_seconds) * 100) : 0;

      // Upsert vod_audits
      const existing = await sbSelect("vod_audits", `vod_id=eq.${encodeURIComponent(vod_id)}&limit=1`);
      const auditData = {
        total_evidences: totalEv,
        valid_evidences: validEv,
        discarded_evidences: discardedEv,
        confirmed_blocks: confirmedBlocks,
        suspect_blocks: suspectBlocks,
        discarded_blocks: discardedBlocks,
        processed_duration_seconds: processedDuration,
        vod_duration_seconds: vod_duration_seconds || 0,
        coverage_percent: coverage,
        confidence_score: Math.round(avgConf * 100) / 100,
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (Array.isArray(existing) && existing.length > 0) {
        await sbUpdate("vod_audits", `vod_id=eq.${encodeURIComponent(vod_id)}`, auditData);
      } else {
        await sbInsert("vod_audits", [{
          ...auditData,
          vod_id,
          streamer_login: body.streamer_login || "unknown",
          platform: "twitch",
          started_at: new Date().toISOString(),
        }]);
      }

      return jsonResponse({ vod_id, ...auditData });
    }

    // ─── RUN FULL PIPELINE ───
    if (action === "run_pipeline") {
      const { vod_id, streamer_login, vod_duration_seconds } = body;
      if (!vod_id || !streamer_login) return jsonResponse({ error: "vod_id and streamer_login required" }, 400);

      // Create/update vod_audits as processing
      const existing = await sbSelect("vod_audits", `vod_id=eq.${encodeURIComponent(vod_id)}&limit=1`);
      if (Array.isArray(existing) && existing.length > 0) {
        await sbUpdate("vod_audits", `vod_id=eq.${encodeURIComponent(vod_id)}`, { status: "processing", started_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      } else {
        await sbInsert("vod_audits", [{ vod_id, streamer_login, platform: "twitch", status: "processing", started_at: new Date().toISOString() }]);
      }

      // Step 1: Validate
      const validateRes = await fetch(`${sbUrl()}/functions/v1/scanner-pipeline`, {
        method: "POST",
        headers: { ...sbHeaders() },
        body: JSON.stringify({ action: "validate_vod", vod_id }),
      });
      const validateData = await validateRes.json();

      // Step 2: Consolidate
      const consolidateRes = await fetch(`${sbUrl()}/functions/v1/scanner-pipeline`, {
        method: "POST",
        headers: { ...sbHeaders() },
        body: JSON.stringify({ action: "consolidate_vod", vod_id }),
      });
      const consolidateData = await consolidateRes.json();

      // Step 3: Compute metrics
      const metricsRes = await fetch(`${sbUrl()}/functions/v1/scanner-pipeline`, {
        method: "POST",
        headers: { ...sbHeaders() },
        body: JSON.stringify({ action: "compute_metrics", vod_id, streamer_login, vod_duration_seconds }),
      });
      const metricsData = await metricsRes.json();

      // Audit log
      await sbInsert("pipeline_audit_logs", [{
        entity_type: "vod",
        entity_id: vod_id,
        vod_id,
        action: "pipeline_completed",
        details: { validate: validateData, consolidate: consolidateData, metrics: metricsData },
      }]);

      return jsonResponse({ pipeline: "completed", validate: validateData, consolidate: consolidateData, metrics: metricsData });
    }

    // ─── REVIEW BLOCK ───
    if (action === "review_block") {
      const { block_id, new_status, review_notes, reviewer_id } = body;
      if (!block_id || !new_status) return jsonResponse({ error: "block_id and new_status required" }, 400);

      const ok = await sbUpdate("gameplay_blocks", `id=eq.${block_id}`, {
        status: new_status,
        review_notes: review_notes || null,
        reviewed_by: reviewer_id || null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await sbInsert("pipeline_audit_logs", [{
        entity_type: "gameplay_block",
        entity_id: block_id,
        action: `review_${new_status}`,
        performed_by: reviewer_id || null,
        details: { review_notes },
      }]);

      return jsonResponse({ success: ok, block_id, new_status });
    }

    // ─── GET REVIEW QUEUE ───
    if (action === "get_review_queue") {
      const blocks = await sbSelect("gameplay_blocks", `status=eq.suspect&order=created_at.desc&limit=100`);
      return jsonResponse({ blocks: Array.isArray(blocks) ? blocks : [] });
    }

    // ─── REQUEST REPROCESS ───
    if (action === "request_reprocess") {
      const { vod_id, streamer_login } = body;
      if (!vod_id) return jsonResponse({ error: "vod_id required" }, 400);

      // Mark old blocks as reprocessed
      await sbUpdate("gameplay_blocks", `vod_id=eq.${encodeURIComponent(vod_id)}`, { status: "discarded", discard_reason: "reprocessed", updated_at: new Date().toISOString() });
      // Mark old evidences for re-validation
      await sbUpdate("raw_evidences", `vod_id=eq.${encodeURIComponent(vod_id)}`, { validation_status: "pending", is_valid: true, discard_reason: null });
      // Update vod_audits
      await sbUpdate("vod_audits", `vod_id=eq.${encodeURIComponent(vod_id)}`, { status: "reprocessed", updated_at: new Date().toISOString() });

      await sbInsert("pipeline_audit_logs", [{
        entity_type: "vod",
        entity_id: vod_id,
        vod_id,
        action: "reprocess_requested",
        details: { streamer_login },
      }]);

      return jsonResponse({ success: true, vod_id });
    }

    // ─── GET VOD AUDIT DETAIL ───
    if (action === "get_vod_audit_detail") {
      const { vod_id } = body;
      if (!vod_id) return jsonResponse({ error: "vod_id required" }, 400);

      const audits = await sbSelect("vod_audits", `vod_id=eq.${encodeURIComponent(vod_id)}&limit=1`);
      const blocks = await sbSelect("gameplay_blocks", `vod_id=eq.${encodeURIComponent(vod_id)}&order=start_seconds.asc`);
      const evidences = await sbSelect("raw_evidences", `vod_id=eq.${encodeURIComponent(vod_id)}&order=timestamp_seconds.asc&limit=500`);
      const logs = await sbSelect("pipeline_audit_logs", `vod_id=eq.${encodeURIComponent(vod_id)}&order=created_at.desc&limit=50`);

      return jsonResponse({
        audit: Array.isArray(audits) && audits.length > 0 ? audits[0] : null,
        blocks: Array.isArray(blocks) ? blocks : [],
        evidences: Array.isArray(evidences) ? evidences : [],
        logs: Array.isArray(logs) ? logs : [],
      });
    }

    // ─── GET QUALITY METRICS ───
    if (action === "get_quality_metrics") {
      const audits = await sbSelect("vod_audits", `order=created_at.desc&limit=100`);
      const configs = await sbSelect("pipeline_configs", `order=config_key.asc`);

      const arr = Array.isArray(audits) ? audits : [];
      const avgCoverage = arr.length > 0 ? arr.reduce((s: number, a: any) => s + (a.coverage_percent || 0), 0) / arr.length : 0;
      const avgConfidence = arr.length > 0 ? arr.reduce((s: number, a: any) => s + (a.confidence_score || 0), 0) / arr.length : 0;
      const totalBlocks = arr.reduce((s: number, a: any) => s + (a.confirmed_blocks || 0) + (a.suspect_blocks || 0), 0);

      return jsonResponse({
        avg_coverage: Math.round(avgCoverage * 10) / 10,
        avg_confidence: Math.round(avgConfidence * 100) / 100,
        total_vods_processed: arr.length,
        total_blocks: totalBlocks,
        configs: Array.isArray(configs) ? configs : [],
      });
    }

    // ─── GET/UPDATE PIPELINE CONFIG ───
    if (action === "get_pipeline_config") {
      const configs = await sbSelect("pipeline_configs", `order=config_key.asc`);
      return jsonResponse({ configs: Array.isArray(configs) ? configs : [] });
    }

    if (action === "update_pipeline_config") {
      const { config_key, config_value } = body;
      if (!config_key) return jsonResponse({ error: "config_key required" }, 400);

      const existing = await sbSelect("pipeline_configs", `config_key=eq.${encodeURIComponent(config_key)}&limit=1`);
      if (Array.isArray(existing) && existing.length > 0) {
        await sbUpdate("pipeline_configs", `config_key=eq.${encodeURIComponent(config_key)}`, { config_value, updated_at: new Date().toISOString() });
      } else {
        await sbInsert("pipeline_configs", [{ config_key, config_value }]);
      }
      return jsonResponse({ success: true });
    }

    // ─── GET STATUS ───
    if (action === "get_status") {
      const audits = await sbSelect("vod_audits", `select=status&limit=1000`);
      const queue = await sbSelect("processing_queue", `status=in.(pending,running)&select=id`);
      const blocks = await sbSelect("gameplay_blocks", `select=status&limit=1000`);

      const arr = Array.isArray(audits) ? audits : [];
      const blk = Array.isArray(blocks) ? blocks : [];

      return jsonResponse({
        total_vods: arr.length,
        processing: arr.filter((a: any) => a.status === "processing").length,
        completed: arr.filter((a: any) => a.status === "completed").length,
        failed: arr.filter((a: any) => a.status === "failed").length,
        queue_pending: Array.isArray(queue) ? queue.length : 0,
        confirmed_blocks: blk.filter((b: any) => b.status === "confirmed").length,
        suspect_blocks: blk.filter((b: any) => b.status === "suspect").length,
      });
    }

    // ─── GET DASHBOARD ───
    if (action === "get_dashboard") {
      const { date_from, date_to, platform, provider_id, game_id, streamer, source_type, block_status_filter } = body;

      // Build filter for gameplay_blocks
      let blockFilter = "order=created_at.desc&limit=1000";
      const statusFilter = block_status_filter === "all" ? "" : block_status_filter === "suspect" ? "&status=eq.suspect" : "&status=eq.confirmed";
      blockFilter += statusFilter;
      if (date_from) blockFilter += `&created_at=gte.${date_from}`;
      if (date_to) blockFilter += `&created_at=lte.${date_to}`;
      if (platform) blockFilter += `&platform=eq.${platform}`;
      if (streamer) blockFilter += `&streamer_login=eq.${encodeURIComponent(streamer)}`;

      const blocks = await sbSelect("gameplay_blocks", blockFilter);
      const blk = Array.isArray(blocks) ? blocks : [];

      // Aggregate
      let totalExposure = 0;
      const streamerSet = new Set<string>();
      const providerShare: Record<string, number> = {};
      const gameShare: Record<string, number> = {};

      for (const b of blk) {
        totalExposure += b.duration_seconds || 0;
        streamerSet.add(b.streamer_login);
        if (b.provider_name) {
          providerShare[b.provider_name] = (providerShare[b.provider_name] || 0) + (b.duration_seconds || 0);
        }
        if (b.game_name) {
          gameShare[b.game_name] = (gameShare[b.game_name] || 0) + (b.duration_seconds || 0);
        }
      }

      // VOD audit stats
      let auditFilter = "select=coverage_percent,confidence_score&limit=1000";
      if (date_from) auditFilter += `&created_at=gte.${date_from}`;
      if (date_to) auditFilter += `&created_at=lte.${date_to}`;
      if (streamer) auditFilter += `&streamer_login=eq.${encodeURIComponent(streamer)}`;
      const audits = await sbSelect("vod_audits", auditFilter);
      const auditArr = Array.isArray(audits) ? audits : [];
      const avgCoverage = auditArr.length > 0 ? auditArr.reduce((s: number, a: any) => s + (a.coverage_percent || 0), 0) / auditArr.length : 0;

      // Consistency check
      const providerTotal = Object.values(providerShare).reduce((a, b) => a + b, 0);
      const gameTotal = Object.values(gameShare).reduce((a, b) => a + b, 0);
      const consistencyCheck = Math.abs(providerTotal - totalExposure) < 60 && Math.abs(gameTotal - totalExposure) < 60;

      return jsonResponse({
        total_exposure_seconds: totalExposure,
        total_viewer_minutes: Math.round(totalExposure / 60),
        unique_streamers: streamerSet.size,
        total_detections: blk.length,
        avg_vod_coverage: Math.round(avgCoverage),
        provider_share: providerShare,
        game_share: gameShare,
        chat_sentiment: { positive: 0, neutral: 0, negative: 0 },
        _meta: { consistency_check: consistencyCheck, blocks_counted: blk.length },
      });
    }

    // ─── GET RANKINGS ───
    if (action === "get_rankings") {
      const { date_from, date_to, rank_by, block_status_filter } = body;

      let blockFilter = "order=created_at.desc&limit=1000";
      const statusF = block_status_filter === "all" ? "" : block_status_filter === "suspect" ? "&status=eq.suspect" : "&status=eq.confirmed";
      blockFilter += statusF;
      if (date_from) blockFilter += `&created_at=gte.${date_from}`;
      if (date_to) blockFilter += `&created_at=lte.${date_to}`;

      const blocks = await sbSelect("gameplay_blocks", blockFilter);
      const blk = Array.isArray(blocks) ? blocks : [];

      const ranking: Record<string, { key: string; exposure: number; blocks: number }> = {};
      for (const b of blk) {
        let key = "";
        if (rank_by === "streamer") key = b.streamer_login;
        else if (rank_by === "provider") key = b.provider_name || "Unknown";
        else if (rank_by === "game") key = b.game_name || "Unknown";
        if (!key) continue;
        if (!ranking[key]) ranking[key] = { key, exposure: 0, blocks: 0 };
        ranking[key].exposure += b.duration_seconds || 0;
        ranking[key].blocks++;
      }

      const sorted = Object.values(ranking).sort((a, b) => b.exposure - a.exposure);
      return jsonResponse({ rankings: sorted });
    }

    // ─── ENQUEUE JOB ───
    if (action === "enqueue_job") {
      const { job_type, streamer_login, platform: plat, source_id, priority, metadata } = body;
      if (!job_type || !streamer_login) return jsonResponse({ error: "job_type and streamer_login required" }, 400);

      const data = await sbInsert("processing_queue", [{
        job_type,
        streamer_login,
        platform: plat || "twitch",
        source_id: source_id || null,
        priority: priority || "normal",
        metadata: metadata || {},
        status: "pending",
      }]);

      return jsonResponse({ queued: true, job: Array.isArray(data) ? data[0] : null });
    }

    // ─── GET QUEUE ───
    if (action === "get_queue") {
      const statusFilter = body.status ? `status=eq.${body.status}&` : "";
      const queue = await sbSelect("processing_queue", `${statusFilter}order=created_at.desc&limit=100`);
      return jsonResponse({ queue: Array.isArray(queue) ? queue : [] });
    }

    // ─── PROCESS VOD (full scan trigger) ───
    if (action === "process_vod") {
      const { vod_id, streamer_login } = body;
      if (!vod_id || !streamer_login) return jsonResponse({ error: "vod_id and streamer_login required" }, 400);

      // Create audit entry
      const existing = await sbSelect("vod_audits", `vod_id=eq.${encodeURIComponent(vod_id)}&limit=1`);
      if (Array.isArray(existing) && existing.length === 0) {
        await sbInsert("vod_audits", [{ vod_id, streamer_login, platform: "twitch", status: "queued" }]);
      }

      return jsonResponse({ status: "queued", vod_id, streamer_login });
    }

    // ─── SAVE DETECTIONS (legacy compat) ───
    if (action === "save_detections") {
      const { detections } = body;
      if (!detections || !Array.isArray(detections)) return jsonResponse({ error: "detections array required" }, 400);
      const data = await sbInsert("detections", detections);
      return jsonResponse({ saved: Array.isArray(data) ? data.length : 0 });
    }

    // ─── GET CHAT STATS ───
    if (action === "get_chat_stats") {
      const { streamer_login, date_from, date_to } = body;
      let filter = "select=sentiment_label&limit=5000";
      if (streamer_login) filter += `&streamer_login=eq.${encodeURIComponent(streamer_login)}`;
      if (date_from) filter += `&message_at=gte.${date_from}`;
      if (date_to) filter += `&message_at=lte.${date_to}`;
      const msgs = await sbSelect("chat_messages", filter);
      const arr = Array.isArray(msgs) ? msgs : [];
      const sentiment = { positive: 0, neutral: 0, negative: 0, total: arr.length };
      for (const m of arr) {
        if (m.sentiment_label === "positive") sentiment.positive++;
        else if (m.sentiment_label === "negative") sentiment.negative++;
        else sentiment.neutral++;
      }
      return jsonResponse(sentiment);
    }

    // ─── RECONCILE ───
    if (action === "reconcile") {
      return jsonResponse({ message: "Reconciliation completed (no-op placeholder)", reconciled: 0 });
    }

    return jsonResponse({ error: "Unknown action: " + action }, 400);
  } catch (error: unknown) {
    console.error("Scanner pipeline error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: msg }, 500);
  }
});
