import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { getQualityMetrics, getPipelineConfig, updatePipelineConfig } from "@/lib/scanner-api";
import { MetricCard } from "@/components/MetricCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

export function QualityTab() {
  const { t } = useLanguage();
  const { isAdmin } = useAuth();
  const [quality, setQuality] = useState<any>(null);
  const [configs, setConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([getQualityMetrics(), getPipelineConfig()])
      .then(([q, c]) => {
        setQuality(q);
        setConfigs(c.configs || []);
        const vals: Record<string, string> = {};
        (c.configs || []).forEach((cfg: any) => {
          vals[cfg.config_key] = String(cfg.config_value);
        });
        setEditValues(vals);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const saveConfig = async (key: string) => {
    try {
      await updatePipelineConfig(key, Number(editValues[key]));
      toast.success(t("scan.config_saved"));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">{t("app.loading")}</p>;

  const COLORS = ["hsl(var(--chart-2))", "hsl(var(--chart-4))", "hsl(var(--destructive))"];
  const blockDistribution = quality ? [
    { name: t("scan.confirmed"), value: quality.confirmed_blocks || 0 },
    { name: t("scan.suspect_label"), value: quality.suspect_blocks || 0 },
    { name: t("scan.discarded_label"), value: quality.discarded_blocks || 0 },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="space-y-6">
      {/* Quality KPIs */}
      {quality && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label={t("scan.false_positive_rate")} value={`${(quality.false_positive_rate || 0).toFixed(1)}%`} status={quality.false_positive_rate > 20 ? "nogo" : quality.false_positive_rate > 10 ? "test" : "go"} />
          <MetricCard label={t("scan.suspect_rate")} value={`${(quality.suspect_rate || 0).toFixed(1)}%`} status={quality.suspect_rate > 30 ? "nogo" : quality.suspect_rate > 15 ? "test" : "go"} />
          <MetricCard label={t("scan.avg_coverage_quality")} value={`${Math.round(quality.avg_coverage || 0)}%`} status={(quality.avg_coverage || 0) < 70 ? "nogo" : (quality.avg_coverage || 0) < 90 ? "test" : "go"} />
          <MetricCard label={t("scan.failed_vods")} value={quality.failed_vods || 0} status={(quality.failed_vods || 0) > 5 ? "nogo" : (quality.failed_vods || 0) > 0 ? "test" : "go"} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Block Distribution */}
        {blockDistribution.length > 0 && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">{t("scan.block_distribution")}</h3>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={blockDistribution} dataKey="value" innerRadius={35} outerRadius={55} paddingAngle={2}>
                    {blockDistribution.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {blockDistribution.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                    <span>{d.name}: {d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Additional quality stats */}
        {quality && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">{t("scan.quality_summary")}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("scan.total_blocks")}</span>
                <span className="font-mono">{quality.total_blocks || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("scan.total_vods_analyzed")}</span>
                <span className="font-mono">{quality.total_vods_analyzed || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("scan.avg_confidence_quality")}</span>
                <span className="font-mono">{Math.round(quality.avg_confidence || 0)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("scan.low_conf_vods")}</span>
                <span className="font-mono">{quality.low_confidence_vods || 0}</span>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Pipeline Configuration (admin only) */}
      {isAdmin && configs.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">{t("scan.pipeline_config")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {configs.map((cfg: any) => (
              <div key={cfg.config_key} className="flex items-center gap-2">
                <div className="flex-1">
                  <p className="text-xs font-medium">{cfg.config_key.replace(/_/g, " ")}</p>
                  <p className="text-[10px] text-muted-foreground">{cfg.description}</p>
                </div>
                <Input
                  type="number"
                  value={editValues[cfg.config_key] || ""}
                  onChange={(e) => setEditValues(prev => ({ ...prev, [cfg.config_key]: e.target.value }))}
                  className="w-20 h-8 text-xs font-mono"
                />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => saveConfig(cfg.config_key)}>
                  {t("scan.save")}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
