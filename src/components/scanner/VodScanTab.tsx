import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScanLine, Play, RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { enqueueJob, getQueue } from "@/lib/scanner-api";

const STATUS_META: Record<string, { icon: typeof Clock; cls: string }> = {
  pending: { icon: Clock, cls: "bg-muted text-muted-foreground" },
  running: { icon: RefreshCw, cls: "bg-primary/20 text-primary" },
  completed: { icon: CheckCircle2, cls: "bg-green-500/20 text-green-600" },
  failed: { icon: AlertCircle, cls: "bg-destructive/20 text-destructive" },
  cancelled: { icon: AlertCircle, cls: "bg-muted text-muted-foreground line-through" },
};

function fmtHMS(secs: number) {
  if (!secs || !isFinite(secs)) return "00:00:00";
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function extractStreamerFromUrl(url: string): string {
  // só consegue extrair quando a URL é do tipo twitch.tv/<login>/videos/...
  const m = url.match(/twitch\.tv\/([^/?#]+)\/videos?/i);
  if (!m) return "";
  const login = m[1];
  // bloqueia matches em twitch.tv/videos/<id>
  if (/^\d+$/.test(login) || login.toLowerCase() === "videos") return "";
  return login;
}

function extractVodId(url: string): string {
  const m = url.match(/twitch\.tv\/videos?\/(\d+)/i);
  return m ? m[1] : "";
}

export function VodScanTab() {
  const { toast } = useToast();
  const [vodUrl, setVodUrl] = useState("");
  const [streamer, setStreamer] = useState("");
  const [interval, setIntervalSec] = useState("30");
  const [provider, setProvider] = useState("gemini");
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadJobs = async () => {
    try {
      const d = await getQueue();
      const list = (d.jobs || []).filter((j: any) => j.job_type === "vod_process");
      setJobs(list);
    } catch {
      setJobs([]);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadJobs().finally(() => setLoading(false));
  }, []);

  const hasActive = useMemo(
    () => jobs.some(j => j.status === "pending" || j.status === "running"),
    [jobs]
  );

  useEffect(() => {
    if (!hasActive) return;
    const id = window.setInterval(loadJobs, 3000);
    return () => window.clearInterval(id);
  }, [hasActive]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vodUrl.trim() || !extractVodId(vodUrl)) {
      toast({ title: "URL inválida", description: "Use uma URL no formato twitch.tv/videos/12345678.", variant: "destructive" });
      return;
    }
    const login = streamer.trim() || extractStreamerFromUrl(vodUrl);
    if (!login) {
      toast({
        title: "Streamer obrigatório",
        description: "URLs do tipo /videos/<id> não contêm o login. Preencha o campo Streamer.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await enqueueJob({
        job_type: "vod_process",
        streamer_login: login,
        platform: "twitch",
        metadata: {
          vod_url: vodUrl.trim(),
          vod_id: extractVodId(vodUrl),
          interval: Number(interval),
          provider,
          progress_percent: 0,
          current_step: "queued",
        },
      });
      toast({ title: "Job enfileirado", description: "O scan local foi adicionado à fila." });
      setVodUrl("");
      setStreamer("");
      await loadJobs();
    } catch (err: any) {
      toast({ title: "Erro", description: err?.message || "Falha ao enfileirar.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <ScanLine className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-mono uppercase tracking-wider">VOD Scan Local</h3>
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <Input
            className="md:col-span-5"
            placeholder="https://www.twitch.tv/videos/..."
            value={vodUrl}
            onChange={e => setVodUrl(e.target.value)}
            required
          />
          <Input
            className="md:col-span-2"
            placeholder="Streamer (opcional)"
            value={streamer}
            onChange={e => setStreamer(e.target.value)}
          />
          <Select value={interval} onValueChange={setIntervalSec}>
            <SelectTrigger className="md:col-span-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10s</SelectItem>
              <SelectItem value="30">30s</SelectItem>
              <SelectItem value="60">60s</SelectItem>
              <SelectItem value="120">120s</SelectItem>
            </SelectContent>
          </Select>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="md:col-span-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini">Gemini</SelectItem>
              <SelectItem value="claude">Claude</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={submitting} className="md:col-span-1 gap-1.5">
            <Play className="h-3.5 w-3.5" />
            Scan
          </Button>
        </form>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Jobs de Scan Local</h4>
          <Button variant="ghost" size="sm" onClick={loadJobs} className="h-7 gap-1.5 text-xs">
            <RefreshCw className="h-3 w-3" /> Atualizar
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum job de VOD Scan Local ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Streamer</TableHead>
                <TableHead>VOD</TableHead>
                <TableHead>Provedor</TableHead>
                <TableHead className="w-[200px]">Progresso</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Criado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j: any) => {
                const meta = j.metadata || {};
                const stMeta = STATUS_META[j.status] || STATUS_META.pending;
                const Icon = stMeta.icon;
                const pct = Math.max(0, Math.min(100, Number(meta.progress_percent) || 0));
                const result = meta.result;
                return (
                  <TableRow key={j.id}>
                    <TableCell>
                      <Badge className={`text-[10px] gap-1 ${stMeta.cls}`}>
                        <Icon className={`h-3 w-3 ${j.status === "running" ? "animate-spin" : ""}`} />
                        {j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{j.streamer_login}</TableCell>
                    <TableCell className="text-xs">
                      {meta.vod_url ? (
                        <a
                          href={meta.vod_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline truncate inline-block max-w-[200px] align-middle"
                        >
                          {meta.vod_url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{meta.provider || "—"}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Progress value={pct} className="h-2" />
                        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                          <span>{meta.current_step || "—"}</span>
                          <span>{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {result ? (
                        <span>
                          {Number(result.casino_percent ?? 0).toFixed(1)}% · {fmtHMS(Number(result.casino_seconds ?? 0))}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(j.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
