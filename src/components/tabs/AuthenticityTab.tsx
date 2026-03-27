import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { fmtInt, fmtPercent } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  calculateAuthenticity,
  type AuthenticityInput,
  type AuthenticityResult,
  type AuthenticityAlert,
} from "@/lib/authenticity/authenticityEngine";
import * as XLSX from "xlsx";

function ScoreGauge({ score, classification, color }: { score: number; classification: string; color: string }) {
  const colorMap: Record<string, string> = {
    accent: "text-accent",
    primary: "text-primary",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  const bgMap: Record<string, string> = {
    accent: "bg-accent",
    primary: "bg-primary",
    warning: "bg-warning",
    destructive: "bg-destructive",
  };
  return (
    <div className="card-surface p-5 space-y-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Audience Authenticity Score</p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`text-5xl font-mono font-bold ${colorMap[color] || "text-foreground"}`}>{score}</span>
        <span className="text-sm text-muted-foreground">/100</span>
      </div>
      <Badge variant={score >= 60 ? "default" : "destructive"} className="text-xs">
        {classification}
      </Badge>
      <Progress value={score} className={`h-2.5 [&>div]:${bgMap[color] || "bg-primary"}`} />
    </div>
  );
}

function AlertCard({ alert }: { alert: AuthenticityAlert }) {
  const isCritical = alert.level === "critical";
  return (
    <div className={`rounded-lg border p-3 space-y-1 ${isCritical ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5"}`}>
      <div className="flex items-center gap-2">
        <span>{isCritical ? "🔴" : "⚠️"}</span>
        <span className={`text-sm font-medium ${isCritical ? "text-destructive" : "text-warning"}`}>{alert.title}</span>
        <Badge variant={isCritical ? "destructive" : "secondary"} className="text-[10px] ml-auto">
          {isCritical ? "Crítico" : "Atenção"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{alert.description}</p>
    </div>
  );
}

function MetricsBreakdown({ result }: { result: AuthenticityResult }) {
  const metrics = [
    { label: "Viewer-to-Chat Ratio", value: `${result.viewerToChatRatio.toFixed(1)}:1`, desc: "Viewers por chatter", good: result.viewerToChatRatio < 50 },
    { label: "Engagement Rate", value: fmtPercent(result.engagementRate * 100, 2), desc: "Chatters / Viewers", good: result.engagementRate > 0.02 },
    { label: "Chat Quality", value: `${result.chatQualityScore.toFixed(0)}/100`, desc: "Consistência + qualidade", good: result.chatQualityScore > 60 },
    { label: "Spike Score", value: `${result.spikeScoreNormalized.toFixed(0)}/100`, desc: "Intensidade de picos", good: result.spikeScoreNormalized < 40 },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className="card-surface p-3 space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
          <p className={`text-lg font-mono font-semibold ${m.good ? "text-accent" : "text-destructive"}`}>{m.value}</p>
          <p className="text-[10px] text-muted-foreground">{m.desc}</p>
        </div>
      ))}
    </div>
  );
}

export function AuthenticityTab() {
  const [streamerName, setStreamerName] = useState("");
  const [platform, setPlatform] = useState("Twitch");
  const [avgViewers, setAvgViewers] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  const [streamDuration, setStreamDuration] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [uniqueChatters, setUniqueChatters] = useState(0);
  const [messagesPerMinute, setMessagesPerMinute] = useState(0);
  const [duplicateMessageRate, setDuplicateMessageRate] = useState(0);
  const [avgMessageLength, setAvgMessageLength] = useState(0);
  const [chatBurstiness, setChatBurstiness] = useState(0);
  const [chatConsistencyScore, setChatConsistencyScore] = useState(50);
  const [usernameSimilarityScore, setUsernameSimilarityScore] = useState(0);
  const [newAccountActivityRate, setNewAccountActivityRate] = useState(0);

  const input: AuthenticityInput = useMemo(() => ({
    streamerName,
    platform,
    avgViewers,
    peakViewers,
    streamDurationMinutes: streamDuration,
    totalMessages,
    uniqueChatters,
    messagesPerMinute,
    duplicateMessageRate,
    avgMessageLength,
    chatBurstiness,
    chatConsistencyScore,
    usernameSimilarityScore,
    newAccountActivityRate,
  }), [streamerName, platform, avgViewers, peakViewers, streamDuration, totalMessages, uniqueChatters, messagesPerMinute, duplicateMessageRate, avgMessageLength, chatBurstiness, chatConsistencyScore, usernameSimilarityScore, newAccountActivityRate]);

  const result = useMemo(() => calculateAuthenticity(input), [input]);

  const hasData = avgViewers > 0 || uniqueChatters > 0;

  const downloadExcel = () => {
    const rows: any[][] = [
      ["Audience Authenticity Report"],
      [""],
      ["Streamer", streamerName || "-"],
      ["Plataforma", platform],
      [""],
      ["--- Dados da Live ---"],
      ["Avg Viewers", avgViewers],
      ["Peak Viewers", peakViewers],
      ["Duração (min)", streamDuration],
      [""],
      ["--- Dados do Chat ---"],
      ["Total Mensagens", totalMessages],
      ["Chatters Únicos", uniqueChatters],
      ["Msg/Minuto", messagesPerMinute],
      ["% Mensagens Duplicadas", duplicateMessageRate],
      ["Comprimento Médio Msg", avgMessageLength],
      ["Burstiness", chatBurstiness],
      ["Consistência Chat", chatConsistencyScore],
      ["Similaridade Usernames", usernameSimilarityScore],
      ["% Contas Novas", newAccountActivityRate],
      [""],
      ["--- Resultados ---"],
      ["Authenticity Score", result.authenticityScore],
      ["Classificação", result.classification],
      ["Viewer-to-Chat Ratio", result.viewerToChatRatio.toFixed(1)],
      ["Engagement Rate", `${(result.engagementRate * 100).toFixed(2)}%`],
      ["Chat Quality Score", result.chatQualityScore.toFixed(0)],
      ["Spike Score", result.spikeScoreNormalized.toFixed(0)],
      [""],
      ["--- Alertas ---"],
      ...result.alerts.map(a => [a.level.toUpperCase(), a.title, a.description]),
      [""],
      ["--- Insights ---"],
      ...result.insights.map(i => [i]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 35 }, { wch: 25 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Authenticity");
    XLSX.writeFile(wb, `authenticity-${streamerName || "report"}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card-surface p-4 flex items-start justify-between">
        <div>
          <p className="text-xs text-primary font-medium uppercase tracking-wider">Audience Authenticity Analyzer</p>
          <p className="text-sm text-muted-foreground mt-1">
            Analise padrões de audiência e identifique sinais de engajamento artificial. Baseado em métricas de chat, viewers e comportamento.
          </p>
        </div>
        {hasData && (
          <Button variant="outline" size="sm" onClick={downloadExcel} className="shrink-0">
            📥 Exportar Excel
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Inputs */}
        <div className="lg:col-span-2 space-y-5">
          <FieldSection title="Identificação">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Streamer</label>
              <Input
                placeholder="Nome do streamer"
                value={streamerName}
                onChange={(e) => setStreamerName(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Plataforma</label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Twitch">Twitch</SelectItem>
                  <SelectItem value="YouTube">YouTube</SelectItem>
                  <SelectItem value="Kick">Kick</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FieldSection>

          <FieldSection title="Dados da Live">
            <NumberField label="Avg Viewers" value={avgViewers} onChange={setAvgViewers} step={100} />
            <NumberField label="Peak Viewers" value={peakViewers} onChange={setPeakViewers} step={100} />
            <NumberField label="Duração (min)" value={streamDuration} onChange={setStreamDuration} step={30} />
          </FieldSection>

          <FieldSection title="Dados do Chat">
            <NumberField label="Total de mensagens" value={totalMessages} onChange={setTotalMessages} step={100} />
            <NumberField label="Chatters únicos" value={uniqueChatters} onChange={setUniqueChatters} step={10} />
            <NumberField label="Mensagens por minuto" value={messagesPerMinute} onChange={setMessagesPerMinute} step={1} />
            <NumberField label="% Mensagens duplicadas" value={duplicateMessageRate} onChange={setDuplicateMessageRate} step={1} max={100} suffix="%" />
            <NumberField label="Comprimento médio (chars)" value={avgMessageLength} onChange={setAvgMessageLength} step={1} />
            <NumberField label="Burstiness (0-100)" value={chatBurstiness} onChange={setChatBurstiness} step={5} max={100} />
          </FieldSection>

          <FieldSection title="Análise Comportamental">
            <NumberField label="Consistência do chat (0-100)" value={chatConsistencyScore} onChange={setChatConsistencyScore} step={5} max={100} />
            <NumberField label="Similaridade de usernames (0-100)" value={usernameSimilarityScore} onChange={setUsernameSimilarityScore} step={5} max={100} />
            <NumberField label="% Contas novas ativas" value={newAccountActivityRate} onChange={setNewAccountActivityRate} step={5} max={100} suffix="%" />
          </FieldSection>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-3 space-y-5">
          {hasData ? (
            <>
              {/* Score + Name */}
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <ScoreGauge
                    score={result.authenticityScore}
                    classification={result.classification}
                    color={result.classificationColor}
                  />
                </div>
              </div>

              {/* Metrics Breakdown */}
              <MetricsBreakdown result={result} />

              {/* Alerts */}
              {result.alerts.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                    Alertas de Risco ({result.alerts.length})
                  </h3>
                  {result.alerts.map((alert, i) => (
                    <AlertCard key={i} alert={alert} />
                  ))}
                </div>
              )}

              {result.alerts.length === 0 && (
                <div className="card-surface p-4 text-center">
                  <span className="text-accent text-sm">✅ Nenhum alerta de risco detectado</span>
                </div>
              )}

              {/* Insights */}
              {result.insights.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Insights</h3>
                  <div className="space-y-2">
                    {result.insights.map((insight, i) => (
                      <div key={i} className="card-surface p-3 flex items-start gap-2">
                        <span className="text-primary mt-0.5">💡</span>
                        <p className="text-sm text-foreground">{insight}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Visual: Viewers vs Chatters bar */}
              <div className="card-surface p-4 space-y-3">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Viewers vs Chatters</h3>
                {(() => {
                  const maxVal = Math.max(avgViewers, uniqueChatters, 1);
                  return (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Viewers</span>
                          <span className="font-mono text-foreground">{fmtInt(avgViewers)}</span>
                        </div>
                        <div className="h-3 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(avgViewers / maxVal) * 100}%` }} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Chatters únicos</span>
                          <span className="font-mono text-foreground">{fmtInt(uniqueChatters)}</span>
                        </div>
                        <div className="h-3 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(uniqueChatters / maxVal) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Composition breakdown */}
              <div className="card-surface p-4 space-y-3">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Composição do Score</h3>
                {[
                  { label: "Engajamento", value: Math.min(result.engagementRate * 100, 100) * 0.30, max: 30, pct: Math.min(result.engagementRate * 100, 100) },
                  { label: "Qualidade Chat", value: result.chatQualityScore * 0.25, max: 25, pct: result.chatQualityScore },
                  { label: "Originalidade Msgs", value: (100 - duplicateMessageRate) * 0.20, max: 20, pct: 100 - duplicateMessageRate },
                  { label: "Estabilidade Audiência", value: (100 - result.spikeScoreNormalized) * 0.15, max: 15, pct: 100 - result.spikeScoreNormalized },
                  { label: "Diversidade Usernames", value: (100 - usernameSimilarityScore) * 0.10, max: 10, pct: 100 - usernameSimilarityScore },
                ].map((item) => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-mono text-foreground">{item.value.toFixed(1)}/{item.max}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(item.value / item.max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="card-surface p-8 text-center text-muted-foreground text-sm">
              Preencha os dados de audiência e chat para ver a análise de autenticidade.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
