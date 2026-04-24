import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { Loader2, Play, ScanSearch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { saveRawEvidences, runPipeline } from "@/lib/scanner-api";
import { toast } from "sonner";

interface ScanStartProps {
  onComplete?: () => void;
}

/** Parse Twitch duration like "3h12m45s" to seconds */
function parseDurationToSeconds(duration: string): number {
  if (!duration) return 3600;
  let h = 0, m = 0, s = 0;
  const mh = duration.match(/(\d+)h/);
  const mm = duration.match(/(\d+)m/);
  const ms = duration.match(/(\d+)s/);
  if (mh) h = parseInt(mh[1]);
  if (mm) m = parseInt(mm[1]);
  if (ms) s = parseInt(ms[1]);
  return h * 3600 + m * 60 + s;
}

/**
 * Extract individual frame URLs from storyboard data.
 * Each storyboard strip contains (cols * rows) frames.
 * We sample one frame every ~60s by picking the right strip URL + computing the timestamp.
 */
function buildFrameSamples(
  storyboardUrls: string[],
  interval: number,
  cols: number,
  rows: number,
  totalCount: number,
  vodDurationSec: number
): { urls: string[]; timestamps: number[] } {
  const framesPerStrip = cols * rows;
  const totalFrames = Math.min(totalCount || storyboardUrls.length * framesPerStrip, storyboardUrls.length * framesPerStrip);

  // Each frame covers `interval` seconds
  // We want ~1 sample per 60s of VOD
  const sampleEvery = Math.max(1, Math.round(60 / interval));

  const urls: string[] = [];
  const timestamps: number[] = [];
  const seenUrls = new Set<string>();

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx += sampleEvery) {
    const stripIdx = Math.floor(frameIdx / framesPerStrip);
    if (stripIdx >= storyboardUrls.length) break;

    const url = storyboardUrls[stripIdx];
    const ts = frameIdx * interval;

    // Avoid sending same strip URL multiple times in the same batch
    // Each strip is a sprite sheet - the AI will analyze all frames in it
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    urls.push(url);
    timestamps.push(ts);
  }

  // Cap at 40 unique strips to avoid overwhelming the AI
  return {
    urls: urls.slice(0, 40),
    timestamps: timestamps.slice(0, 40),
  };
}

export function ScanStartPanel({ onComplete }: ScanStartProps) {
  const { t } = useLanguage();
  const [streamerLogin, setStreamerLogin] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [vodCount, setVodCount] = useState(5);

  const startScan = async () => {
    const login = streamerLogin.trim().toLowerCase();
    if (!login) {
      toast.error(t("scan.enter_streamer"));
      return;
    }

    setScanning(true);
    setProgress(t("scan.searching_streamer"));

    try {
      // Step 1: Get user info
      const { data: userData, error: userError } = await supabase.functions.invoke("twitch-api", {
        body: { action: "get_user", login },
      });
      if (userError || !userData?.data?.[0]) throw new Error(t("scan.streamer_not_found"));
      const user = userData.data[0];
      const userId = user.id;

      // Step 2: Get VODs
      setProgress(`Buscando ${vodCount} VODs...`);
      const { data: vodData, error: vodError } = await supabase.functions.invoke("twitch-api", {
        body: { action: "get_vods", user_id: userId, vod_count: vodCount },
      });
      if (vodError || !vodData?.data?.length) throw new Error(t("scan.no_vods_found"));

      const vods = vodData.data.slice(0, vodCount);
      toast.info(`${vods.length} VODs encontradas. Iniciando análise...`);

      // Step 3: Process each VOD
      for (let v = 0; v < vods.length; v++) {
        const vod = vods[v];
        const vodId = vod.id;
        const durationSec = parseDurationToSeconds(vod.duration || "");

        setProgress(`VOD ${v + 1}/${vods.length}: Obtendo storyboard...`);

        // Get storyboard
        const { data: sbData } = await supabase.functions.invoke("twitch-api", {
          body: { action: "get_storyboard_urls", vod_id: vodId },
        });

        if (!sbData?.storyboardUrls?.length) {
          setProgress(`VOD ${v + 1}/${vods.length}: Sem storyboard, pulando...`);
          continue;
        }

        // Build unique frame samples from storyboard
        const { urls: sampledUrls, timestamps: sampledTs } = buildFrameSamples(
          sbData.storyboardUrls,
          sbData.interval || 19,
          sbData.cols || 5,
          sbData.rows || 10,
          sbData.count || 0,
          durationSec
        );

        if (sampledUrls.length === 0) {
          setProgress(`VOD ${v + 1}/${vods.length}: Storyboard vazio, pulando...`);
          continue;
        }

        setProgress(`VOD ${v + 1}/${vods.length}: Analisando ${sampledUrls.length} strips com IA...`);

        // Call AI analysis
        const { data: aiData, error: aiError } = await supabase.functions.invoke("twitch-api", {
          body: {
            action: "analyze_vod_frames",
            thumbnail_urls: sampledUrls,
            timestamps: sampledTs,
            vod_title: vod.title,
          },
        });

        if (aiError || !aiData) {
          console.error("AI analysis error:", aiError);
          continue;
        }

        console.log(`[ScanStart] VOD ${vodId}: AI returned ${aiData.games?.length || 0} games, ${aiData.gameTimeline?.length || 0} timeline segments`);

        // Save raw evidences - filter out not_game entries
        const timeline = (aiData.gameTimeline || []).filter((seg: any) => seg.category !== "not_game");
        const games = (aiData.games || []).filter((g: any) => g.category !== "not_game");

        if (timeline.length > 0 || games.length > 0) {
          const evidences: any[] = [];

          for (const seg of timeline) {
            evidences.push({
              vod_id: vodId,
              streamer_login: login,
              platform: "twitch",
              source_type: "vod",
              source_id: vodId,
              timestamp_seconds: seg.startSeconds || 0,
              game: seg.game,
              provider: seg.provider,
              confidence: seg.category === "not_game" ? 0.3 : 0.85,
            });
          }

          for (const g of games) {
            evidences.push({
              vod_id: vodId,
              streamer_login: login,
              platform: "twitch",
              source_type: "vod",
              source_id: vodId,
              timestamp_seconds: g.timestampSeconds || 0,
              game: g.game,
              provider: g.provider,
              confidence: g.confidence === "high" ? 0.95 : g.confidence === "medium" ? 0.75 : 0.5,
            });
          }

          if (evidences.length > 0) {
            setProgress(`VOD ${v + 1}/${vods.length}: Salvando ${evidences.length} evidências...`);
            await saveRawEvidences(evidences, `scan_${Date.now()}`);
          }
        } else {
          console.log(`[ScanStart] VOD ${vodId}: No casino games detected (all filtered as not_game)`);
        }

        // Run pipeline (validate → consolidate → metrics)
        setProgress(`VOD ${v + 1}/${vods.length}: Executando pipeline...`);
        await runPipeline(vodId, login, durationSec);

        setProgress(`VOD ${v + 1}/${vods.length}: ✅ Concluída`);
      }

      toast.success(`Scan completo! ${vods.length} VODs processadas para ${login}`);
      setProgress("✅ Scan completo!");
      onComplete?.();
    } catch (err: any) {
      console.error("Scan error:", err);
      toast.error(err.message || t("scan.scan_error"));
      setProgress("❌ Erro: " + (err.message || "desconhecido"));
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card className="p-4 border-primary/20 bg-primary/5">
      <div className="flex items-center gap-2 mb-3">
        <ScanSearch className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{t("scan.start_scan")}</h3>
      </div>
      <div className="flex items-center gap-2">
        <Input
          placeholder={t("scan.streamer_placeholder")}
          value={streamerLogin}
          onChange={e => setStreamerLogin(e.target.value)}
          disabled={scanning}
          className="flex-1 h-9 text-sm"
          onKeyDown={e => e.key === "Enter" && !scanning && startScan()}
        />
        <Input
          type="number"
          min={1}
          max={20}
          value={vodCount}
          onChange={e => setVodCount(Number(e.target.value))}
          disabled={scanning}
          className="w-20 h-9 text-sm"
          title={t("scan.vod_count_label")}
        />
        <Button onClick={startScan} disabled={scanning} size="sm" className="h-9 px-4">
          {scanning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          {scanning ? t("scan.scanning") : t("scan.start_btn")}
        </Button>
      </div>
      {progress && (
        <p className="text-xs text-muted-foreground mt-2 font-mono">{progress}</p>
      )}
    </Card>
  );
}
