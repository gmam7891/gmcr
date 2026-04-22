import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAuditReport, type AuditReport } from "@/lib/vod-watcher";
import { FileText, RefreshCw, Download, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
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
  const reportRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => { if (autoLoad) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [auditId]);

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
    if (!reportRef.current || !report) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      // Resolve theme background to avoid transparent canvas
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
      const bgColor = bg ? `hsl(${bg})` : "#ffffff";

      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: bgColor,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const usableW = pageW - margin * 2;
      const ratio = canvas.height / canvas.width;
      const imgH = usableW * ratio;
      // If taller than one page, paginate by clipping
      if (imgH <= pageH - margin * 2) {
        pdf.addImage(imgData, "PNG", margin, margin, usableW, imgH);
      } else {
        let position = 0;
        const pageContentH = pageH - margin * 2;
        const pxPerPt = canvas.width / usableW;
        const sliceHpx = pageContentH * pxPerPt;
        while (position < canvas.height) {
          const c = document.createElement("canvas");
          c.width = canvas.width;
          c.height = Math.min(sliceHpx, canvas.height - position);
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(canvas, 0, position, canvas.width, c.height, 0, 0, canvas.width, c.height);
          const slice = c.toDataURL("image/png");
          if (position > 0) pdf.addPage();
          pdf.addImage(slice, "PNG", margin, margin, usableW, (c.height / canvas.width) * usableW);
          position += sliceHpx;
        }
      }
      pdf.save(`relatorio-${report.streamer_login}-${report.vod_id}.pdf`);
      toast({ title: "PDF gerado", description: "Relatório exportado com sucesso." });
    } catch (e: any) {
      toast({ title: "Falha ao exportar", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
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

  return (
    <div className="space-y-3">
      {/* Toolbar (excluded from PDF capture) */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
        <Button variant="outline" size="sm" onClick={exportPdf} disabled={exporting} className="gap-1.5">
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {exporting ? "Gerando PDF..." : "Exportar PDF"}
        </Button>
      </div>

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
          </div>
        </div>

        {report.audit_status === "failed" && report.error_message && (
          <div className="text-xs text-destructive border border-destructive/30 rounded p-2">
            ⚠ {report.error_message}
          </div>
        )}

        {report.audit_status !== "failed" && report.games.length === 0 && (
          <div className="text-xs text-muted-foreground border border-border rounded p-2 bg-secondary/30">
            Auditoria finalizada sem detectar conteúdo de cassino neste VOD.
          </div>
        )}

        <p className="text-sm text-foreground leading-relaxed">{report.summary}</p>

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
            ⚠ {report.pending_audits} segmento(s) precisam de revisão manual.
          </div>
        )}

        <p className="text-[10px] text-muted-foreground font-mono pt-2 border-t border-border">
          Fonte: varredura visual interna (raw_evidences) · Auditoria autônoma Starklytic
        </p>
      </div>
    </div>
  );
}
