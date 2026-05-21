import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAuditReport, type AuditReport } from "@/lib/vod-watcher";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, FileText, RefreshCw, Download, Loader2, Link2, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}

function fmtTimestamp(sec?: number): string {
  if (typeof sec !== "number") return "--:--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

// Palette built from semantic tokens to keep theme consistency (HSL).
const CHART_HSL = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--chart-1, var(--primary)))",
  "hsl(var(--chart-2, var(--accent)))",
  "hsl(var(--chart-3, var(--primary)))",
  "hsl(var(--chart-4, var(--accent)))",
  "hsl(var(--chart-5, var(--primary)))",
  "hsl(var(--muted-foreground))",
];
function colorFor(i: number) {
  return CHART_HSL[i % CHART_HSL.length];
}

interface ProviderSlice {
  provider: string;
  seconds: number;
  pct: number;
  color: string;
}

export function AuditReportCard({ auditId, autoLoad = false }: { auditId: string; autoLoad?: boolean }) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      // Force fresh fetch — bypass any HTTP/Edge cache by appending a nonce
      const r = await getAuditReport(auditId);
      setReport(r);
    } catch (e: any) {
      toast({ title: "Erro ao carregar relatório", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Always force a fresh load when auditId changes (ignore stale local state).
  useEffect(() => {
    setReport(null);
    setShareUrl(null);
    setShareExpiresAt(null);
    if (autoLoad) void load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [auditId]);

  // Aggregate seconds per provider
  const providerSlices = useMemo<ProviderSlice[]>(() => {
    if (!report || !report.games?.length) return [];
    const map = new Map<string, number>();
    for (const g of report.games) {
      const key = (g.provider || "Desconhecido").trim() || "Desconhecido";
      map.set(key, (map.get(key) || 0) + (g.seconds || 0));
    }
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(map.entries())
      .map(([provider, seconds], i) => ({
        provider,
        seconds,
        pct: (seconds / total) * 100,
        color: colorFor(i),
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [report]);

  const exportPdf = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audit-report-pdf", {
        body: { audit_id: auditId, ttl_seconds: 60 * 60 * 24 * 7 },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const url = (data as any)?.url as string;
      const expires = (data as any)?.expires_at as string;
      if (!url) throw new Error("URL não retornada pelo servidor.");
      setShareUrl(url);
      setShareExpiresAt(expires);
      // Trigger immediate download
      const a = document.createElement("a");
      a.href = url;
      a.download = (data as any)?.filename || `relatorio-${report.streamer_login}-${report.vod_id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast({
        title: "PDF gerado",
        description: "Download iniciado. Link público válido por 7 dias.",
      });
    } catch (e: any) {
      toast({ title: "Falha ao exportar", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copiado", description: "Cole no e-mail para a marca." });
    } catch {
      toast({ title: "Falha ao copiar", variant: "destructive" });
    }
  };

  if (!report) {
    return (
      <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
        <FileText className="h-3.5 w-3.5" />
        {loading ? "Gerando..." : "Ver relatório consolidado"}
      </Button>
    );
  }

  const totalDetected = report.total_casino_seconds || 0;
  const detectedPct = report.vod_duration_seconds > 0
    ? (totalDetected / report.vod_duration_seconds) * 100
    : 0;
  const frameCount = report.expected_frames || 200;
  const durationPrecision = Math.round(((report.vod_duration_seconds || 0) / frameCount) / 2);
  const confirmedGames = report.games.filter((g) => g.status !== "suspect");
  const suspectGames = report.games.filter((g) => g.status === "suspect");
  const visualProofs = report.games.filter((g) => g.proof?.proof_image_url).slice(0, 6);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
        <Button variant="default" size="sm" onClick={exportPdf} disabled={exporting} className="gap-1.5">
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {exporting ? "Gerando PDF..." : "Gerar PDF + Link"}
        </Button>
      </div>

      {/* Public share link panel */}
      {shareUrl && (
        <div className="card-surface p-3 border border-primary/40 bg-primary/5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Link2 className="h-3.5 w-3.5" />
            Link público para compartilhar com a marca
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="flex-1 text-[11px] font-mono px-2 py-1.5 rounded border border-border bg-background text-foreground truncate"
            />
            <Button size="sm" variant="outline" onClick={copyShareLink} className="gap-1.5 shrink-0">
              <Copy className="h-3.5 w-3.5" />
              Copiar
            </Button>
          </div>
          {shareExpiresAt && (
            <p className="text-[10px] text-muted-foreground">
              Expira em {new Date(shareExpiresAt).toLocaleString("pt-BR")} · download direto, sem login.
            </p>
          )}
        </div>
      )}

      {/* Capture area */}
      <div ref={reportRef} className="card-surface p-5 space-y-4 bg-background">
        <div className="flex items-start justify-between gap-2 border-b border-border pb-3">
          <div className="space-y-1 flex-1">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Relatório Consolidado de Auditoria
            </h3>
            <p className="text-[11px] text-muted-foreground font-mono">
              @{report.streamer_login} · VOD {report.vod_id} · Gerado em {new Date().toLocaleString("pt-BR")}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">
              Análise baseada em amostragem de {frameCount} frames. Precisão de duração: ±{durationPrecision}s por jogo detectado.
            </p>
          </div>
        </div>

        {report.audit_status === "failed" && report.error_message && (
          <div className="text-xs text-destructive border border-destructive/30 rounded p-2">
            ⚠ {report.error_message}
          </div>
        )}

        {report.partial_reason && (
          <div className="text-[11px] text-accent border border-accent/30 rounded p-2 bg-accent/5">
            ⚠ Auditoria parcial: <span className="font-mono">{report.partial_reason}</span>. Os números abaixo podem subestimar o tempo real de cassino.
          </div>
        )}

        {(report.audit_status === "needs_review" || report.reconciliation_status === "needs_review") && (
          <div className="text-[11px] text-destructive border border-destructive/30 rounded p-2 bg-destructive/5">
            🔍 Esta auditoria foi marcada para revisão humana antes de ser certificada (cobertura ou consistência abaixo do esperado).
          </div>
        )}

        {/* Diagnostic log: shown when fallback couldn't recover data */}
        {report.diagnostic_log && (
          <div className="text-[11px] text-accent border border-accent/30 rounded p-2 bg-accent/5 font-mono">
            🔧 {report.diagnostic_log}
          </div>
        )}

        {/* Reconciliation status badge */}
        {report.reconciliation_status === "mismatch" && report.reconciliation_notes && (
          <div className="text-[11px] text-accent border border-accent/30 rounded p-2 bg-accent/5 font-mono">
            ⚖ Reconciliação: {report.reconciliation_notes}
          </div>
        )}
        {report.pending_review_frames !== undefined && report.pending_review_frames > 0 && (
          <div className="text-[11px] text-muted-foreground border border-border rounded p-2 bg-secondary/30">
            🔍 {report.pending_review_frames} frames com confiança &lt; 85% aguardam revisão humana para certificação.
          </div>
        )}

        {report.audit_status !== "failed" && report.games.length === 0 && !report.diagnostic_log && (
          <div className="text-xs text-muted-foreground border border-border rounded p-2 bg-secondary/30">
            Auditoria finalizada sem detectar conteúdo de cassino neste VOD.
          </div>
        )}

        <p className="text-sm text-foreground leading-relaxed">{report.summary}</p>

        {report?.state_breakdown && (
          <div className="flex flex-wrap gap-3 text-[11px] font-mono text-muted-foreground mt-2">
            <span>🎮 Gameplay: {fmt(report.state_breakdown.gameplay_seconds || 0)}</span>
            <span>🎰 Lobby: {fmt(report.state_breakdown.lobby_seconds || 0)}</span>
            <span>⏳ Loading: {fmt(report.state_breakdown.loading_seconds || 0)}</span>
            <span>💬 Outro: {fmt(report.state_breakdown.other_seconds || 0)}</span>
          </div>
        )}

        {visualProofs.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-border">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Prova visual da intenção</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visualProofs.map((g, i) => (
                <div key={`${g.game}-${i}`} className="rounded border border-border bg-secondary/30 overflow-hidden">
                  <img
                    src={g.proof?.proof_image_url || ""}
                    alt={`Prova visual de ${g.game}`}
                    className="w-full h-36 object-cover"
                    loading="lazy"
                  />
                  <div className="p-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{g.game}</span>
                      <Badge variant="outline" className="text-[9px] font-mono shrink-0">{fmtTimestamp(g.proof?.timestamp_seconds)}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{g.provider} · {g.proof?.detection_type || "visual"}</p>
                    {g.proof?.page_url && <p className="text-[10px] text-primary font-mono truncate">{g.proof.page_url}</p>}
                    {g.proof?.evidence && <p className="text-[10px] text-muted-foreground line-clamp-2">{g.proof.evidence}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metrics row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-border">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Duração total</p>
            <p className="text-sm font-mono font-semibold">{fmt(report.vod_duration_seconds)}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cassino</p>
            <p className="text-sm font-mono font-semibold text-accent">{fmt(report.total_casino_seconds)}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">% do stream</p>
            <p className="text-sm font-mono font-semibold text-primary">{detectedPct.toFixed(1)}%</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Provedoras</p>
            <p className="text-sm font-mono font-semibold">{providerSlices.length}</p>
          </div>
        </div>

        {/* Pie chart per provider */}
        {providerSlices.length > 0 && (
          <div className="pt-3 border-t border-border space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Distribuição por provedora ({providerSlices.length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={providerSlices}
                      dataKey="seconds"
                      nameKey="provider"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={1}
                      isAnimationActive={false}
                    >
                      {providerSlices.map((s, i) => (
                        <Cell key={i} fill={s.color} stroke="hsl(var(--background))" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "hsl(var(--popover-foreground))",
                      }}
                      formatter={(value: any, _n, item: any) => [
                        `${fmt(Number(value))} (${item?.payload?.pct?.toFixed(1)}%)`,
                        item?.payload?.provider,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1 max-h-[260px] overflow-auto pr-1">
                {providerSlices.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1">
                    <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: s.color }} />
                    <span className="flex-1 truncate font-medium">{s.provider}</span>
                    <span className="font-mono text-muted-foreground">{fmt(s.seconds)}</span>
                    <Badge variant="outline" className="text-[9px] font-mono w-12 justify-center">
                      {s.pct.toFixed(1)}%
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Per-game detail */}
        {report.games.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-border">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Detecção por jogo (rigoroso 15s/frame)
            </p>
            <div className="space-y-1 max-h-64 overflow-auto">
              {confirmedGames.map((g, i) => (
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
            {suspectGames.length > 0 && (
              <div className="space-y-1 pt-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-accent" /> Detecções não confirmadas
                </p>
                {suspectGames.map((g, i) => (
                  <div key={`suspect-${i}`} className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded border border-accent/30 bg-accent/5">
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
            )}
          </div>
        )}

        {report.pending_audits > 0 && (
          <div className="text-xs text-destructive border border-destructive/30 rounded p-2">
            ⚠ {report.pending_audits} segmento(s) precisam de revisão manual.
          </div>
        )}

        <p className="text-[10px] text-muted-foreground font-mono pt-2 border-t border-border">
          Fonte: {report.data_source === "stream_snapshots:storyboard" ? "varredura visual (storyboards)" : "sem dados"} · SSoT: stream_snapshots · Starklytic
        </p>
      </div>
    </div>
  );
}
