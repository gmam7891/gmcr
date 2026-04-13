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

export function ScanStartPanel({ onComplete }: ScanStartProps) {
  const { t } = useLanguage();
  const [streamerLogin, setStreamerLogin] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [vodCount, setVodCount] = useState(5);

  const startScan = async () => {
    const login = streamerLogin.trim().toLowerCase();
    if (!login) {
      toast.error("Digite o nome do streamer");
      return;
    }

    setScanning(true);
    setProgress("Buscando streamer...");

    try {
      // Step 1: Get user info
      const { data: userData, error: userError } = await supabase.functions.invoke("twitch-api", {
        body: { action: "get_user", login },
      });
      if (userError || !userData?.data?.[0]) throw new Error("Streamer não encontrado");
      const user = userData.data[0];
      const userId = user.id;

      // Step 2: Get VODs
      setProgress(`Buscando ${vodCount} VODs...`);
      const { data: vodData, error: vodError } = await supabase.functions.invoke("twitch-api", {
        body: { action: "get_vods", user_id: userId, vod_count: vodCount },
      });
      if (vodError || !vodData?.data?.length) throw new Error("Nenhuma VOD encontrada");

      const vods = vodData.data.slice(0, vodCount);
      toast.info(`${vods.length} VODs encontradas. Iniciando análise...`);

      // Step 3: Process each VOD
      for (let v = 0; v < vods.length; v++) {
        const vod = vods[v];
        const vodId = vod.id;
        const durationMatch = vod.duration?.match(/(\d+)h(\d+)m(\d+)s/);
        const durationSec = durationMatch
          ? parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3])
          : 3600;

        setProgress(`VOD ${v + 1}/${vods.length}: Obtendo storyboard...`);

        // Get storyboard
        const { data: sbData } = await supabase.functions.invoke("twitch-api", {
          body: { action: "get_storyboard_urls", vod_id: vodId },
        });

        if (!sbData?.storyboardUrls?.length) {
          setProgress(`VOD ${v + 1}/${vods.length}: Sem storyboard, pulando...`);
          continue;
        }

        // Build thumbnail URLs from storyboard
        const interval = sbData.interval || 60;
        const framesPerStrip = sbData.framesPerStrip || 1;
        const totalFrames = sbData.storyboardUrls.length * framesPerStrip;
        
        // Sample every 60s (one frame per minute)
        const sampleRate = Math.max(1, Math.round(60 / (interval || 60)));
        const thumbnailUrls: string[] = [];
        const timestamps: number[] = [];

        for (let i = 0; i < totalFrames; i += sampleRate) {
          const stripIdx = Math.floor(i / framesPerStrip);
          if (stripIdx < sbData.storyboardUrls.length) {
            thumbnailUrls.push(sbData.storyboardUrls[stripIdx]);
            timestamps.push(i * (interval || 60));
          }
        }

        // Limit to reasonable amount
        const maxFrames = Math.min(thumbnailUrls.length, 60);
        const sampledUrls = thumbnailUrls.slice(0, maxFrames);
        const sampledTs = timestamps.slice(0, maxFrames);

        setProgress(`VOD ${v + 1}/${vods.length}: Analisando ${sampledUrls.length} frames com IA...`);

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

        // Save raw evidences
        if (aiData.games?.length > 0 || aiData.gameTimeline?.length > 0) {
          const evidences = (aiData.gameTimeline || []).map((seg: any) => ({
            vod_id: vodId,
            streamer_login: login,
            platform: "twitch",
            source_type: "vod",
            source_id: vodId,
            timestamp_seconds: seg.startSeconds || 0,
            game: seg.game,
            provider: seg.provider,
            confidence: seg.category === "not_casino" ? 0.3 : 0.85,
          }));

          // Also add individual game detections
          for (const g of (aiData.games || [])) {
            evidences.push({
              vod_id: vodId,
              streamer_login: login,
              platform: "twitch",
              source_type: "vod",
              source_id: vodId,
              timestamp_seconds: g.timestampSeconds || 0,
              game: g.game,
              provider: g.provider,
              confidence: g.confidence === "high" ? 0.95 : g.confidence === "medium" ? 0.75 : 0.4,
            });
          }

          if (evidences.length > 0) {
            setProgress(`VOD ${v + 1}/${vods.length}: Salvando ${evidences.length} evidências...`);
            await saveRawEvidences(evidences, `scan_${Date.now()}`);
          }
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
      toast.error(err.message || "Erro durante o scan");
      setProgress("❌ Erro: " + (err.message || "desconhecido"));
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card className="p-4 border-primary/20 bg-primary/5">
      <div className="flex items-center gap-2 mb-3">
        <ScanSearch className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Iniciar Scan de VODs</h3>
      </div>
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nome do streamer (ex: gaules)"
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
          title="Número de VODs"
        />
        <Button onClick={startScan} disabled={scanning} size="sm" className="h-9 px-4">
          {scanning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          {scanning ? "Escaneando..." : "Iniciar"}
        </Button>
      </div>
      {progress && (
        <p className="text-xs text-muted-foreground mt-2 font-mono">{progress}</p>
      )}
    </Card>
  );
}
