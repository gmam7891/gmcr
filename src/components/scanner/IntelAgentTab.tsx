import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Brain, TrendingUp, AlertTriangle, PlayCircle, RefreshCw } from "lucide-react";
import { getAgentDashboard, learnAllPending } from "@/lib/intelligent-agent-api";

export function IntelAgentTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getAgentDashboard());
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleTrainAll = async () => {
    setTraining(true);
    try {
      const res = await learnAllPending();
      toast.success(`Lote concluído: ${res.succeeded}/${res.processed} jogos${res.has_more ? ` — ${res.remaining_estimate} pendentes` : ""}`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
    setTraining(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const m = data?.metrics || {};
  const accuracyPct = ((m.accuracy || 0) * 100).toFixed(1);

  return (
    <div className="space-y-4">
      {/* Header / Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Agente Inteligente de VOD</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Atualizar
          </Button>
          <Button size="sm" onClick={handleTrainAll} disabled={training}>
            {training ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
            Treinar Próximo Lote
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{m.total_analyses || 0}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Análises</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-primary">{m.total_confirmed || 0}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirmadas</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-destructive">{m.total_corrections || 0}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Corrigidas</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{accuracyPct}%</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Acurácia</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{m.learned_games || 0}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Jogos Aprendidos</p>
        </Card>
      </div>

      {/* Top games */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Top Jogos por Confiança
        </h3>
        {(data?.top_games || []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum jogo identificado ainda. Treine os jogos e rode a análise em algum VOD.</p>
        ) : (
          <div className="space-y-1.5">
            {(data?.top_games || []).map((g: any) => (
              <div key={g.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-secondary/30">
                <div>
                  <span className="font-medium">{g.game_name}</span>
                  <Badge variant="outline" className="ml-2 text-[10px]">{g.provider_name}</Badge>
                </div>
                <div className="flex items-center gap-3 font-mono">
                  <span className="text-muted-foreground">id: {g.agent_times_identified}</span>
                  <span className="text-primary">conf: {(Number(g.agent_average_confidence) * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Needs retraining */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" /> Jogos que Precisam de Re-treino
        </h3>
        {(data?.needs_retraining || []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum feedback de correção registrado.</p>
        ) : (
          <div className="space-y-1.5">
            {(data?.needs_retraining || []).map((g: any) => (
              <div key={g.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-secondary/30">
                <div>
                  <span className="font-medium">{g.game_name}</span>
                  <Badge variant="outline" className="ml-2 text-[10px]">{g.provider_name}</Badge>
                </div>
                <div className="flex items-center gap-3 font-mono">
                  <span className="text-destructive">corr: {g.agent_times_corrected}</span>
                  <span className="text-muted-foreground">thr: {(Number(g.agent_confidence_threshold) * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
