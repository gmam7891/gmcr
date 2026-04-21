import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAuditReport, type AuditReport } from "@/lib/vod-watcher";
import { FileText, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export function AuditReportCard({ auditId, autoLoad = false }: { auditId: string; autoLoad?: boolean }) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getAuditReport(auditId);
      setReport(r);
    } catch (e: any) {
      toast({ title: "Erro ao carregar relatório", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Auto-load on mount if requested
  useState(() => { if (autoLoad) void load(); });

  if (!report) {
    return (
      <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
        <FileText className="h-3.5 w-3.5" />
        {loading ? "Gerando..." : "Ver relatório consolidado"}
      </Button>
    );
  }

  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Relatório Consolidado de Auditoria
          </h3>
          <p className="text-[11px] text-muted-foreground font-mono">@{report.streamer_login} · VOD {report.vod_id}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <p className="text-sm text-foreground leading-relaxed">{report.summary}</p>

      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Duração total</p>
          <p className="text-sm font-mono font-semibold">{fmt(report.vod_duration_seconds)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cassino</p>
          <p className="text-sm font-mono font-semibold text-accent">{fmt(report.total_casino_seconds)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Outros</p>
          <p className="text-sm font-mono font-semibold text-muted-foreground">{fmt(report.total_other_seconds)}</p>
        </div>
      </div>

      {report.games.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Detecção por jogo (rigoroso 15s/frame)</p>
          <div className="space-y-1 max-h-64 overflow-auto">
            {report.games.map((g, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded bg-secondary/50">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{g.game}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{g.provider}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[9px] font-mono">{g.frames}f</Badge>
                  <span className="font-mono font-semibold text-accent">{fmt(g.seconds)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.pending_audits > 0 && (
        <div className="text-xs text-destructive border border-destructive/30 rounded p-2">
          ⚠ {report.pending_audits} segmento(s) precisam de revisão manual (IA não conseguiu identificar em janela confirmada como cassino).
        </div>
      )}

      {report.sullygnome?.summary && (
        <div className="text-[11px] text-muted-foreground border-t border-border pt-2 space-y-0.5">
          <p className="uppercase tracking-wider">SullyGnome (gabarito 30d):</p>
          <p>Cassino oficial: {report.sullygnome.summary.casinoPercentage}% · Total: {Math.round(report.sullygnome.summary.totalStreamMinutes / 60)}h</p>
        </div>
      )}
    </div>
  );
}
