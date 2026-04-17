import { Progress } from "@/components/ui/progress";
import type { VodAuditProgress } from "@/hooks/useVodAuditProgress";

const PHASE_LABEL: Record<string, string> = {
  idle: "Aguardando...",
  fetching_chapters: "📚 Lendo capítulos da Twitch",
  fetching_sullygnome: "🎯 Consultando SullyGnome",
  sampling: "📐 Planejando amostragem",
  analyzing: "🤖 Analisando frames",
  completed: "✅ Concluído",
};

export function VodAuditProgressBar({ progress }: { progress: VodAuditProgress | null }) {
  if (!progress) return null;
  const total = progress.progress_total_minutes || 0;
  const current = progress.progress_current_minute || 0;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const isDone = progress.progress_phase === "completed";
  const hasPending = (progress.pending_audit_segments?.length || 0) > 0;

  return (
    <div className="card-surface p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">{PHASE_LABEL[progress.progress_phase] || progress.progress_phase}</span>
        <span className="font-mono text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {progress.progress_message || (total > 0 ? `Minuto ${current} de ${total} • ${progress.progress_games_found} jogos detectados` : "")}
      </p>
      {isDone && hasPending && (
        <p className="text-xs text-destructive">⚠ {progress.pending_audit_segments.length} segmento(s) marcado(s) para auditoria pendente</p>
      )}
    </div>
  );
}
