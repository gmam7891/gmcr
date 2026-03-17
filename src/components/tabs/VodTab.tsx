import { useState } from "react";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Chapter {
  game: string;
  duration_min: number;
}

interface VodResult {
  title: string;
  duration: string;
  chapters: Chapter[];
  totalAreaLink: number;
  error?: string;
}

export function VodTab() {
  const [vodUrl, setVodUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VodResult | null>(null);

  const jogosAreaLink = [
    "Area Link",
    "Virtual Casino",
    "Slots",
    "Casino",
    "Phoenix Firestorm",
    "Bank Boss",
    "Dragon",
  ];

  const analyzeVod = async () => {
    if (!vodUrl.trim()) return;
    setLoading(true);
    setResult(null);

    // Simulate metadata-first analysis
    // In production, this would call Twitch API for video chapters/segments
    await new Promise((r) => setTimeout(r, 1500));

    // Demo result — in real implementation, fetch from Twitch API
    const mockChapters: Chapter[] = [
      { game: "Just Chatting", duration_min: 30 },
      { game: "Virtual Casino", duration_min: 120 },
      { game: "Slots", duration_min: 60 },
      { game: "Just Chatting", duration_min: 20 },
      { game: "Virtual Casino", duration_min: 90 },
    ];

    const totalAreaLink = mockChapters
      .filter((c) => jogosAreaLink.some((j) => c.game.toLowerCase().includes(j.toLowerCase())))
      .reduce((sum, c) => sum + c.duration_min, 0);

    setResult({
      title: "Stream Analysis",
      duration: `${Math.floor(mockChapters.reduce((s, c) => s + c.duration_min, 0) / 60)}h${mockChapters.reduce((s, c) => s + c.duration_min, 0) % 60}m`,
      chapters: mockChapters,
      totalAreaLink,
    });
    setLoading(false);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="card-surface p-4 space-y-1">
        <p className="text-xs text-primary font-medium uppercase tracking-wider">Otimização v2</p>
        <p className="text-sm text-muted-foreground">
          Usa metadados da API + análise de capítulos ao invés de download + Whisper. Resultado instantâneo.
        </p>
      </div>

      <div className="flex gap-3">
        <Input
          value={vodUrl}
          onChange={(e) => setVodUrl(e.target.value)}
          placeholder="https://www.twitch.tv/videos/2717322831"
          className="font-mono bg-secondary border-border"
        />
        <Button onClick={analyzeVod} disabled={loading || !vodUrl.trim()}>
          {loading ? "Analisando..." : "Analisar"}
        </Button>
      </div>

      {loading && (
        <div className="card-surface p-6 text-center">
          <div className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground mt-2">Buscando metadados da stream...</p>
        </div>
      )}

      {result && !result.error && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Título" value={result.title} />
            <MetricCard label="Duração" value={result.duration} />
            <MetricCard
              label="Total Área Link™"
              value={`${result.totalAreaLink} min`}
              status={result.totalAreaLink > 60 ? "go" : result.totalAreaLink > 0 ? "warning" : "nogo"}
            />
          </div>

          <div className="card-surface overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs uppercase tracking-wider text-muted-foreground p-3">Jogo / Categoria</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Duração (min)</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.chapters.map((ch, i) => {
                  const isAreaLink = jogosAreaLink.some((j) => ch.game.toLowerCase().includes(j.toLowerCase()));
                  return (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="p-3 font-mono text-sm">{ch.game}</td>
                      <td className="p-3 text-right font-mono text-sm">{ch.duration_min}</td>
                      <td className="p-3 text-right">
                        {isAreaLink ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-accent/10 text-accent">ÁREA LINK</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            ⚡ Dados baseados em metadados da API (capítulos/categorias). Para verificação por áudio, integre surgical sampling (15s a cada 10min).
          </p>
        </div>
      )}

      {!loading && !result && (
        <div className="card-surface p-8 text-center text-muted-foreground text-sm">
          Cole a URL de uma VOD para iniciar a análise.
        </div>
      )}
    </div>
  );
}
