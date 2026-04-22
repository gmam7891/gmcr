import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { action } = body;

    // ─── Save Raw Evidences ──────────────────
    if (action === "save_raw_evidences") {
      const { evidences, processing_batch_id } = body;
      if (!evidences?.length) return json({ saved: 0 });

      const rows = evidences.map((e: any) => ({
        vod_id: e.vod_id,
        streamer_login: e.streamer_login,
        platform: e.platform || "twitch",
        source_type: e.source_type || "vod",
        source_id: e.source_id || e.vod_id,
        timestamp_seconds: e.timestamp_seconds || 0,
        game_detected: e.game || null,
        provider_detected: e.provider || null,
        confidence_score: e.confidence || 0,
        processing_batch_id: processing_batch_id || null,
        validation_status: "pending",
        is_valid: true,
      }));

      const { error } = await supabase.from("raw_evidences").insert(rows);
      if (error) throw new Error(`save_raw_evidences: ${error.message}`);
      return json({ saved: rows.length });
    }

    // ─── Validate VOD ──────────────────
    if (action === "validate_vod") {
      const { vod_id } = body;
      const { data: evidences } = await supabase
        .from("raw_evidences")
        .select("*")
        .eq("vod_id", vod_id)
        .eq("validation_status", "pending");

      if (!evidences?.length) return json({ validated: 0 });

      let valid = 0, discarded = 0;
      for (const ev of evidences) {
        const isValid = (ev.confidence_score || 0) >= 0.3;
        await supabase.from("raw_evidences").update({
          is_valid: isValid,
          validation_status: isValid ? "valid" : "discarded",
          discard_reason: isValid ? null : "low_confidence",
        }).eq("id", ev.id);
        if (isValid) valid++; else discarded++;
      }

      return json({ validated: valid, discarded });
    }

    // ─── Consolidate VOD into Gameplay Blocks ──────────────────
    if (action === "consolidate_vod") {
      const { vod_id } = body;
      const { data: evidences } = await supabase
        .from("raw_evidences")
        .select("*")
        .eq("vod_id", vod_id)
        .eq("is_valid", true)
        .order("timestamp_seconds", { ascending: true });

      if (!evidences?.length) return json({ blocks: 0 });

      // Group consecutive evidences of same game into blocks
      // Persistence rule: need 2+ consecutive frames (2 min rule)
      const blocks: any[] = [];
      let current: any = null;

      for (const ev of evidences) {
        if (!current || current.game !== ev.game_detected || (ev.timestamp_seconds - current.endSec) > 180) {
          if (current && current.count >= 2) {
            blocks.push(current);
          }
          current = {
            game: ev.game_detected,
            provider: ev.provider_detected,
            startSec: ev.timestamp_seconds,
            endSec: ev.timestamp_seconds + 60,
            confidences: [ev.confidence_score],
            count: 1,
          };
        } else {
          current.endSec = ev.timestamp_seconds + 60;
          current.confidences.push(ev.confidence_score);
          current.count++;
        }
      }
      if (current && current.count >= 2) blocks.push(current);

      // Get streamer_login from first evidence
      const streamerLogin = evidences[0].streamer_login;

      // Save blocks
      const blockRows = blocks.map(b => ({
        vod_id,
        streamer_login: streamerLogin,
        platform: "twitch",
        source_type: "vod",
        source_id: vod_id,
        game_name: b.game,
        provider_name: b.provider,
        start_seconds: b.startSec,
        end_seconds: b.endSec,
        duration_seconds: b.endSec - b.startSec,
        evidence_count: b.count,
        confidence_avg: b.confidences.reduce((a: number, c: number) => a + c, 0) / b.confidences.length,
        confidence_min: Math.min(...b.confidences),
        confidence_max: Math.max(...b.confidences),
        status: "confirmed",
      }));

      // Also track discarded single-frame detections
      const discardedBlocks: any[] = [];
      current = null;
      for (const ev of evidences) {
        if (!current || current.game !== ev.game_detected || (ev.timestamp_seconds - current.endSec) > 180) {
          if (current && current.count < 2) {
            discardedBlocks.push(current);
          }
          current = {
            game: ev.game_detected,
            provider: ev.provider_detected,
            startSec: ev.timestamp_seconds,
            endSec: ev.timestamp_seconds + 60,
            confidences: [ev.confidence_score],
            count: 1,
          };
        } else {
          current.endSec = ev.timestamp_seconds + 60;
          current.confidences.push(ev.confidence_score);
          current.count++;
        }
      }
      if (current && current.count < 2) discardedBlocks.push(current);

      const discardedRows = discardedBlocks.map(b => ({
        vod_id,
        streamer_login: streamerLogin,
        platform: "twitch",
        source_type: "vod",
        source_id: vod_id,
        game_name: b.game,
        provider_name: b.provider,
        start_seconds: b.startSec,
        end_seconds: b.endSec,
        duration_seconds: b.endSec - b.startSec,
        evidence_count: b.count,
        confidence_avg: b.confidences.reduce((a: number, c: number) => a + c, 0) / b.confidences.length,
        confidence_min: Math.min(...b.confidences),
        confidence_max: Math.max(...b.confidences),
        status: "discarded",
        discard_reason: "single_frame_noise",
      }));

      const allRows = [...blockRows, ...discardedRows];
      if (allRows.length > 0) {
        const { error } = await supabase.from("gameplay_blocks").insert(allRows);
        if (error) throw new Error(`consolidate: ${error.message}`);
      }

      return json({ confirmed: blockRows.length, discarded: discardedRows.length });
    }

    // ─── Compute Metrics (vod_audits) ──────────────────
    if (action === "compute_metrics") {
      const { vod_id, vod_duration_seconds } = body;

      const { data: evidences } = await supabase
        .from("raw_evidences")
        .select("id, is_valid, validation_status")
        .eq("vod_id", vod_id);

      const { data: blocks } = await supabase
        .from("gameplay_blocks")
        .select("*")
        .eq("vod_id", vod_id);

      const totalEvidences = evidences?.length || 0;
      const validEvidences = evidences?.filter(e => e.is_valid)?.length || 0;
      const discardedEvidences = totalEvidences - validEvidences;

      const confirmedBlocks = blocks?.filter(b => b.status === "confirmed") || [];
      const suspectBlocks = blocks?.filter(b => b.status === "suspect") || [];
      const discardedBlocks = blocks?.filter(b => b.status === "discarded") || [];

      const processedDuration = confirmedBlocks.reduce((sum, b) => sum + (b.duration_seconds || 0), 0);
      const vodDuration = vod_duration_seconds || 3600;
      const coverage = Math.min(100, Math.round((processedDuration / vodDuration) * 100));

      const allConfidences = confirmedBlocks.map(b => b.confidence_avg || 0);
      const avgConfidence = allConfidences.length > 0
        ? allConfidences.reduce((a, c) => a + c, 0) / allConfidences.length
        : 0;

      // Determine quality status
      let qualityStatus = "unknown";
      if (totalEvidences === 0) {
        qualityStatus = "unknown";
      } else if (coverage >= 70 && avgConfidence >= 0.75) {
        qualityStatus = "good";
      } else if (coverage >= 40 || avgConfidence >= 0.5) {
        qualityStatus = "fair";
      } else {
        qualityStatus = "poor";
      }

      // Determine overall status
      let status: string;
      if (totalEvidences === 0) {
        status = "completed"; // No casino content found is a valid result
      } else if (confirmedBlocks.length > 0) {
        status = "completed";
      } else if (suspectBlocks.length > 0) {
        status = "needs_review";
      } else {
        status = "completed";
      }

      const auditRow = {
        vod_id,
        streamer_login: confirmedBlocks[0]?.streamer_login || blocks?.[0]?.streamer_login || "unknown",
        platform: "twitch",
        status,
        vod_duration_seconds: vodDuration,
        processed_duration_seconds: processedDuration,
        coverage_percent: coverage,
        confidence_score: Math.round(avgConfidence * 100), // Store as 0-100 percentage
        total_evidences: totalEvidences,
        valid_evidences: validEvidences,
        discarded_evidences: discardedEvidences,
        confirmed_blocks: confirmedBlocks.length,
        suspect_blocks: suspectBlocks.length,
        discarded_blocks: discardedBlocks.length,
        data_quality_status: qualityStatus,
        completed_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      };

      // Upsert by vod_id
      const { data: existing } = await supabase
        .from("vod_audits")
        .select("id")
        .eq("vod_id", vod_id)
        .maybeSingle();

      if (existing) {
        await supabase.from("vod_audits").update(auditRow).eq("vod_id", vod_id);
      } else {
        await supabase.from("vod_audits").insert(auditRow);
      }

      return json({ status, coverage, confidence: Math.round(avgConfidence * 100), confirmedBlocks: confirmedBlocks.length });
    }

    // ─── Run Full Pipeline ──────────────────
    if (action === "run_pipeline") {
      const { vod_id, streamer_login, vod_duration_seconds } = body;

      // Step 1: Validate
      const validateRes = await handleAction(supabase, { action: "validate_vod", vod_id });
      
      // Step 2: Consolidate
      const consolidateRes = await handleAction(supabase, { action: "consolidate_vod", vod_id });
      
      // Step 3: Compute metrics
      const metricsRes = await handleAction(supabase, { action: "compute_metrics", vod_id, vod_duration_seconds });

      // Log pipeline run
      await supabase.from("pipeline_audit_logs").insert({
        action: "run_pipeline",
        entity_type: "vod",
        entity_id: vod_id,
        vod_id,
        details: { streamer_login, validate: validateRes, consolidate: consolidateRes, metrics: metricsRes },
      });

      return json({ pipeline: "completed", vod_id, validate: validateRes, consolidate: consolidateRes, metrics: metricsRes });
    }

    // ─── Get VOD Audit Detail ──────────────────
    if (action === "get_vod_audit_detail") {
      const { vod_id } = body;

      const [blocksRes, evidencesRes, logsRes] = await Promise.all([
        supabase.from("gameplay_blocks").select("*").eq("vod_id", vod_id).order("start_seconds"),
        supabase.from("raw_evidences").select("id, is_valid, validation_status, confidence_score, game_detected, provider_detected").eq("vod_id", vod_id),
        supabase.from("pipeline_audit_logs").select("*").eq("vod_id", vod_id).order("created_at", { ascending: false }).limit(20),
      ]);

      const evidences = evidencesRes.data || [];
      return json({
        blocks: blocksRes.data || [],
        logs: logsRes.data || [],
        evidence_summary: {
          total: evidences.length,
          valid: evidences.filter(e => e.is_valid).length,
          discarded: evidences.filter(e => !e.is_valid).length,
        },
      });
    }

    // ─── Review Block ──────────────────
    if (action === "review_block") {
      const { block_id, new_status, review_notes, reviewer_id } = body;
      const { error } = await supabase.from("gameplay_blocks").update({
        status: new_status,
        review_notes,
        reviewed_by: reviewer_id || null,
        reviewed_at: new Date().toISOString(),
      }).eq("id", block_id);
      if (error) throw new Error(error.message);

      await supabase.from("pipeline_audit_logs").insert({
        action: "review_block",
        entity_type: "gameplay_block",
        entity_id: block_id,
        details: { new_status, review_notes },
        performed_by: reviewer_id || null,
      });

      return json({ success: true });
    }

    // ─── Request Reprocess ──────────────────
    if (action === "request_reprocess") {
      const { vod_id, streamer_login } = body;
      // Clear existing data for this VOD
      await supabase.from("gameplay_blocks").delete().eq("vod_id", vod_id);
      await supabase.from("raw_evidences").delete().eq("vod_id", vod_id);
      await supabase.from("vod_audits").update({ status: "reprocessed" }).eq("vod_id", vod_id);
      return json({ reprocessed: true, vod_id });
    }

    // ─── Get Dashboard Data ──────────────────
    if (action === "get_dashboard") {
      const { date_from, date_to, platform, provider_id, game_id, streamer, block_status_filter } = body;

      let query = supabase.from("gameplay_blocks").select("*");
      if (streamer) query = query.eq("streamer_login", streamer);
      if (platform) query = query.eq("platform", platform);
      if (block_status_filter && block_status_filter !== "all") query = query.eq("status", block_status_filter);
      if (date_from) query = query.gte("created_at", date_from);
      if (date_to) query = query.lte("created_at", date_to);

      const { data: blocks } = await query.order("created_at", { ascending: false }).limit(500);
      if (!blocks?.length) {
        return json({
          total_exposure_seconds: 0, total_viewer_minutes: 0,
          unique_streamers: 0, total_detections: 0, avg_vod_coverage: 0,
          provider_share: {}, game_share: {}, chat_sentiment: {},
        });
      }

      const totalExposure = blocks.reduce((s, b) => s + (b.duration_seconds || 0), 0);
      const uniqueStreamers = new Set(blocks.map(b => b.streamer_login)).size;

      // Provider and game share by duration
      const providerShare: Record<string, number> = {};
      const gameShare: Record<string, number> = {};
      for (const b of blocks) {
        if (b.provider_name) providerShare[b.provider_name] = (providerShare[b.provider_name] || 0) + (b.duration_seconds || 0);
        if (b.game_name) gameShare[b.game_name] = (gameShare[b.game_name] || 0) + (b.duration_seconds || 0);
      }

      // Get avg coverage from vod_audits
      const { data: audits } = await supabase
        .from("vod_audits")
        .select("coverage_percent, pending_audit_segments, vod_duration_seconds")
        .limit(100);
      const avgCoverage = audits?.length
        ? audits.reduce((s, a) => s + (a.coverage_percent || 0), 0) / audits.length
        : 0;

      // ─── IA vs Twitch (categoria oficial declarada vs detecção visual) ─────
      // Twitch categories: somar duração dos chapters declarados pela Twitch (em vod_audits.pending_audit_segments.plan.chapters)
      const twitchCategoryShare: Record<string, number> = {};
      for (const a of audits || []) {
        const segs: any = a.pending_audit_segments;
        const chapters = segs?.plan?.chapters;
        if (Array.isArray(chapters)) {
          for (const ch of chapters) {
            const name = (ch.game || "Unknown").trim();
            twitchCategoryShare[name] = (twitchCategoryShare[name] || 0) + (ch.durationSeconds || 0);
          }
        }
      }

      // Build comparative array — IA é gameShare (por jogo detectado), Twitch é twitchCategoryShare (declarado)
      const allKeys = new Set([...Object.keys(gameShare), ...Object.keys(twitchCategoryShare)]);
      const aiVsTwitch = Array.from(allKeys).map((name) => ({
        name,
        ai_seconds: gameShare[name] || 0,
        twitch_seconds: twitchCategoryShare[name] || 0,
      })).sort((a, b) => (b.ai_seconds + b.twitch_seconds) - (a.ai_seconds + a.twitch_seconds)).slice(0, 10);

      return json({
        total_exposure_seconds: totalExposure,
        total_viewer_minutes: Math.round(totalExposure / 60),
        unique_streamers: uniqueStreamers,
        total_detections: blocks.length,
        avg_vod_coverage: avgCoverage,
        provider_share: providerShare,
        game_share: gameShare,
        twitch_category_share: twitchCategoryShare,
        ai_vs_twitch: aiVsTwitch,
        chat_sentiment: {},
      });
    }

    // ─── Get Rankings ──────────────────
    if (action === "get_rankings") {
      const { rank_by, date_from, date_to, block_status_filter } = body;

      let query = supabase.from("gameplay_blocks").select("*").eq("status", block_status_filter || "confirmed");
      if (date_from) query = query.gte("created_at", date_from);
      if (date_to) query = query.lte("created_at", date_to);

      const { data: blocks } = await query.limit(1000);
      if (!blocks?.length) return json({ rankings: [] });

      const agg: Record<string, { key: string; exposure: number; sessions: number; viewer_minutes: number; peak: number }> = {};
      for (const b of blocks) {
        const k = rank_by === "streamer" ? b.streamer_login
          : rank_by === "provider" ? (b.provider_name || "Unknown")
          : (b.game_name || "Unknown");
        if (!agg[k]) agg[k] = { key: k, exposure: 0, sessions: 0, viewer_minutes: 0, peak: 0 };
        agg[k].exposure += b.duration_seconds || 0;
        agg[k].sessions++;
        agg[k].viewer_minutes += Math.round((b.duration_seconds || 0) / 60);
      }

      const rankings = Object.values(agg)
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 20);

      return json({ rankings });
    }

    // ─── Get Aggregated Results (jogos × tempo por VOD/streamer) ──────────────────
    if (action === "get_results_aggregated") {
      const { date_from, date_to, streamer, block_status_filter, group_by } = body;
      // group_by: "game" (default) | "vod" | "streamer_game"
      let query = supabase.from("gameplay_blocks").select("*");
      if (block_status_filter && block_status_filter !== "all") {
        query = query.eq("status", block_status_filter);
      } else if (!block_status_filter) {
        query = query.eq("status", "confirmed");
      }
      if (date_from) query = query.gte("created_at", date_from);
      if (date_to) query = query.lte("created_at", date_to);
      if (streamer) query = query.eq("streamer_login", streamer);

      const { data: blocks } = await query.order("created_at", { ascending: false }).limit(2000);
      if (!blocks?.length) return json({ aggregated: [], totals: { games: 0, blocks: 0, exposure_seconds: 0, vods: 0, streamers: 0 }, blocks: [] });

      const agg: Record<string, { key: string; game: string; provider: string; exposure_seconds: number; sessions: number; avg_confidence: number; vods: Set<string>; streamers: Set<string> }> = {};
      for (const b of blocks) {
        const game = b.game_name || "Unknown";
        const provider = b.provider_name || "Unknown";
        const key = group_by === "vod" ? `${b.vod_id}::${game}`
          : group_by === "streamer_game" ? `${b.streamer_login}::${game}`
          : game;
        if (!agg[key]) agg[key] = { key, game, provider, exposure_seconds: 0, sessions: 0, avg_confidence: 0, vods: new Set(), streamers: new Set() };
        agg[key].exposure_seconds += b.duration_seconds || 0;
        agg[key].sessions++;
        agg[key].avg_confidence += Number(b.confidence_avg) || 0;
        agg[key].vods.add(b.vod_id);
        agg[key].streamers.add(b.streamer_login);
      }

      const aggregated = Object.values(agg).map(a => ({
        key: a.key,
        game: a.game,
        provider: a.provider,
        exposure_seconds: a.exposure_seconds,
        exposure_minutes: Math.round(a.exposure_seconds / 60),
        sessions: a.sessions,
        avg_confidence: a.sessions > 0 ? a.avg_confidence / a.sessions : 0,
        vods_count: a.vods.size,
        streamers_count: a.streamers.size,
      })).sort((a, b) => b.exposure_seconds - a.exposure_seconds);

      const allVods = new Set(blocks.map(b => b.vod_id));
      const allStreamers = new Set(blocks.map(b => b.streamer_login));
      const totalExposure = blocks.reduce((s, b) => s + (b.duration_seconds || 0), 0);

      return json({
        aggregated,
        totals: {
          games: new Set(blocks.map(b => b.game_name || "Unknown")).size,
          blocks: blocks.length,
          exposure_seconds: totalExposure,
          exposure_minutes: Math.round(totalExposure / 60),
          vods: allVods.size,
          streamers: allStreamers.size,
        },
        blocks: blocks.slice(0, 500).map(b => ({
          id: b.id, vod_id: b.vod_id, streamer_login: b.streamer_login,
          game_name: b.game_name, provider_name: b.provider_name,
          start_seconds: b.start_seconds, end_seconds: b.end_seconds,
          duration_seconds: b.duration_seconds, confidence_avg: b.confidence_avg,
          status: b.status, created_at: b.created_at,
        })),
      });
    }

    // ─── Get Review Queue ──────────────────
    if (action === "get_review_queue") {
      const { data } = await supabase.from("gameplay_blocks")
        .select("*")
        .in("status", ["suspect", "needs_review"])
        .order("created_at", { ascending: false })
        .limit(50);
      return json({ queue: data || [] });
    }

    // ─── Get Quality Metrics ──────────────────
    if (action === "get_quality_metrics") {
      const { data: audits } = await supabase.from("vod_audits").select("*").limit(200);
      if (!audits?.length) return json({ confirmed_blocks: 0, suspect_blocks: 0, false_positive_rate: 0, avg_coverage: 0, avg_confidence: 0 });

      const confirmed = audits.reduce((s, a) => s + (a.confirmed_blocks || 0), 0);
      const suspect = audits.reduce((s, a) => s + (a.suspect_blocks || 0), 0);
      const discarded = audits.reduce((s, a) => s + (a.discarded_blocks || 0), 0);
      const total = confirmed + suspect + discarded;
      const fpr = total > 0 ? (discarded / total) * 100 : 0;
      const avgCoverage = audits.reduce((s, a) => s + (a.coverage_percent || 0), 0) / audits.length;
      const avgConfidence = audits.reduce((s, a) => s + (a.confidence_score || 0), 0) / audits.length;

      return json({ confirmed_blocks: confirmed, suspect_blocks: suspect, false_positive_rate: fpr, avg_coverage: avgCoverage, avg_confidence: avgConfidence });
    }

    // ─── Get Pipeline Config ──────────────────
    if (action === "get_pipeline_config") {
      const { data } = await supabase.from("pipeline_configs").select("*").order("config_key");
      return json({ configs: data || [] });
    }

    // ─── Update Pipeline Config ──────────────────
    if (action === "update_pipeline_config") {
      const { config_key, config_value } = body;
      const { error } = await supabase.from("pipeline_configs").upsert({
        config_key, config_value,
        updated_at: new Date().toISOString(),
      }, { onConflict: "config_key" });
      if (error) throw new Error(error.message);
      return json({ success: true });
    }

    // ─── Get System Status ──────────────────
    if (action === "get_status") {
      const [audits, blocks, queue] = await Promise.all([
        supabase.from("vod_audits").select("id", { count: "exact", head: true }),
        supabase.from("gameplay_blocks").select("id", { count: "exact", head: true }),
        supabase.from("processing_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      return json({
        total_vods_audited: audits.count || 0,
        total_blocks: blocks.count || 0,
        pending_jobs: queue.count || 0,
      });
    }

    // ─── Enqueue Job ──────────────────
    if (action === "enqueue_job") {
      const { job_type, streamer_login, platform, source_id, priority, metadata } = body;
      const { error } = await supabase.from("processing_queue").insert({
        job_type, streamer_login, platform: platform || "twitch",
        source_id, priority: priority || "normal", metadata: metadata || {},
      });
      if (error) throw new Error(error.message);
      return json({ enqueued: true });
    }

    // ─── Get Queue ──────────────────
    if (action === "get_queue") {
      const { status } = body;
      let query = supabase.from("processing_queue").select("*");
      if (status) query = query.eq("status", status);
      const { data } = await query.order("created_at", { ascending: false }).limit(50);
      return json({ queue: data || [] });
    }

    // ─── Get Chat Stats ──────────────────
    if (action === "get_chat_stats") {
      const { streamer_login, date_from, date_to } = body;
      let query = supabase.from("chat_messages").select("sentiment_label");
      if (streamer_login) query = query.eq("streamer_login", streamer_login);
      if (date_from) query = query.gte("message_at", date_from);
      if (date_to) query = query.lte("message_at", date_to);
      const { data } = await query.limit(1000);

      const sentiment: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
      for (const m of (data || [])) {
        if (m.sentiment_label && sentiment[m.sentiment_label] !== undefined) {
          sentiment[m.sentiment_label]++;
        }
      }
      return json({ sentiment, total: data?.length || 0 });
    }

    // ─── Weekly Trend (current week vs previous week, by provider) ──────
    if (action === "get_trend_weekly") {
      const { date_to, streamers, provider_ids, platform } = body;
      const refTo = date_to ? new Date(date_to) : new Date();
      const endCur = new Date(refTo);
      const startCur = new Date(endCur.getTime() - 7 * 86400000);
      const startPrev = new Date(startCur.getTime() - 7 * 86400000);

      async function fetchRange(from: Date, to: Date) {
        let q = supabase.from("gameplay_blocks").select("provider_name,duration_seconds,streamer_login,platform,created_at,status")
          .eq("status", "confirmed")
          .gte("created_at", from.toISOString())
          .lte("created_at", to.toISOString());
        if (platform) q = q.eq("platform", platform);
        if (Array.isArray(streamers) && streamers.length) q = q.in("streamer_login", streamers);
        const { data } = await q.limit(5000);
        const share: Record<string, number> = {};
        for (const b of data || []) {
          const k = b.provider_name || "Unknown";
          share[k] = (share[k] || 0) + (b.duration_seconds || 0);
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

      return json({
        range: { current: { from: startCur.toISOString(), to: endCur.toISOString() }, previous: { from: startPrev.toISOString(), to: startCur.toISOString() } },
        trend,
      });
    }

    return json({ error: "Unknown action: " + action }, 400);
  } catch (error: unknown) {
    console.error("Scanner pipeline error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

// Helper to call actions internally during pipeline
async function handleAction(supabase: any, body: any): Promise<any> {
  const { action, vod_id, vod_duration_seconds } = body;

  if (action === "validate_vod") {
    const { data: evidences } = await supabase
      .from("raw_evidences").select("*").eq("vod_id", vod_id).eq("validation_status", "pending");
    if (!evidences?.length) return { validated: 0 };
    let valid = 0, discarded = 0;
    for (const ev of evidences) {
      const isValid = (ev.confidence_score || 0) >= 0.3;
      await supabase.from("raw_evidences").update({
        is_valid: isValid, validation_status: isValid ? "valid" : "discarded",
        discard_reason: isValid ? null : "low_confidence",
      }).eq("id", ev.id);
      if (isValid) valid++; else discarded++;
    }
    return { validated: valid, discarded };
  }

  if (action === "consolidate_vod") {
    const { data: evidences } = await supabase
      .from("raw_evidences").select("*").eq("vod_id", vod_id).eq("is_valid", true)
      .order("timestamp_seconds", { ascending: true });
    if (!evidences?.length) return { blocks: 0 };

    const blocks: any[] = [];
    let current: any = null;
    for (const ev of evidences) {
      if (!current || current.game !== ev.game_detected || (ev.timestamp_seconds - current.endSec) > 180) {
        if (current && current.count >= 2) blocks.push(current);
        current = { game: ev.game_detected, provider: ev.provider_detected, startSec: ev.timestamp_seconds, endSec: ev.timestamp_seconds + 60, confidences: [ev.confidence_score], count: 1 };
      } else {
        current.endSec = ev.timestamp_seconds + 60;
        current.confidences.push(ev.confidence_score);
        current.count++;
      }
    }
    if (current && current.count >= 2) blocks.push(current);

    const streamerLogin = evidences[0].streamer_login;
    const rows = blocks.map(b => ({
      vod_id, streamer_login: streamerLogin, platform: "twitch", source_type: "vod", source_id: vod_id,
      game_name: b.game, provider_name: b.provider, start_seconds: b.startSec, end_seconds: b.endSec,
      duration_seconds: b.endSec - b.startSec, evidence_count: b.count,
      confidence_avg: b.confidences.reduce((a: number, c: number) => a + c, 0) / b.confidences.length,
      confidence_min: Math.min(...b.confidences), confidence_max: Math.max(...b.confidences), status: "confirmed",
    }));
    if (rows.length > 0) await supabase.from("gameplay_blocks").insert(rows);
    return { confirmed: rows.length };
  }

  if (action === "compute_metrics") {
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
      vod_id, streamer_login: blocks?.[0]?.streamer_login || "unknown", platform: "twitch",
      status: "completed", vod_duration_seconds: vodDur, processed_duration_seconds: processedDur,
      coverage_percent: coverage, confidence_score: Math.round(avgConf * 100),
      total_evidences: totalEv, valid_evidences: validEv, discarded_evidences: totalEv - validEv,
      confirmed_blocks: confirmed.length, suspect_blocks: blocks?.filter((b: any) => b.status === "suspect")?.length || 0,
      discarded_blocks: blocks?.filter((b: any) => b.status === "discarded")?.length || 0,
      completed_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase.from("vod_audits").select("id").eq("vod_id", vod_id).maybeSingle();
    if (existing) await supabase.from("vod_audits").update(auditRow).eq("vod_id", vod_id);
    else await supabase.from("vod_audits").insert(auditRow);

    return { coverage, confidence: Math.round(avgConf * 100), confirmed: confirmed.length };
  }

  return {};
}
