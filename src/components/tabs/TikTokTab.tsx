import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtInt } from "@/lib/formatters";
import { useLanguage } from "@/contexts/LanguageContext";
import { PlatformCampaignSection } from "@/components/platform/PlatformCampaignSection";
import * as XLSX from "xlsx";

/**
 * TikTok analytics tab — mirrors the shape of Twitch/YouTube/Kick.
 *
 * Public audience data on TikTok is limited without an official API connection.
 * The user provides handle + audience numbers manually; the shared
 * `PlatformCampaignSection` then handles the per-stage calculator with the same
 * field map (iGaming/Awareness/Consideração/Conversão/Retenção) used by the
 * other platforms.
 */
export function TikTokTab() {
  const { t } = useLanguage();
  const [handle, setHandle] = useState("");
  const [followers, setFollowers] = useState(0);
  const [avgVideoViews, setAvgVideoViews] = useState(0);
  const [videosInPackage, setVideosInPackage] = useState(1);

  const platformReach = useMemo(
    () => Math.max(avgVideoViews, 0) * Math.max(videosInPackage, 0),
    [avgVideoViews, videosInPackage],
  );

  const downloadExcel = () => {
    const data = [
      ["TikTok - Relatório"],
      [""],
      ["Handle", handle || "-"],
      ["Seguidores", followers],
      ["Views médias por vídeo", avgVideoViews],
      ["Vídeos no pacote", videosInPackage],
      ["Alcance total (base)", platformReach],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TikTok");
    XLSX.writeFile(wb, `analise-tiktok-${handle || 'perfil'}.xlsx`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <FieldSection title="Perfil TikTok">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground uppercase tracking-wider">Handle</label>
            <Input
              placeholder="@username"
              value={handle}
              onChange={(e) => setHandle(e.target.value.trim())}
              className="font-mono"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Informe os números públicos do perfil (seguidores e média de views) que servirão como base de público.
          </p>
        </FieldSection>

        <FieldSection title="Base de audiência">
          <NumberField label="Seguidores" value={followers} onChange={setFollowers} step={1000} />
          <NumberField label="Views médias por vídeo" value={avgVideoViews} onChange={setAvgVideoViews} step={1000} />
          <NumberField label="Vídeos incluídos no pacote" value={videosInPackage} onChange={setVideosInPackage} step={1} />
        </FieldSection>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t("app.results")}</h2>
          <Button variant="outline" size="sm" onClick={downloadExcel}>{t("app.export_excel")}</Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Seguidores" value={fmtInt(followers)} />
          <MetricCard label="Views médias" value={fmtInt(avgVideoViews)} />
          <MetricCard label="Alcance total (base)" value={fmtInt(platformReach)} />
        </div>

        <div className="border-t border-border pt-6 mt-6">
          <PlatformCampaignSection platformReach={platformReach} platformLabel="TikTok" />
        </div>
      </div>
    </div>
  );
}
