import { useState, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtInt } from "@/lib/formatters";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  addStreamer, removeStreamer, listStreamers, pollNow, getReach, getTimeline,
  type MonitoredStreamer, type GameReach, type TimelinePoint,
} from "@/lib/stream-monitor-api";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ReachTable } from "@/components/monitor/ReachTable";
import { ViewerTimeline } from "@/components/monitor/ViewerTimeline";
import * as XLSX from "xlsx";

export function MonitorTab() {
  const { t } = useLanguage();
  const [streamers, setStreamers] = useState<MonitoredStreamer[]>([]);
  const [newLogin, setNewLogin] = useState("");
  const [loading, setLoading] = useState(false);
  const [pollLoading, setPollLoading] = useState(false);

  // Reach data
  const [selectedStreamer, setSelectedStreamer] = useState<string>("all");
  const [reachDays, setReachDays] = useState(30);
  const [reach, setReach] = useState<GameReach[]>([]);
  const [reachLoading, setReachLoading] = useState(false);
  const [totalSnapshots, setTotalSnapshots] = useState(0);

  // Timeline
  const [timelineLogin, setTimelineLogin] = useState<string>("");
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const fetchStreamers = useCallback(async () => {
    try {
      const list = await listStreamers();
      setStreamers(list);
    } catch (err: any) {
      console.error('List streamers error:', err);
    }
  }, []);

  useEffect(() => { fetchStreamers(); }, [fetchStreamers]);

  const handleAdd = async () => {
    if (!newLogin.trim()) return;
    setLoading(true);
    try {
      await addStreamer(newLogin.trim());
      toast.success(`${newLogin} ${t("mon.added")}`);
      setNewLogin("");
      await fetchStreamers();
    } catch (err: any) {
      toast.error(t("mon.error_add"), { description: err.message });
    }
    setLoading(false);
  };

  const handleRemove = async (login: string) => {
    try {
      await removeStreamer(login);
      toast.success(`${login} ${t("mon.removed")}`);
      await fetchStreamers();
    } catch (err: any) {
      toast.error("Erro", { description: err.message });
    }
  };

  const handlePoll = async () => {
    setPollLoading(true);
    try {
      const result = await pollNow();
      toast.success(`${t("mon.collected")} ${result.snapshots} ${t("mon.snapshots_collected")} (${result.live} ${t("mon.live")})`);
    } catch (err: any) {
      toast.error("Erro no polling", { description: err.message });
    }
    setPollLoading(false);
  };

  const fetchReach = async () => {
    setReachLoading(true);
    try {
      const login = selectedStreamer === "all" ? undefined : selectedStreamer;
      const result = await getReach(login, reachDays);
      setReach(result.reach);
      setTotalSnapshots(result.totalSnapshots);
    } catch (err: any) {
      toast.error("Erro ao carregar reach", { description: err.message });
    }
    setReachLoading(false);
  };

  const fetchTimeline = async (login: string) => {
    setTimelineLogin(login);
    setTimelineLoading(true);
    try {
      const data = await getTimeline(login, 48);
      setTimeline(data);
    } catch (err: any) {
      toast.error("Erro timeline", { description: err.message });
    }
    setTimelineLoading(false);
  };

  const totalReachImpressions = reach.reduce((s, r) => s + r.totalViewerMinutes, 0);
  const topGame = reach.length > 0 ? reach[0] : null;

  const downloadExcel = () => {
    const rows: any[][] = [
      ["Monitor de Reach - Relatório"],
      [""],
      ["Streamers monitorados", streamers.length],
      ["Período", `${reachDays} dias`],
      ["Total Viewer-Minutes", totalReachImpressions],
      ["Total Snapshots", totalSnapshots],
      ["Top Jogo", topGame?.game || "-"],
      [""],
      ["--- Reach por Jogo ---"],
      ["Jogo", "Avg Viewers", "Peak", "Airtime (min)", "Viewer-Minutes"],
      ...reach.map(r => [r.game, r.avgViewers, r.peakViewers, r.totalMinutes, r.totalViewerMinutes]),
      [""],
      ["--- Streamers ---"],
      ["Login", "Display Name"],
      ...streamers.map(s => [s.login, s.display_name || s.login]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Monitor");
    XLSX.writeFile(wb, "monitor-reach-report.xlsx");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card-surface p-4 flex items-start justify-between">
        <div>
          <p className="text-xs text-primary font-medium uppercase tracking-wider">{t("mon.realtime_title")}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {t("mon.description")}
          </p>
        </div>
        {reach.length > 0 && (
          <Button variant="outline" size="sm" onClick={downloadExcel} className="shrink-0">
            {t("app.export_excel")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Manage streamers */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t("mon.monitored")}</h2>
            <Button variant="outline" size="sm" onClick={handlePoll} disabled={pollLoading}>
              {pollLoading ? t("mon.collecting") : t("mon.collect_now")}
            </Button>
          </div>

          <div className="flex gap-2">
            <Input placeholder={t("mon.twitch_username")} value={newLogin} onChange={(e) => setNewLogin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} className="font-mono" />
            <Button onClick={handleAdd} disabled={loading} size="sm" className="shrink-0">
              {loading ? "..." : t("mon.add")}
            </Button>
          </div>
          </div>

          {streamers.length > 0 ? (
            <div className="space-y-2">
              {streamers.map((s) => (
                <div key={s.login} className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/50 border border-border">
                  {s.avatar_url && (
                    <img src={s.avatar_url} alt={s.display_name || s.login} className="w-8 h-8 rounded-full" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.display_name || s.login}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{s.login}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => fetchTimeline(s.login)}
                    >
                      📊
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive"
                      onClick={() => handleRemove(s.login)}
                    >
                      ✕
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-surface p-6 text-center text-sm text-muted-foreground">
              Nenhum streamer monitorado. Adicione um acima.
            </div>
          )}
        </div>

        {/* Right: Reach analytics */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Reach por Jogo</h2>
            <Select value={selectedStreamer} onValueChange={setSelectedStreamer}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {streamers.map(s => (
                  <SelectItem key={s.login} value={s.login}>{s.display_name || s.login}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(reachDays)} onValueChange={(v) => setReachDays(Number(v))}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 dias</SelectItem>
                <SelectItem value="14">14 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={fetchReach} disabled={reachLoading}>
              {reachLoading ? "Carregando..." : "Carregar Reach"}
            </Button>
          </div>

          {reach.length > 0 && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Total Viewer-Min" value={fmtInt(totalReachImpressions)} />
                <MetricCard label="Snapshots coletados" value={fmtInt(totalSnapshots)} />
                <MetricCard label="Top Jogo" value={topGame?.game || "-"} />
                <MetricCard label="Top Avg Viewers" value={topGame ? fmtInt(topGame.avgViewers) : "-"} />
              </div>

              <ReachTable reach={reach} />
            </>
          )}

          {reach.length === 0 && !reachLoading && (
            <div className="card-surface p-8 text-center text-sm text-muted-foreground">
              Adicione streamers, colete dados com "📡 Coletar agora" e depois clique "Carregar Reach" para ver os resultados.
            </div>
          )}

          {/* Timeline */}
          {timelineLogin && (
            <div className="space-y-2">
              <h3 className="text-xs text-muted-foreground uppercase tracking-wider">
                Timeline: {timelineLogin} (últimas 48h)
                {timelineLoading && " — carregando..."}
              </h3>
              <ViewerTimeline timeline={timeline} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
