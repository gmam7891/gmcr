import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.99.2/cors";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twitch";

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
      case "get_status": {
        // Get system status: active lives, pending jobs, etc.
        const [{ count: pendingJobs }, { count: runningJobs }, { data: recentDetections }, { data: activeStreamers }] = await Promise.all([
          supabase.from("processing_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("processing_queue").select("*", { count: "exact", head: true }).eq("status", "running"),
          supabase.from("detections").select("*").order("created_at", { ascending: false }).limit(5),
          supabase.from("monitored_streamers").select("*").eq("is_active", true),
        ]);

        // Check which streamers are live
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

        return json({
          pending_jobs: pendingJobs || 0,
          running_jobs: runningJobs || 0,
          active_lives: liveCount,
          monitored_streamers: activeStreamers?.length || 0,
          recent_detections: recentDetections || [],
        });
      }

      case "get_dashboard": {
        const { date_from, date_to, platform, provider_id, game_id, streamer, source_type } = params;
        
        // Build base query for exposure blocks
        let query = supabase.from("exposure_blocks").select("*");
        if (date_from) query = query.gte("start_at", date_from);
        if (date_to) query = query.lte("end_at", date_to);
        if (platform) query = query.eq("platform", platform);
        if (provider_id) query = query.eq("provider_id", provider_id);
        if (game_id) query = query.eq("game_id", game_id);
        if (streamer) query = query.eq("streamer_login", streamer);
        if (source_type) query = query.eq("source_type", source_type);

        const { data: blocks } = await query.order("start_at", { ascending: false }).limit(1000);
        
        // Build detection query
        let detQuery = supabase.from("detections").select("*");
        if (date_from) detQuery = detQuery.gte("detected_at", date_from);
        if (date_to) detQuery = detQuery.lte("detected_at", date_to);
        if (platform) detQuery = detQuery.eq("platform", platform);
        if (provider_id) detQuery = detQuery.eq("provider_id", provider_id);
        if (game_id) detQuery = detQuery.eq("game_id", game_id);
        if (streamer) detQuery = detQuery.eq("streamer_login", streamer);
        if (source_type) detQuery = detQuery.eq("source_type", source_type);

        const { data: detections } = await detQuery.order("detected_at", { ascending: false }).limit(1000);

        // VOD audits
        let vodQuery = supabase.from("vod_audits").select("*");
        if (streamer) vodQuery = vodQuery.eq("streamer_login", streamer);
        if (platform) vodQuery = vodQuery.eq("platform", platform);
        const { data: vodAudits } = await vodQuery.order("created_at", { ascending: false }).limit(200);

        // Chat stats
        let chatQuery = supabase.from("chat_messages").select("sentiment_label, intent_label, message_at, streamer_login");
        if (date_from) chatQuery = chatQuery.gte("message_at", date_from);
        if (date_to) chatQuery = chatQuery.lte("message_at", date_to);
        if (streamer) chatQuery = chatQuery.eq("streamer_login", streamer);
        const { data: chatMsgs } = await chatQuery.limit(1000);

        // Compute aggregations
        const totalExposure = (blocks || []).reduce((s: number, b: any) => s + (b.duration_seconds || 0), 0);
        const totalViewerMinutes = (blocks || []).reduce((s: number, b: any) => s + (b.viewer_minutes || 0), 0);
        const uniqueStreamers = new Set((blocks || []).map((b: any) => b.streamer_login)).size;
        
        // Provider share
        const providerMap: Record<string, number> = {};
        (blocks || []).forEach((b: any) => {
          const key = b.provider_id || "unknown";
          providerMap[key] = (providerMap[key] || 0) + (b.duration_seconds || 0);
        });

        // Game share
        const gameMap: Record<string, number> = {};
        (blocks || []).forEach((b: any) => {
          const key = b.game_id || "unknown";
          gameMap[key] = (gameMap[key] || 0) + (b.duration_seconds || 0);
        });

        // VOD quality
        const completedVods = (vodAudits || []).filter((v: any) => v.status === "completed");
        const avgCoverage = completedVods.length > 0
          ? completedVods.reduce((s: number, v: any) => s + (v.coverage_percent || 0), 0) / completedVods.length
          : 0;

        // Chat sentiment
        const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
        (chatMsgs || []).forEach((m: any) => {
          if (m.sentiment_label && sentimentCounts[m.sentiment_label as keyof typeof sentimentCounts] !== undefined) {
            sentimentCounts[m.sentiment_label as keyof typeof sentimentCounts]++;
          }
        });

        return json({
          total_exposure_seconds: totalExposure,
          total_viewer_minutes: totalViewerMinutes,
          unique_streamers: uniqueStreamers,
          provider_share: providerMap,
          game_share: gameMap,
          avg_vod_coverage: avgCoverage,
          chat_sentiment: sentimentCounts,
          total_detections: (detections || []).length,
          vod_audits: vodAudits || [],
          blocks: blocks || [],
          detections: detections || [],
        });
      }

      case "get_rankings": {
        const { date_from, date_to, rank_by } = params;
        
        let query = supabase.from("exposure_blocks").select("*");
        if (date_from) query = query.gte("start_at", date_from);
        if (date_to) query = query.lte("end_at", date_to);
        const { data: blocks } = await query.limit(1000);

        const rankings: Record<string, { exposure: number; viewer_minutes: number; sessions: number; peak: number }> = {};
        
        (blocks || []).forEach((b: any) => {
          let key: string;
          if (rank_by === "provider") key = b.provider_id || "unknown";
          else if (rank_by === "game") key = b.game_id || "unknown";
          else key = b.streamer_login;

          if (!rankings[key]) rankings[key] = { exposure: 0, viewer_minutes: 0, sessions: 0, peak: 0 };
          rankings[key].exposure += b.duration_seconds || 0;
          rankings[key].viewer_minutes += b.viewer_minutes || 0;
          rankings[key].sessions += 1;
          rankings[key].peak = Math.max(rankings[key].peak, b.peak_viewers || 0);
        });

        const sorted = Object.entries(rankings)
          .map(([key, val]) => ({ key, ...val }))
          .sort((a, b) => b.exposure - a.exposure);

        return json({ rankings: sorted });
      }

      case "enqueue_job": {
        const { job_type, streamer_login, platform, source_id, priority, metadata } = params;
        
        const { data, error } = await supabase.from("processing_queue").insert({
          job_type,
          streamer_login,
          platform: platform || "twitch",
          source_id,
          priority: priority || "normal",
          metadata: metadata || {},
        }).select().single();

        if (error) throw error;
        return json({ job: data });
      }

      case "process_vod": {
        const { vod_id, streamer_login } = params;
        
        // Create or update VOD audit
        const { data: audit, error: auditErr } = await supabase.from("vod_audits").upsert({
          vod_id,
          streamer_login,
          status: "processing",
          started_at: new Date().toISOString(),
        }, { onConflict: "vod_id,platform" }).select().single();
        
        if (auditErr) throw auditErr;
        return json({ audit, message: "VOD processing started" });
      }

      case "save_detections": {
        const { detections: dets } = params;
        if (!dets || !Array.isArray(dets) || dets.length === 0) {
          return json({ error: "No detections to save" }, 400);
        }

        // Normalize provider/game names via aliases
        const { data: providerAliases } = await supabase.from("provider_aliases").select("alias, provider_id");
        const { data: providers } = await supabase.from("providers").select("id, name, slug");
        
        const aliasMap: Record<string, string> = {};
        (providerAliases || []).forEach((a: any) => {
          aliasMap[a.alias.toLowerCase()] = a.provider_id;
        });
        (providers || []).forEach((p: any) => {
          aliasMap[p.name.toLowerCase()] = p.id;
          aliasMap[p.slug.toLowerCase()] = p.id;
        });

        const normalized = dets.map((d: any) => {
          const providerLower = (d.provider_name || "").toLowerCase();
          const resolvedProviderId = aliasMap[providerLower] || d.provider_id || null;
          
          return {
            streamer_login: d.streamer_login,
            platform: d.platform || "twitch",
            source_type: d.source_type || "vod",
            source_id: d.source_id,
            provider_id: resolvedProviderId,
            game_id: d.game_id || null,
            provider_name: d.provider_name,
            game_name: d.game_name,
            confidence: d.confidence || 0,
            detected_at: d.detected_at || new Date().toISOString(),
            exposure_seconds: d.exposure_seconds || 0,
            viewer_count: d.viewer_count || 0,
            offset_seconds: d.offset_seconds || 0,
          };
        });

        const { data, error } = await supabase.from("detections").insert(normalized).select();
        if (error) throw error;

        return json({ saved: data?.length || 0 });
      }

      case "reconcile": {
        const { streamer_login, source_id, source_type: srcType } = params;
        
        // Get all detections for this source
        let query = supabase.from("detections").select("*").eq("streamer_login", streamer_login);
        if (source_id) query = query.eq("source_id", source_id);
        if (srcType) query = query.eq("source_type", srcType);
        const { data: dets } = await query.order("offset_seconds", { ascending: true });

        if (!dets || dets.length === 0) {
          return json({ blocks: 0, message: "No detections to reconcile" });
        }

        // Group consecutive detections into blocks
        const GAP_THRESHOLD = 300; // 5 minutes
        const MIN_CONFIDENCE = 30;
        const filtered = dets.filter((d: any) => (d.confidence || 0) >= MIN_CONFIDENCE);
        
        const blocks: any[] = [];
        let current: any = null;

        for (const det of filtered) {
          if (!current) {
            current = {
              provider_id: det.provider_id,
              game_id: det.game_id,
              start_offset: det.offset_seconds,
              end_offset: det.offset_seconds + (det.exposure_seconds || 120),
              viewers: [det.viewer_count || 0],
              confidences: [det.confidence || 0],
            };
            continue;
          }

          const gap = det.offset_seconds - current.end_offset;
          const sameProvider = det.provider_id === current.provider_id;
          const sameGame = det.game_id === current.game_id;

          if (sameProvider && sameGame && gap <= GAP_THRESHOLD) {
            current.end_offset = det.offset_seconds + (det.exposure_seconds || 120);
            current.viewers.push(det.viewer_count || 0);
            current.confidences.push(det.confidence || 0);
          } else {
            blocks.push(current);
            current = {
              provider_id: det.provider_id,
              game_id: det.game_id,
              start_offset: det.offset_seconds,
              end_offset: det.offset_seconds + (det.exposure_seconds || 120),
              viewers: [det.viewer_count || 0],
              confidences: [det.confidence || 0],
            };
          }
        }
        if (current) blocks.push(current);

        // Save exposure blocks
        const baseTime = new Date(dets[0].detected_at);
        const exposureRows = blocks.map((b: any) => {
          const avgV = Math.round(b.viewers.reduce((s: number, v: number) => s + v, 0) / b.viewers.length);
          const peakV = Math.max(...b.viewers);
          const duration = b.end_offset - b.start_offset;
          const avgConf = b.confidences.reduce((s: number, c: number) => s + c, 0) / b.confidences.length;
          
          return {
            streamer_login,
            platform: "twitch",
            source_type: srcType || "vod",
            source_id,
            provider_id: b.provider_id,
            game_id: b.game_id,
            start_at: new Date(baseTime.getTime() + b.start_offset * 1000).toISOString(),
            end_at: new Date(baseTime.getTime() + b.end_offset * 1000).toISOString(),
            duration_seconds: duration,
            avg_viewers: avgV,
            peak_viewers: peakV,
            viewer_minutes: Math.round(avgV * duration / 60),
            confidence_avg: Math.round(avgConf * 100) / 100,
            is_reconciled: true,
          };
        });

        if (exposureRows.length > 0) {
          const { error } = await supabase.from("exposure_blocks").insert(exposureRows);
          if (error) throw error;
        }

        // Update VOD audit if applicable
        if (source_id) {
          const totalProcessed = filtered.length;
          const totalDuration = exposureRows.reduce((s, b) => s + b.duration_seconds, 0);
          
          await supabase.from("vod_audits").update({
            status: "completed",
            processed_frames: totalProcessed,
            processed_duration_seconds: totalDuration,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("vod_id", source_id);
        }

        return json({ blocks: exposureRows.length, total_exposure: exposureRows.reduce((s, b) => s + b.duration_seconds, 0) });
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
        (msgs || []).forEach((m: any) => {
          if (m.sentiment_label) sentiments[m.sentiment_label as keyof typeof sentiments]++;
          if (m.intent_label) intents[m.intent_label] = (intents[m.intent_label] || 0) + 1;
        });

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
