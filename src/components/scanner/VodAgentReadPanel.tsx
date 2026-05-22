import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { analyzeVod, getVodAnalyses, soloStart, soloStatus, type AgentAnalysis } from "@/lib/intelligent-agent-api";
import { formatSeconds } from "@/lib/twitch-api";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

interface Props {
  vodId: string;
  streamerLogin?: string;
}

export function VodAgentReadPanel({ vodId, streamerLogin }: Props) {
  const [analyses, setAnalyses] = useState<AgentAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [soloing, setSoloing] = useState(false);
  const [run, setRun] = useState<any>(null);

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

  useEffect(() => { load(); }, [vodId]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const t = setInterval(async () => {
      const st = await soloStatus(run.id).catch(() => null);
      if (st?.run) {
        setRun(st.run);
        if (st.run.status === "completed") load();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [run?.id, run?.status]);

  const start = async () => {
    setStarting(true);
    try {
      await analyzeVod(vodId);
      toast({ title: "Segunda opinião pronta", description: "Atualizado." });
      await load();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const startSolo = async () => {
    if (!streamerLogin) {
      toast({ title: "Streamer desconhecido", description: "Login não disponível.", variant: "destructive" });
      return;
    }
    setSoloing(true);
    try {
      const res = await soloStart(vodId, streamerLogin);
      toast({ title: "Modo solo iniciado", description: `${res.total_mosaics} mosaicos / ${res.total_tiles} frames em background.` });
      const st = await soloStatus(res.run_id).catch(() => null);
      if (st?.run) setRun(st.run);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSoloing(false);
    }
  };

  const buildRows = () => {
    const sorted = [...analyses].sort((a, b) => a.start_seconds - b.start_seconds);
    const totalSec = sorted.reduce((s, a) => s + (a.duration_seconds || 0), 0);
    const agree = sorted.filter((a) => a.agrees_with_pipeline === true).length;
    const diverge = sorted.filter((a) => a.agrees_with_pipeline === false).length;
    const avgConf = sorted.length
      ? sorted.reduce((s, a) => s + (a.confidence || 0), 0) / sorted.length
      : 0;
    return { sorted, totalSec, agree, diverge, avgConf };
  };

  const exportExcel = () => {
    if (!analyses.length) {
      toast({ title: "Sem dados", description: "Nenhuma análise para exportar.", variant: "destructive" });
      return;
    }
    const { sorted, totalSec, agree, diverge, avgConf } = buildRows();
    const aoa: any[][] = [
      ["Relatório — Leitura do Agente IA (Modo Solo)"],
      [`VOD ${vodId}`, streamerLogin ? `@${streamerLogin}` : ""],
      [`Gerado em ${new Date().toLocaleString("pt-BR")}`],
      [],
      ["Resumo"],
      ["Total de detecções", sorted.length],
      ["Duração total detectada (s)", totalSec],
      ["Duração total formatada", formatSeconds(totalSec)],
      ["Concorda com pipeline", agree],
      ["Diverge do pipeline", diverge],
      ["Confiança média", `${(avgConf * 100).toFixed(1)}%`],
      [],
      ["Detalhes"],
      ["Jogo", "Provedora", "Início", "Fim", "Duração", "Confiança", "Confiança Visual", "Confiança Keyword", "Concorda com Pipeline"],
    ];
    for (const a of sorted) {
      aoa.push([
        a.game_name,
        a.provider_name || "",
        formatSeconds(a.start_seconds),
        formatSeconds(a.end_seconds),
        formatSeconds(a.duration_seconds),
        `${(a.confidence * 100).toFixed(0)}%`,
        `${(a.visual_confidence * 100).toFixed(0)}%`,
        `${(a.keyword_confidence * 100).toFixed(0)}%`,
        a.agrees_with_pipeline === true ? "Sim" : a.agrees_with_pipeline === false ? "Não" : "—",
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modo Solo");
    XLSX.writeFile(wb, `agente-solo-${streamerLogin || "vod"}-${vodId}.xlsx`);
  };

  const [pdfLoading, setPdfLoading] = useState(false);
  const exportPdf = async () => {
    if (!analyses.length) {
      toast({ title: "Sem dados", description: "Nenhuma análise para exportar.", variant: "destructive" });
      return;
    }
    setPdfLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-solo-report-pdf", {
        body: { vod_id: vodId, streamer_login: streamerLogin || "vod" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("URL não retornada.");
      window.open(data.url, "_blank", "noopener,noreferrer");
      toast({ title: "PDF gerado", description: data.filename });
    } catch (e) {
      toast({
        title: "Erro ao gerar PDF",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="card-surface space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">🧠 Leitura do Agente IA</h4>
          <p className="text-xs text-muted-foreground">Segunda opinião independente do pipeline principal.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "..." : "Atualizar"}
          </Button>
          <Button size="sm" variant="secondary" onClick={start} disabled={starting}>
            {starting ? "..." : "Segunda opinião (rápido)"}
          </Button>
          <Button size="sm" onClick={startSolo} disabled={soloing || (run?.status === "running")}>
            {soloing ? "Iniciando..." : run?.status === "running" ? "Solo rodando..." : "🚀 Modo Solo (Vision)"}
          </Button>
        </div>
      </div>

      {run && (
        <div className="rounded-md border border-border/50 bg-muted/40 p-2 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="font-medium">Modo Solo · {run.status}</span>
            <span className="text-muted-foreground">
              {run.cursor_mosaic}/{run.total_mosaics} mosaicos · {run.detections_count} detecções
            </span>
          </div>
          {run.message && <div className="text-muted-foreground">{run.message}</div>}
          {run.error_message && <div className="text-destructive">{run.error_message}</div>}
        </div>
      )}

      {analyses.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma análise do agente para este VOD ainda.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 pb-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground mr-auto">
              {analyses.length} detecções
            </span>
            <Button size="sm" variant="outline" onClick={exportExcel}>
              📊 Excel
            </Button>
            <Button size="sm" variant="outline" onClick={exportPdf}>
              📄 PDF
            </Button>
          </div>
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
        </>
      )}
    </div>
  );
}
