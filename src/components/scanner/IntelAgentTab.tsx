import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Brain, TrendingUp, AlertTriangle, PlayCircle, RefreshCw, Fingerprint } from "lucide-react";
import {
  getAgentDashboard,
  getDetectionStats,
  learnAllPending,
  type DetectionStatsResponse,
} from "@/lib/intelligent-agent-api";

export function IntelAgentTab() {
  const [data, setData] = useState<any>(null);
  const [detStats, setDetStats] = useState<DetectionStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [dash, stats] = await Promise.all([
        getAgentDashboard(),
        getDetectionStats().catch(() => null), // log pode estar vazio antes do 1º run
      ]);
      setData(dash);
      setDetStats(stats);
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

      {/* pHash vs Gemini */}
      <DetectionStatsCard data={detStats} />

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

function pct(v: number | undefined): string {
  return `${((v ?? 0) * 100).toFixed(1)}%`;
}

function DetectionStatsCard({ data }: { data: DetectionStatsResponse | null }) {
  const s = data?.stats;
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-primary" /> pHash vs Gemini
        </h3>
        {data?.run?.vod_id && (
          <span className="text-[10px] font-mono text-muted-foreground">
            {data.scope === "run" ? "último run" : "global"} · VOD {data.run.vod_id}
            {data.run.status ? ` · ${data.run.status}` : ""}
          </span>
        )}
      </div>

      {!s || s.total === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sem registros de detecção ainda. Rode o Modo Solo em um VOD para
          medir quanto o caminho determinístico (pHash) resolve sozinho.
        </p>
      ) : (
        <>
          {/* Headline rates */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DetMetric
              label="Detecções por pHash"
              value={pct(s.phash_detection_share)}
              hint={`${s.phash_fired} de ${s.total_detections}`}
              accent="text-primary"
            />
            <DetMetric
              label="Override do pHash"
              value={pct(s.override_rate)}
              hint={`${s.phash_override} discordâncias`}
              accent={s.override_rate > 0.15 ? "text-amber-500" : "text-foreground"}
            />
            <DetMetric
              label="Alucinação Gemini"
              value={pct(s.hallucination_rate)}
              hint={`${s.hallucinated} fora da lib`}
              accent={s.hallucination_rate > 0.1 ? "text-destructive" : "text-foreground"}
            />
            <DetMetric
              label="Tiles de gameplay"
              value={String(s.gameplay_tiles)}
              hint={`${s.total} no total`}
            />
          </div>

          {/* Outcome breakdown */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <OutcomeChip label="promovido (pHash)" n={s.promoted_by_phash} tone="primary" />
            <OutcomeChip label="override (pHash)" n={s.phash_override} tone="amber" />
            <OutcomeChip label="promovido (Gemini)" n={s.promoted} tone="default" />
            <OutcomeChip label="revisão" n={s.review_skipped} tone="muted" />
            <OutcomeChip label="baixa conf." n={s.low_confidence} tone="muted" />
            <OutcomeChip label="alucinado" n={s.hallucinated} tone="destructive" />
            <OutcomeChip label="sem jogo" n={s.no_game} tone="muted" />
            <OutcomeChip label="lobby/other" n={s.non_gameplay} tone="muted" />
          </div>
        </>
      )}
    </Card>
  );
}

function DetMetric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">
        {label}
      </p>
      <p className={`text-xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
      {hint && <p className="text-[9px] font-mono text-muted-foreground">{hint}</p>}
    </div>
  );
}

function OutcomeChip({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone: "primary" | "amber" | "destructive" | "default" | "muted";
}) {
  const toneCls =
    tone === "primary"
      ? "border-primary/40 text-primary"
      : tone === "amber"
      ? "border-amber-500/40 text-amber-500"
      : tone === "destructive"
      ? "border-destructive/40 text-destructive"
      : "border-border text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono ${toneCls}`}
    >
      {label}
      <span className="font-bold">{n}</span>
    </span>
  );
}
