import { useState, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtInt } from "@/lib/formatters";
import { toast } from "sonner";
import {
  addStreamer, removeStreamer, listStreamers, pollNow, getReach, getTimeline,
  type MonitoredStreamer, type GameReach, type TimelinePoint,
} from "@/lib/stream-monitor-api";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function ReachTable({ reach }: { reach: GameReach[] }) {
  const maxImpressions = Math.max(...reach.map(r => r.totalViewerMinutes), 1);
  return (
    <div className="card-surface overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">Jogo / Categoria</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Avg Viewers</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Peak</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Airtime</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Viewer-Minutes</th>
            <th className="p-3 w-32">Reach</th>
          </tr>
        </thead>
        <tbody>
          {reach.map((r) => (
            <tr key={r.game} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
              <td className="p-3 text-sm font-medium text-foreground">{r.game}</td>
              <td className="p-3 text-right font-mono text-sm">{fmtInt(r.avgViewers)}</td>
              <td className="p-3 text-right font-mono text-sm">{fmtInt(r.peakViewers)}</td>
              <td className="p-3 text-right font-mono text-sm text-muted-foreground">{formatMinutes(r.totalMinutes)}</td>
              <td className="p-3 text-right font-mono text-sm text-accent">{fmtInt(r.totalViewerMinutes)}</td>
              <td className="p-3">
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${(r.totalViewerMinutes / maxImpressions) * 100}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewerTimeline({ timeline }: { timeline: TimelinePoint[] }) {
  if (timeline.length === 0) return null;
  const maxViewers = Math.max(...timeline.map(t => t.viewer_count), 1);
  const barWidth = Math.max(2, Math.min(8, Math.floor(600 / timeline.length)));

  // Group by game for color coding
  const games = [...new Set(timeline.map(t => t.game_name || 'Offline'))];
  const colors = ['bg-primary', 'bg-accent', 'bg-warning', 'bg-destructive', 'bg-secondary-foreground'];

  return (
    <div className="card-surface p-4 space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Timeline de Viewers</h3>
      <div className="flex items-end gap-px h-32 overflow-x-auto">
        {timeline.map((point, i) => {
          const height = point.is_live ? Math.max(2, (point.viewer_count / maxViewers) * 100) : 0;
          const gameIdx = games.indexOf(point.game_name || 'Offline');
          const color = point.is_live ? (colors[gameIdx % colors.length]) : 'bg-muted';
          return (
            <div
              key={i}
              className={`${color} rounded-t-sm transition-all shrink-0 group relative`}
              style={{ width: barWidth, height: `${height}%` }}
              title={`${new Date(point.captured_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — ${point.is_live ? `${fmtInt(point.viewer_count)} viewers · ${point.game_name}` : 'Offline'}`}
            />
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {games.filter(g => g !== 'Offline').map((game, i) => (
          <div key={game} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className={`w-2.5 h-2.5 rounded-sm ${colors[i % colors.length]}`} />
            <span>{game}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonitorTab() {
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
      toast.success(`${newLogin} adicionado ao monitoramento!`);
      setNewLogin("");
      await fetchStreamers();
    } catch (err: any) {
      toast.error("Erro ao adicionar", { description: err.message });
    }
    setLoading(false);
  };

  const handleRemove = async (login: string) => {
    try {
      await removeStreamer(login);
      toast.success(`${login} removido`);
      await fetchStreamers();
    } catch (err: any) {
      toast.error("Erro", { description: err.message });
    }
  };

  const handlePoll = async () => {
    setPollLoading(true);
    try {
      const result = await pollNow();
      toast.success(`Coletados ${result.snapshots} snapshots (${result.live} live)`);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card-surface p-4">
        <p className="text-xs text-primary font-medium uppercase tracking-wider">Monitor de Reach em Tempo Real</p>
        <p className="text-sm text-muted-foreground mt-1">
          Adicione streamers para monitorar. O sistema coleta viewers + jogo/categoria a cada 2 minutos, calculando o <strong>reach real</strong> (viewer-minutes) por jogo e provedor.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Manage streamers */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Streamers Monitorados</h2>
            <Button variant="outline" size="sm" onClick={handlePoll} disabled={pollLoading}>
              {pollLoading ? "Coletando..." : "📡 Coletar agora"}
            </Button>
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="username da Twitch"
              value={newLogin}
              onChange={(e) => setNewLogin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="font-mono"
            />
            <Button onClick={handleAdd} disabled={loading} size="sm" className="shrink-0">
              {loading ? "..." : "+ Adicionar"}
            </Button>
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
