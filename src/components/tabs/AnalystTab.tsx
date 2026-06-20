import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Send, Sparkles, AlertTriangle, BarChart3, FileText, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ReportRow {
  id: string;
  week_start: string;
  summary_text: string | null;
  created_at: string;
}

interface ChatTurn {
  question: string;
  answer?: string;
  sql?: string;
  rows?: any[];
  error?: string;
  loading?: boolean;
}

const SUGGESTIONS = [
  "Quais streamers expuseram mais a Pragmatic Play nos últimos 30 dias?",
  "Top 10 jogos mais detectados na última semana",
  "Quantos VODs auditei esse mês e quantos minutos de cassino?",
  "Liste os 5 influencers descobertos com maior match_score",
];

export function AnalystTab() {
  const { currentOrg } = useAuth();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [generatingReport, setGeneratingReport] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadReports = async () => {
    if (!currentOrg) return;
    const { data, error } = await supabase
      .from("reports")
      .select("id, week_start, summary_text, created_at")
      .eq("org_id", currentOrg.id)
      .order("created_at", { ascending: false })
      .limit(12);
    if (!error) setReports((data || []) as ReportRow[]);
  };

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrg?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const generateReport = async () => {
    if (!currentOrg || generatingReport) return;
    setGeneratingReport(true);
    try {
      const { error } = await supabase.functions.invoke("weekly-report", {
        body: { org_id: currentOrg.id },
      });
      if (error) throw new Error(error.message);
      toast.success("Relatório gerado");
      await loadReports();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGeneratingReport(false);
    }
  };

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    if (!currentOrg) {
      toast.error("Selecione uma organização ativa primeiro.");
      return;
    }
    setBusy(true);
    setTurns((t) => [...t, { question, loading: true }]);
    setInput("");

    try {
      const { data, error } = await supabase.functions.invoke("ai-analyst", {
        body: { question },
      });
      if (error) throw new Error(error.message);
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = { question, ...data, loading: false };
        return copy;
      });
    } catch (err: any) {
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = { question, error: err.message, loading: false };
        return copy;
      });
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-xl font-bold">Analista Virtual</h2>
          <p className="text-sm text-muted-foreground">
            Pergunte em linguagem natural sobre os dados da org{" "}
            {currentOrg ? <Badge variant="outline">{currentOrg.name}</Badge> : <Badge variant="destructive">sem org</Badge>}
          </p>
        </div>
      </div>

      {turns.length === 0 && (
        <Card className="p-4 space-y-2">
          <div className="text-sm font-medium">Sugestões:</div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Button key={s} variant="outline" size="sm" onClick={() => ask(s)} disabled={busy}>
                {s}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <div ref={scrollRef} className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <Card className="p-3 bg-muted/40">
              <div className="text-xs text-muted-foreground mb-1">Você</div>
              <div className="text-sm">{t.question}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Analista
              </div>
              {t.loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.error && (
                <div className="flex items-start gap-2 text-destructive text-sm">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{t.error}</span>
                </div>
              )}
              {t.answer && (
                <div className="text-sm whitespace-pre-wrap">{t.answer}</div>
              )}
              {(t.rows?.length || t.sql) && !t.loading && (
                <Accordion type="single" collapsible className="mt-3">
                  {t.rows && t.rows.length > 0 && (
                    <AccordionItem value="rows">
                      <AccordionTrigger className="text-xs">
                        <BarChart3 className="h-3 w-3 mr-1" /> Ver dados ({t.rows.length})
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="overflow-x-auto max-h-80">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {Object.keys(t.rows[0]).map((k) => (
                                  <TableHead key={k} className="text-xs">{k}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {t.rows.slice(0, 100).map((r: any, idx: number) => (
                                <TableRow key={idx}>
                                  {Object.values(r).map((v: any, j: number) => (
                                    <TableCell key={j} className="text-xs">
                                      {v === null ? <span className="text-muted-foreground">—</span> :
                                       typeof v === "object" ? JSON.stringify(v) :
                                       String(v)}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                  {t.sql && (
                    <AccordionItem value="sql">
                      <AccordionTrigger className="text-xs">Ver SQL gerada</AccordionTrigger>
                      <AccordionContent>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">{t.sql}</pre>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              )}
            </Card>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte algo sobre seus dados..."
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          disabled={busy}
        />
        <Button onClick={() => ask(input)} disabled={busy || !input.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
