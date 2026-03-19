import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUser, getVod, getVods, getVodChapters, analyzeVodFrames, formatDuration, formatSeconds, parseDuration, type TwitchVod, type VodChapter, type AiGameDetection } from "@/lib/twitch-api";
import { fmtInt } from "@/lib/formatters";

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
  const [vodUrl, setVodUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [vods, setVods] = useState<TwitchVod[]>([]);
  const [singleVod, setSingleVod] = useState<TwitchVod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "channel" | null>(null);

  const [chaptersMap, setChaptersMap] = useState<Record<string, VodChapter[]>>({});
  const [loadingChapters, setLoadingChapters] = useState<string | null>(null);
  const [expandedVod, setExpandedVod] = useState<string | null>(null);

  // AI Vision analysis state
  const [aiResults, setAiResults] = useState<Record<string, AiGameDetection[]>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);

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
        if (!vod) throw new Error("VOD não encontrada");
        setSingleVod(vod);
        setMode("single");

        const chapters = await getVodChapters(vodId);
        setChaptersMap({ [vodId]: chapters });
        setExpandedVod(vodId);

        const channelVods = await getVods(vod.user_id, 20);
        setVods(channelVods);
      } else {
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

  // AI Vision: analyze a single VOD's thumbnails for casino game detection
  const analyzeWithAI = async (vod: TwitchVod) => {
    setAiLoading(vod.id);
    try {
      // Generate thumbnail URLs at different time offsets
      const durationMins = parseDuration(vod.duration);
      const durationSecs = durationMins * 60;
      const intervalSecs = Math.max(300, Math.floor(durationSecs / 8)); // Every 5 min or 8 samples max
      const thumbnailUrls: string[] = [];

      for (let offset = 0; offset < durationSecs; offset += intervalSecs) {
        if (thumbnailUrls.length >= 8) break;
        // Use Twitch's thumbnail URL pattern with time offset
        const url = vod.thumbnail_url
          .replace('%{width}', '640')
          .replace('%{height}', '360');
        thumbnailUrls.push(url);
      }

      // If we only get 1 unique URL (no offset support), try to at least analyze what we have
      const uniqueUrls = [...new Set(thumbnailUrls)];
      const results = await analyzeVodFrames(uniqueUrls, vod.title);
      setAiResults(prev => ({ ...prev, [vod.id]: results }));
    } catch (err) {
      console.error('AI analysis error:', err);
      setAiResults(prev => ({ ...prev, [vod.id]: [{ game: 'Erro na análise', provider: null, category: 'error', confidence: 'low' }] }));
    }
    setAiLoading(null);
  };

  const allGameSummary = useMemo(() => {
    const allChapters = Object.values(chaptersMap).flat();
    return aggregateChapters(allChapters);
  }, [chaptersMap]);

  const totalViews = vods.reduce((s, v) => s + v.view_count, 0);
  const totalHours = vods.reduce((s, v) => s + parseDuration(v.duration) / 60, 0);
  const avgViewsPerHour = totalHours > 0 ? totalViews / totalHours : 0;

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
      <div className="card-surface p-4 space-y-1">
        <p className="text-xs text-primary font-medium uppercase tracking-wider">Análise de VODs + Detecção de Jogos</p>
        <p className="text-sm text-muted-foreground">
          Cole uma URL de VOD ou nome do canal. A ferramenta detecta categorias via capítulos da Twitch e pode usar <strong>IA Vision</strong> para identificar jogos específicos de cassino (ex: Gates of Olympus, Sweet Bonanza).
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

      {/* Single VOD with chapters */}
      {singleVod && mode === "single" && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">VOD Selecionada</h3>
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
              Nenhum capítulo/jogo detectado nesta VOD.
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
              {aiLoading === singleVod.id ? "🤖 Analisando com IA..." : "🤖 Detectar jogos com IA Vision"}
            </Button>
            <span className="text-xs text-muted-foreground">Identifica jogos específicos (ex: Gates of Olympus, Sweet Bonanza)</span>
          </div>
          {aiResults[singleVod.id] && (
            <AiResultsDisplay results={aiResults[singleVod.id]} />
          )}
        </div>
      )}

      {/* Aggregated game summary */}
      {allGameSummary.length > 0 && Object.keys(chaptersMap).length > 1 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Resumo de jogos (todas as VODs analisadas)
          </h3>
          <GameSummaryTable games={allGameSummary} />
        </div>
      )}

      {/* VOD list */}
      {vods.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {mode === "single" ? "Outras VODs do canal" : "VODs do canal"} ({vods.length})
            </h3>
            <Button variant="outline" size="sm" onClick={analyzeAllVods} disabled={!!loadingChapters}>
              {loadingChapters ? "Analisando..." : "🔍 Analisar jogos de todas"}
            </Button>
          </div>

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
                  <th className="text-center text-xs uppercase tracking-wider text-muted-foreground p-3">Jogos</th>
                  <th className="text-center text-xs uppercase tracking-wider text-muted-foreground p-3">IA</th>
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
                            {new Date(vod.created_at).toLocaleDateString("pt-BR")}
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
                              <span className="text-xs text-accent">✓</span>
                            ) : (
                              <button
                                className="text-xs text-muted-foreground hover:text-accent transition-colors"
                                onClick={(e) => { e.stopPropagation(); analyzeWithAI(vod); }}
                                title="Analisar com IA Vision"
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
                            {hasAiResult && <AiResultsDisplay results={hasAiResult} compact />}
                            {!hasAiResult && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => analyzeWithAI(vod)}
                                disabled={!!aiLoading}
                              >
                                🤖 Detectar jogos específicos com IA
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
          Cole a URL de uma VOD ou nome do canal para iniciar a análise.
        </div>
      )}
    </div>
  );
}

function AiResultsDisplay({ results, compact }: { results: AiGameDetection[]; compact?: boolean }) {
  const casinoGames = results.filter(r => r.category !== 'not_casino' && r.category !== 'error');
  const otherGames = results.filter(r => r.category === 'not_casino');

  return (
    <div className="space-y-2">
      {!compact && <p className="text-xs text-accent font-medium uppercase tracking-wider">🤖 Jogos detectados pela IA Vision</p>}
      {results.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum jogo detectado.</p>
      )}
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
    </div>
  );
}

function ChapterDisplay({ chapters, compact }: { chapters: VodChapter[]; compact?: boolean }) {
  const games = aggregateChapters(chapters);
  const totalSec = chapters.reduce((s, c) => s + c.durationSeconds, 0);

  return (
    <div className="space-y-2">
      {!compact && <p className="text-xs text-muted-foreground uppercase tracking-wider">Jogos detectados (capítulos Twitch)</p>}
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
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-2">Momento</th>
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-2">Jogo / Categoria</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-2">Duração</th>
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
            <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">Jogo</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Tempo total</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">%</th>
            <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Segmentos</th>
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
