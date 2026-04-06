import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUser, getVod, getVods, getVodChapters, analyzeVodFrames, getStoryboardUrls, formatDuration, formatSeconds, parseDuration, type TwitchVod, type VodChapter, type AiGameDetection, type AiVodAnalysis, type GameTimeSegment } from "@/lib/twitch-api";
import { fmtInt } from "@/lib/formatters";
import { useLanguage } from "@/contexts/LanguageContext";
import * as XLSX from "xlsx";

interface GameSummary {
  game: string;
  gameBoxArt: string | null;
  totalSeconds: number;
  segments: number;
}

function aggregateChapters(chapters: VodChapter[]): GameSummary[] {
  const map = new Map<string, GameSummary>();
  for (const ch of chapters) {
    const key = ch.game;
    const existing = map.get(key);
    if (existing) {
      existing.totalSeconds += ch.durationSeconds;
      existing.segments += 1;
    } else {
      map.set(key, { game: ch.game, gameBoxArt: ch.gameBoxArt, totalSeconds: ch.durationSeconds, segments: 1 });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export function VodTab() {
  const { t, language } = useLanguage();
  const [vodUrl, setVodUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [vods, setVods] = useState<TwitchVod[]>([]);
  const [singleVod, setSingleVod] = useState<TwitchVod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "channel" | null>(null);

  const [chaptersMap, setChaptersMap] = useState<Record<string, VodChapter[]>>({});
  const [loadingChapters, setLoadingChapters] = useState<string | null>(null);
  const [expandedVod, setExpandedVod] = useState<string | null>(null);

  // AI Vision analysis state - now stores full analysis
  const [aiResults, setAiResults] = useState<Record<string, AiVodAnalysis>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState<string | null>(null);

  const analyze = async () => {
    if (!vodUrl.trim()) return;
    setLoading(true);
    setError(null);
    setVods([]);
    setSingleVod(null);
    setMode(null);
    setChaptersMap({});
    setExpandedVod(null);
    setAiResults({});

    try {
      const input = vodUrl.trim();
      const vodMatch = input.match(/videos\/(\d+)/);
      const isVodId = /^\d+$/.test(input);

      if (vodMatch || isVodId) {
        const vodId = vodMatch ? vodMatch[1] : input;
        const vod = await getVod(vodId);
        if (!vod) throw new Error(t("vod.not_found"));
        setSingleVod(vod);
        setMode("single");

        const chapters = await getVodChapters(vodId);
        setChaptersMap({ [vodId]: chapters });
        setExpandedVod(vodId);

        const channelVods = await getVods(vod.user_id, 20);
        setVods(channelVods);
      } else {
        const login = input.replace(/https?:\/\/(www\.|m\.)?twitch\.tv\//, "").replace(/\//g, "").toLowerCase();
        const user = await getUser(login);
        if (!user) throw new Error(t("vod.channel_not_found"));
        const channelVods = await getVods(user.id, 20);
        setVods(channelVods);
        setMode("channel");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    }
    setLoading(false);
  };

  const fetchChapters = async (vodId: string) => {
    if (chaptersMap[vodId]) {
      setExpandedVod(expandedVod === vodId ? null : vodId);
      return;
    }
    setLoadingChapters(vodId);
    try {
      const chapters = await getVodChapters(vodId);
      setChaptersMap(prev => ({ ...prev, [vodId]: chapters }));
      setExpandedVod(vodId);
    } catch (err) {
      console.error('Chapter fetch error:', err);
    }
    setLoadingChapters(null);
  };

  // Deep AI Vision: sample every 2 min across the entire VOD
  const analyzeWithAI = async (vod: TwitchVod) => {
    setAiLoading(vod.id);
    setAiProgress(t("vod.fetching_storyboards"));
    try {
      const durationMins = parseDuration(vod.duration);
      const durationSecs = durationMins * 60;

      // Get storyboard sprite sheet URLs from Twitch GQL
      const storyboards = await getStoryboardUrls(vod.id, durationSecs);

      if (storyboards.urls.length === 0) {
        const fallbackUrl = vod.thumbnail_url.replace('%{width}', '640').replace('%{height}', '360');
        setAiProgress(t("vod.analyzing_thumb"));
        const result = await analyzeVodFrames([fallbackUrl], vod.title);
        setAiResults(prev => ({ ...prev, [vod.id]: result }));
        setAiLoading(null);
        setAiProgress(null);
        return;
      }

      // Each strip covers framesPerStrip * interval seconds
      // Sample strips evenly, max 20 to keep costs down
      const maxStrips = 20;
      const step = Math.max(1, Math.floor(storyboards.urls.length / maxStrips));
      const selectedUrls: string[] = [];
      const selectedTimestamps: number[] = [];
      const secondsPerStrip = storyboards.framesPerStrip * storyboards.interval;

      for (let i = 0; i < storyboards.urls.length && selectedUrls.length < maxStrips; i += step) {
        selectedUrls.push(storyboards.urls[i]);
        selectedTimestamps.push(i * secondsPerStrip);
      }

      setAiProgress(`${t("vod.analyzing_storyboards").replace("...", "")} (${selectedUrls.length})...`);

      const result = await analyzeVodFrames(selectedUrls, vod.title, selectedTimestamps);
      setAiResults(prev => ({ ...prev, [vod.id]: result }));
    } catch (err) {
      console.error('AI analysis error:', err);
      setAiResults(prev => ({
        ...prev,
        [vod.id]: {
          games: [{ game: 'Erro na análise', provider: null, category: 'error', confidence: 'low' }],
          gameTimeline: [],
        },
      }));
    }
    setAiLoading(null);
    setAiProgress(null);
  };

  const allGameSummary = useMemo(() => {
    const allChapters = Object.values(chaptersMap).flat();
    return aggregateChapters(allChapters);
  }, [chaptersMap]);

  const totalViews = vods.reduce((s, v) => s + v.view_count, 0);
  const totalHours = vods.reduce((s, v) => s + parseDuration(v.duration) / 60, 0);
  const avgViewsPerHour = totalHours > 0 ? totalViews / totalHours : 0;

  const downloadExcel = () => {
    const rows: any[][] = [
      ["VOD Analyzer - Relatório"],
      [""],
      ["Resumo", ""],
      ["Total VODs", vods.length],
      ["Total views", totalViews],
      ["Total horas", `${totalHours.toFixed(1)}h`],
      ["Avg views/hora", Math.round(avgViewsPerHour)],
      [""],
      ["VODs", "", "", "", ""],
      ["Título", "Duração", "Views", "Views/h", "Data"],
    ];
    for (const vod of vods) {
      const mins = parseDuration(vod.duration);
      const hours = mins / 60;
      const vph = hours > 0 ? vod.view_count / hours : 0;
      rows.push([vod.title, formatDuration(vod.duration), vod.view_count, Math.round(vph), new Date(vod.created_at).toLocaleDateString("pt-BR")]);
    }
    // AI results
    const allAiGames = Object.entries(aiResults);
    if (allAiGames.length > 0) {
      rows.push([""], ["--- Detecção de Jogos (IA) ---"]);
      for (const [vodId, analysis] of allAiGames) {
        const vod = vods.find(v => v.id === vodId) || singleVod;
        rows.push([""], [`VOD: ${vod?.title || vodId}`]);
        rows.push(["Jogo", "Provedora", "Categoria", "Confiança"]);
        for (const g of analysis.games) {
          rows.push([g.game, g.provider || "-", g.category, g.confidence]);
        }
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VODs");
    XLSX.writeFile(wb, "analise-vods.xlsx");
  };

  const analyzeAllVods = async () => {
    for (const vod of vods) {
      if (!chaptersMap[vod.id]) {
        setLoadingChapters(vod.id);
        try {
          const chapters = await getVodChapters(vod.id);
          setChaptersMap(prev => ({ ...prev, [vod.id]: chapters }));
        } catch (err) {
          console.error('Chapter fetch error for', vod.id, err);
        }
      }
    }
    setLoadingChapters(null);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="card-surface p-4 space-y-1 flex items-start justify-between">
        <div>
          <p className="text-xs text-primary font-medium uppercase tracking-wider">{t("vod.title_header")}</p>
          <p className="text-sm text-muted-foreground">
            {t("vod.description")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={downloadExcel} className="shrink-0">
          {t("app.export_excel")}
        </Button>
      </div>

      <div className="flex gap-3">
        <Input
          value={vodUrl}
          onChange={(e) => setVodUrl(e.target.value)}
          placeholder={t("vod.placeholder")}
          className="font-mono bg-secondary border-border"
          onKeyDown={(e) => e.key === 'Enter' && analyze()}
        />
        <Button onClick={analyze} disabled={loading || !vodUrl.trim()}>
          {loading ? t("vod.analyzing") : t("vod.analyze")}
        </Button>
      </div>

      {loading && (
        <div className="card-surface p-6 text-center">
          <div className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground mt-2">{t("vod.fetching")}</p>
        </div>
      )}

      {error && (
        <div className="card-surface border-destructive/30 p-4 text-sm text-destructive">{error}</div>
      )}

      {/* Single VOD with chapters */}
      {singleVod && mode === "single" && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t("vod.selected_vod")}</h3>
          <div className="grid grid-cols-4 gap-3">
            <MetricCard label="Título" value={singleVod.title.slice(0, 40) + (singleVod.title.length > 40 ? "..." : "")} />
            <MetricCard label="Duração" value={formatDuration(singleVod.duration)} />
            <MetricCard label="Views" value={fmtInt(singleVod.view_count)} />
            <MetricCard label="Views/hora" value={fmtInt(parseDuration(singleVod.duration) > 0 ? singleVod.view_count / (parseDuration(singleVod.duration) / 60) : 0)} />
          </div>

          {chaptersMap[singleVod.id] && chaptersMap[singleVod.id].length > 0 && (
            <ChapterDisplay chapters={chaptersMap[singleVod.id]} />
          )}
          {chaptersMap[singleVod.id] && chaptersMap[singleVod.id].length === 0 && (
            <div className="card-surface p-3 text-sm text-muted-foreground">
              {t("vod.no_chapters")}
            </div>
          )}

          {/* AI Vision Analysis for single VOD */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => analyzeWithAI(singleVod)}
              disabled={!!aiLoading}
            >
              {aiLoading === singleVod.id ? `🤖 ${aiProgress || t("vod.analyzing")}` : t("vod.ai_deep_scan")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("vod.ai_deep_desc")}</span>
          </div>
          {aiResults[singleVod.id] && (
            <AiResultsDisplay analysis={aiResults[singleVod.id]} vodDurationSecs={parseDuration(singleVod.duration) * 60} />
          )}
        </div>
      )}

      {/* Aggregated game summary */}
      {allGameSummary.length > 0 && Object.keys(chaptersMap).length > 1 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            {t("vod.game_summary")}
          </h3>
          <GameSummaryTable games={allGameSummary} />
        </div>
      )}

      {/* VOD list */}
      {vods.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {mode === "single" ? t("vod.other_vods") : t("vod.channel_vods")} ({vods.length})
            </h3>
            <Button variant="outline" size="sm" onClick={analyzeAllVods} disabled={!!loadingChapters}>
              {loadingChapters ? t("vod.analyzing") : t("vod.analyze_all")}
            </Button>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <MetricCard label={t("vod.total_vods")} value={fmtInt(vods.length)} />
            <MetricCard label={t("yt.total_views")} value={fmtInt(totalViews)} />
            <MetricCard label={t("yt.total_hours")} value={`${totalHours.toFixed(1)}h`} />
            <MetricCard label={t("vod.avg_views_hour")} value={fmtInt(avgViewsPerHour)} status={avgViewsPerHour > 100 ? "go" : undefined} />
          </div>

          <div className="card-surface overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                   <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.title_col")}</th>
                   <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.duration_col")}</th>
                   <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.views_col")}</th>
                   <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Views/h</th>
                   <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("yt.date_col")}</th>
                   <th className="text-center text-xs uppercase tracking-wider text-muted-foreground p-3">{t("vod.games_col")}</th>
                   <th className="text-center text-xs uppercase tracking-wider text-muted-foreground p-3">{t("vod.ia_col")}</th>
                </tr>
              </thead>
              <tbody>
                {vods.map((vod) => {
                  const mins = parseDuration(vod.duration);
                  const hours = mins / 60;
                  const vph = hours > 0 ? vod.view_count / hours : 0;
                  const hasChapters = chaptersMap[vod.id];
                  const isExpanded = expandedVod === vod.id;
                  const hasAiResult = aiResults[vod.id];
                  return (
                    <tr key={vod.id} className="border-b border-border last:border-0">
                      <td colSpan={7} className="p-0">
                        <div
                          className="flex items-center hover:bg-secondary/50 transition-colors cursor-pointer"
                          onClick={() => fetchChapters(vod.id)}
                        >
                          <div className="p-3 text-sm max-w-[250px] truncate flex-1" title={vod.title}>{vod.title}</div>
                          <div className="p-3 text-right font-mono text-sm w-20">{formatDuration(vod.duration)}</div>
                          <div className="p-3 text-right font-mono text-sm w-20">{fmtInt(vod.view_count)}</div>
                          <div className="p-3 text-right font-mono text-sm w-20">{fmtInt(vph)}</div>
                          <div className="p-3 text-right font-mono text-xs text-muted-foreground w-24">
                            {new Date(vod.created_at).toLocaleDateString(language === "pt" ? "pt-BR" : "en-US")}
                          </div>
                          <div className="p-3 text-center w-16">
                            {loadingChapters === vod.id ? (
                              <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            ) : hasChapters ? (
                              <span className="text-xs text-primary">{hasChapters.length > 0 ? `${hasChapters.length}` : "—"}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">🔍</span>
                            )}
                          </div>
                          <div className="p-3 text-center w-16">
                            {aiLoading === vod.id ? (
                              <div className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                            ) : hasAiResult ? (
                              <span className="text-xs text-accent">✓ {hasAiResult.games.filter(g => g.category !== 'not_casino').length}</span>
                            ) : (
                              <button
                                className="text-xs text-muted-foreground hover:text-accent transition-colors"
                                onClick={(e) => { e.stopPropagation(); analyzeWithAI(vod); }}
                                title="Varredura profunda com IA"
                              >
                                🤖
                              </button>
                            )}
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="px-6 pb-3 space-y-3">
                            {hasChapters && hasChapters.length > 0 && (
                              <ChapterDisplay chapters={hasChapters} compact />
                            )}
                            {hasAiResult && <AiResultsDisplay analysis={hasAiResult} vodDurationSecs={mins * 60} compact />}
                            {!hasAiResult && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => analyzeWithAI(vod)}
                                disabled={!!aiLoading}
                              >
                                {aiLoading === vod.id ? `🤖 ${aiProgress || t("vod.analyzing")}` : t("vod.ai_deep_scan")}
                              </Button>
                            )}
                          </div>
                        )}
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
          {t("vod.empty")}
        </div>
      )}
    </div>
  );
}

function AiResultsDisplay({ analysis, vodDurationSecs, compact }: { analysis: AiVodAnalysis; vodDurationSecs: number; compact?: boolean }) {
  const casinoGames = analysis.games.filter(r => r.category !== 'not_casino' && r.category !== 'error');
  const otherGames = analysis.games.filter(r => r.category === 'not_casino');
  const timeline = analysis.gameTimeline || [];

  // Aggregate time per game from timeline
  const timeByGame = new Map<string, { game: string; provider: string | null; totalSeconds: number; category: string }>();
  for (const seg of timeline) {
    const key = `${seg.game}|${seg.provider}`;
    const existing = timeByGame.get(key);
    if (existing) {
      existing.totalSeconds += seg.durationSeconds;
    } else {
      timeByGame.set(key, { game: seg.game, provider: seg.provider, totalSeconds: seg.durationSeconds, category: seg.category });
    }
  }
  const timeAggregated = Array.from(timeByGame.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);

  return (
    <div className="space-y-3">
      {!compact && <p className="text-xs text-accent font-medium uppercase tracking-wider">{t("vod.ai_detected")}</p>}

      {casinoGames.length === 0 && otherGames.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("vod.no_games")}</p>
      )}

      {/* Time-based summary (main view) */}
      {timeAggregated.length > 0 && (
        <div className="card-surface overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                 <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-2">{t("vod.game_col")}</th>
                 <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-2">{t("vod.provider_col")}</th>
                 <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-2">{t("vod.est_time")}</th>
                 <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-2">%</th>
              </tr>
            </thead>
            <tbody>
              {timeAggregated.map((g, i) => {
                const pct = vodDurationSecs > 0 ? ((g.totalSeconds / vodDurationSecs) * 100).toFixed(1) : "0";
                const isCasino = g.category !== 'not_casino';
                return (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                    <td className="p-2 text-sm">
                      <span className="mr-1.5">{isCasino ? '🎰' : '🎮'}</span>
                      <span className="font-medium text-foreground">{g.game}</span>
                    </td>
                    <td className="p-2 text-sm text-muted-foreground">{g.provider || '—'}</td>
                    <td className="p-2 text-right font-mono text-sm">{formatSeconds(g.totalSeconds)}</td>
                    <td className="p-2 text-right font-mono text-sm">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Timeline visualization */}
      {!compact && timeline.length > 0 && vodDurationSecs > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Timeline</p>
          <div className="flex h-6 rounded overflow-hidden border border-border">
            {timeline.map((seg, i) => {
              const widthPct = (seg.durationSeconds / vodDurationSecs) * 100;
              if (widthPct < 0.5) return null;
              const isCasino = seg.category !== 'not_casino';
              const colors = [
                'bg-primary', 'bg-accent', 'bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'
              ];
              const colorClass = isCasino ? colors[i % colors.length] : 'bg-muted';
              return (
                <div
                  key={i}
                  className={`${colorClass} relative group`}
                  style={{ width: `${widthPct}%` }}
                  title={`${seg.game} (${formatSeconds(seg.durationSeconds)})`}
                >
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                    <div className="card-surface px-2 py-1 text-xs whitespace-nowrap shadow-lg border border-border">
                      <span className="font-medium">{seg.game}</span>
                      {seg.provider && <span className="text-muted-foreground ml-1">({seg.provider})</span>}
                      <span className="text-muted-foreground ml-1">{formatSeconds(seg.durationSeconds)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Compact game chips (fallback when no timeline) */}
      {timeAggregated.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {casinoGames.map((r, i) => (
            <div key={i} className="flex items-center gap-2 card-surface px-3 py-1.5 text-xs border border-accent/20">
              <span className="text-accent">🎰</span>
              <div>
                <span className="font-medium text-foreground">{r.game}</span>
                {r.provider && <span className="text-muted-foreground ml-1">({r.provider})</span>}
                <span className={`ml-1.5 text-xs ${r.confidence === 'high' ? 'text-accent' : r.confidence === 'medium' ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                  {r.confidence === 'high' ? '●' : r.confidence === 'medium' ? '◐' : '○'}
                </span>
              </div>
            </div>
          ))}
          {otherGames.map((r, i) => (
            <div key={`other-${i}`} className="flex items-center gap-2 card-surface px-3 py-1.5 text-xs">
              <span>🎮</span>
              <span className="text-muted-foreground">{r.game}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChapterDisplay({ chapters, compact }: { chapters: VodChapter[]; compact?: boolean }) {
  const games = aggregateChapters(chapters);
  const totalSec = chapters.reduce((s, c) => s + c.durationSeconds, 0);

  return (
    <div className="space-y-2">
      {!compact && <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("vod.chapters_twitch")}</p>}
      <div className="flex flex-wrap gap-1.5">
        {games.map((g) => {
          const pct = totalSec > 0 ? ((g.totalSeconds / totalSec) * 100).toFixed(0) : "0";
          return (
            <div key={g.game} className="flex items-center gap-2 card-surface px-3 py-1.5 text-xs">
              {g.gameBoxArt && (
                <img
                  src={g.gameBoxArt.replace('{width}', '28').replace('{height}', '38')}
                  alt={g.game}
                  className="w-5 h-7 rounded-sm object-cover"
                />
              )}
              <div>
                <span className="font-medium text-foreground">{g.game}</span>
                <span className="text-muted-foreground ml-1.5">{formatSeconds(g.totalSeconds)} ({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>

      {!compact && (
        <div className="card-surface overflow-hidden mt-2">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                 <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-2">{t("vod.moment_col")}</th>
                 <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-2">{t("vod.game_category")}</th>
                 <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-2">{t("yt.duration_col")}</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((ch, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="p-2 font-mono text-xs text-muted-foreground">{formatSeconds(ch.positionSeconds)}</td>
                  <td className="p-2 text-sm flex items-center gap-2">
                    {ch.gameBoxArt && (
                      <img
                        src={ch.gameBoxArt.replace('{width}', '20').replace('{height}', '28')}
                        alt={ch.game}
                        className="w-4 h-5 rounded-sm object-cover"
                      />
                    )}
                    {ch.game}
                  </td>
                  <td className="p-2 text-right font-mono text-sm">{formatSeconds(ch.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GameSummaryTable({ games }: { games: GameSummary[] }) {
  const totalSec = games.reduce((s, g) => s + g.totalSeconds, 0);
  return (
    <div className="card-surface overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
             <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">{t("vod.game_col")}</th>
             <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("vod.total_time")}</th>
             <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">%</th>
             <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">{t("vod.segments_col")}</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr key={g.game} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
              <td className="p-3 text-sm flex items-center gap-2">
                {g.gameBoxArt && (
                  <img
                    src={g.gameBoxArt.replace('{width}', '28').replace('{height}', '38')}
                    alt={g.game}
                    className="w-5 h-7 rounded-sm object-cover"
                  />
                )}
                {g.game}
              </td>
              <td className="p-3 text-right font-mono text-sm">{formatSeconds(g.totalSeconds)}</td>
              <td className="p-3 text-right font-mono text-sm">{totalSec > 0 ? ((g.totalSeconds / totalSec) * 100).toFixed(1) : 0}%</td>
              <td className="p-3 text-right font-mono text-sm">{g.segments}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
