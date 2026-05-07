import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { analyzeVod, getVodAnalyses, soloStart, soloStatus, type AgentAnalysis } from "@/lib/intelligent-agent-api";
import { formatSeconds } from "@/lib/twitch-api";

interface Props {
  vodId: string;
  streamerLogin?: string;
}

export function VodAgentReadPanel({ vodId }: Props) {
  const [analyses, setAnalyses] = useState<AgentAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getVodAnalyses(vodId);
      setAnalyses(res.analyses || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [vodId]);

  const start = async () => {
    setStarting(true);
    try {
      await analyzeVod(vodId);
      toast({ title: "Agente iniciado", description: "Leitura em background. Atualize em ~1 min." });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="card-surface space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">🧠 Leitura do Agente IA</h4>
          <p className="text-xs text-muted-foreground">Segunda opinião independente do pipeline principal.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Atualizar"}
          </Button>
          <Button size="sm" onClick={start} disabled={starting}>
            {starting ? "Iniciando..." : "Rodar Agente"}
          </Button>
        </div>
      </div>

      {analyses.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma análise do agente para este VOD ainda.</p>
      ) : (
        <div className="space-y-2">
          {analyses.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/50 p-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{a.game_name}</div>
                <div className="text-muted-foreground">
                  {formatSeconds(a.start_seconds)} → {formatSeconds(a.end_seconds)} ·{" "}
                  {formatSeconds(a.duration_seconds)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline">conf {(a.confidence * 100).toFixed(0)}%</Badge>
                {a.agrees_with_pipeline === true && <Badge variant="secondary">✓ concorda</Badge>}
                {a.agrees_with_pipeline === false && <Badge variant="destructive">✗ diverge</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
