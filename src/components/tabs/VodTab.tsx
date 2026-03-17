import { useState } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUser, getVod, getVods, formatDuration, parseDuration, type TwitchVod } from "@/lib/twitch-api";
import { fmtInt } from "@/lib/formatters";

export function VodTab() {
  const [vodUrl, setVodUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [vods, setVods] = useState<TwitchVod[]>([]);
  const [singleVod, setSingleVod] = useState<TwitchVod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "channel" | null>(null);

  const analyze = async () => {
    if (!vodUrl.trim()) return;
    setLoading(true);
    setError(null);
    setVods([]);
    setSingleVod(null);
    setMode(null);

    try {
      const input = vodUrl.trim();

      // Check if it's a VOD URL/ID
      const vodMatch = input.match(/videos\/(\d+)/);
      const isVodId = /^\d+$/.test(input);

      if (vodMatch || isVodId) {
        const vodId = vodMatch ? vodMatch[1] : input;
        const vod = await getVod(vodId);
        if (!vod) throw new Error("VOD não encontrada");
        setSingleVod(vod);
        setMode("single");

        // Also fetch other VODs from same user
        const channelVods = await getVods(vod.user_id, 20);
        setVods(channelVods);
      } else {
        // It's a channel name
        const login = input.replace(/https?:\/\/(www\.)?twitch\.tv\//, "").replace(/\//g, "").toLowerCase();
        const user = await getUser(login);
        if (!user) throw new Error("Canal não encontrado");
        const channelVods = await getVods(user.id, 20);
        setVods(channelVods);
        setMode("channel");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    }
    setLoading(false);
  };

  const totalViews = vods.reduce((s, v) => s + v.view_count, 0);
  const totalHours = vods.reduce((s, v) => s + parseDuration(v.duration) / 60, 0);
  const avgViewsPerHour = totalHours > 0 ? totalViews / totalHours : 0;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="card-surface p-4 space-y-1">
        <p className="text-xs text-primary font-medium uppercase tracking-wider">Análise por Metadados v2</p>
        <p className="text-sm text-muted-foreground">
          Cole uma URL de VOD para análise individual, ou nome do canal para ver todas as VODs. Dados via API Twitch — instantâneo.
        </p>
      </div>

      <div className="flex gap-3">
        <Input
          value={vodUrl}
          onChange={(e) => setVodUrl(e.target.value)}
          placeholder="https://twitch.tv/videos/123456 ou nome_do_canal"
          className="font-mono bg-secondary border-border"
          onKeyDown={(e) => e.key === 'Enter' && analyze()}
        />
        <Button onClick={analyze} disabled={loading || !vodUrl.trim()}>
          {loading ? "Analisando..." : "Analisar"}
        </Button>
      </div>

      {loading && (
        <div className="card-surface p-6 text-center">
          <div className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground mt-2">Buscando dados da API Twitch...</p>
        </div>
      )}

      {error && (
        <div className="card-surface border-destructive/30 p-4 text-sm text-destructive">{error}</div>
      )}

      {singleVod && mode === "single" && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">VOD Selecionada</h3>
          <div className="grid grid-cols-4 gap-3">
            <MetricCard label="Título" value={singleVod.title.slice(0, 40) + (singleVod.title.length > 40 ? "..." : "")} />
            <MetricCard label="Duração" value={formatDuration(singleVod.duration)} />
            <MetricCard label="Views" value={fmtInt(singleVod.view_count)} />
            <MetricCard label="Views/hora" value={fmtInt(parseDuration(singleVod.duration) > 0 ? singleVod.view_count / (parseDuration(singleVod.duration) / 60) : 0)} />
          </div>
        </div>
      )}

      {vods.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            {mode === "single" ? "Outras VODs do canal" : "VODs do canal"} ({vods.length})
          </h3>

          <div className="grid grid-cols-4 gap-3">
            <MetricCard label="Total VODs" value={fmtInt(vods.length)} />
            <MetricCard label="Total views" value={fmtInt(totalViews)} />
            <MetricCard label="Total horas" value={`${totalHours.toFixed(1)}h`} />
            <MetricCard label="Avg views/hora" value={fmtInt(avgViewsPerHour)} status={avgViewsPerHour > 100 ? "go" : undefined} />
          </div>

          <div className="card-surface overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">Título</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Duração</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Views</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Views/h</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Data</th>
                </tr>
              </thead>
              <tbody>
                {vods.map((vod) => {
                  const mins = parseDuration(vod.duration);
                  const hours = mins / 60;
                  const vph = hours > 0 ? vod.view_count / hours : 0;
                  return (
                    <tr key={vod.id} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                      <td className="p-3 text-sm max-w-[300px] truncate" title={vod.title}>{vod.title}</td>
                      <td className="p-3 text-right font-mono text-sm">{formatDuration(vod.duration)}</td>
                      <td className="p-3 text-right font-mono text-sm">{fmtInt(vod.view_count)}</td>
                      <td className="p-3 text-right font-mono text-sm">{fmtInt(vph)}</td>
                      <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                        {new Date(vod.created_at).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && vods.length === 0 && !singleVod && (
        <div className="card-surface p-8 text-center text-muted-foreground text-sm">
          Cole a URL de uma VOD ou nome do canal para iniciar a análise.
        </div>
      )}
    </div>
  );
}
