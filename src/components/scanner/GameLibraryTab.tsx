import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2, BookOpen, Trash2, ExternalLink, CheckCircle2, XCircle, Clock, Zap,
  ChevronDown, ChevronUp, Upload, PlayCircle, Camera, Brain, FileSpreadsheet, RefreshCw,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { BulkImportTab } from "./BulkImportTab";
import { ScreenshotTrainingTab } from "./ScreenshotTrainingTab";
import { learnGame } from "@/lib/intelligent-agent-api";
import * as XLSX from "xlsx";

interface VisualDNA {
  detected_game_name?: string;
  provider_canonical?: string;
  unique_visual_traits?: string[];
  hud_layout?: Record<string, string>;
  color_palette?: string[];
  detection_keywords?: string[];
  volatility_indicators?: string[];
  browser_title_pattern?: string;
  parse_error?: boolean;
}

interface LibraryEntry {
  id: string;
  game_name: string;
  provider_name: string;
  provider_slug: string;
  source_url: string | null;
  visual_dna: VisualDNA;
  logo_url: string | null;
  hud_url: string | null;
  paytable_url: string | null;
  training_status: string;
  error_message: string | null;
  metadata: any;
  created_at: string;
  agent_keywords?: string[] | null;
  agent_visual_markers?: string[] | null;
  agent_confidence_threshold?: number | null;
  agent_times_identified?: number | null;
  agent_times_corrected?: number | null;
  agent_average_confidence?: number | null;
  agent_learned_at?: string | null;
}

const ELITE_PROVIDERS = [
  { slug: "pg_soft", name: "PG Soft", color: "from-yellow-500 to-orange-500" },
  { slug: "games_global", name: "Games Global", color: "from-blue-500 to-indigo-500" },
  { slug: "endorphina", name: "Endorphina", color: "from-red-500 to-pink-500" },
  { slug: "pragmatic", name: "Pragmatic Play", color: "from-cyan-500 to-blue-500" },
  { slug: "amusnet", name: "Amusnet", color: "from-purple-500 to-violet-500" },
  { slug: "nolimit", name: "NoLimit City", color: "from-gray-600 to-gray-800" },
  { slug: "tada", name: "Tada Gaming", color: "from-pink-500 to-rose-500" },
  { slug: "caleta", name: "Caleta", color: "from-green-500 to-emerald-500" },
  { slug: "hacksaw", name: "Hacksaw Gaming", color: "from-amber-500 to-yellow-600" },
  { slug: "evolution", name: "Evolution", color: "from-orange-500 to-red-500" },
];

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  trained: { icon: CheckCircle2, color: "text-green-500", label: "Treinado" },
  processing: { icon: Loader2, color: "text-blue-500", label: "Processando" },
  pending: { icon: Clock, color: "text-yellow-500", label: "Pendente" },
  failed: { icon: XCircle, color: "text-red-500", label: "Falhou" },
};

export function GameLibraryTab() {
  const { t } = useLanguage();
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [gameUrl, setGameUrl] = useState("");
  const [gameName, setGameName] = useState("");
  const [training, setTraining] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batchTraining, setBatchTraining] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentGame: "" });
  const [batchResults, setBatchResults] = useState({ trained: 0, failed: 0 });
  const [learningId, setLearningId] = useState<string | null>(null);
  const [filterProvider, setFilterProvider] = useState<string>("all");
  const [retrainId, setRetrainId] = useState<string | null>(null);
  const [retrainUrl, setRetrainUrl] = useState("");
  const [retrainBusy, setRetrainBusy] = useState(false);

  const providerOptions = Array.from(
    new Map(library.map(e => [e.provider_slug, e.provider_name])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const filteredLibrary = filterProvider === "all"
    ? library
    : library.filter(e => e.provider_slug === filterProvider);

  const handleLearn = async (id: string) => {
    setLearningId(id);
    try {
      const res = await learnGame(id);
      toast.success(`🧠 Agente aprendeu: ${res.keywords_count} keywords, ${res.markers_count} markers`);
      fetchLibrary();
    } catch (e: any) {
      toast.error(e.message || "Falha ao aprender");
    }
    setLearningId(null);
  };

  const fetchLibrary = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("game-scrapper", {
        body: { action: "list_library" },
      });
      if (error) throw error;
      setLibrary(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load library");
    }
    setLoading(false);
  };

  useEffect(() => { fetchLibrary(); }, []);

  const handleTrain = async () => {
    if (!selectedProvider || !gameUrl) {
      toast.error("Selecione uma provedora e insira a URL do jogo");
      return;
    }
    setTraining(true);
    try {
      const { data, error } = await supabase.functions.invoke("game-scrapper", {
        body: {
          action: "scrape_and_train",
          source_url: gameUrl,
          provider_slug: selectedProvider,
          game_name_hint: gameName || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`✅ ${data.game_name} — Treinado com Sucesso!`);
      setGameUrl("");
      setGameName("");
      setSelectedProvider(null);
      fetchLibrary();
    } catch (e: any) {
      toast.error(e.message || "Training failed");
    }
    setTraining(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remover este jogo da biblioteca?")) return;
    try {
      const { error } = await supabase.functions.invoke("game-scrapper", {
        body: { action: "delete_entry", id },
      });
      if (error) throw error;
      toast.success("Removido");
      fetchLibrary();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const trainedCount = library.filter(e => e.training_status === "trained").length;
  const processingCount = library.filter(e => e.training_status === "processing").length;
  const pendingCount = library.filter(e => e.training_status === "pending" || e.training_status === "failed").length;

  const handleBatchTrain = async () => {
    const pendingGames = library.filter(e => e.training_status === "pending" || e.training_status === "failed");
    if (pendingGames.length === 0) {
      toast.error("Nenhum jogo pendente para treinar");
      return;
    }
    setBatchTraining(true);
    setBatchProgress({ current: 0, total: pendingGames.length, currentGame: "" });
    setBatchResults({ trained: 0, failed: 0 });

    let trained = 0;
    let failed = 0;

    for (let i = 0; i < pendingGames.length; i++) {
      const game = pendingGames[i];
      setBatchProgress({ current: i + 1, total: pendingGames.length, currentGame: game.game_name });

      try {
        const { data, error } = await supabase.functions.invoke("game-scrapper", {
          body: { action: "train_single", id: game.id },
        });
        if (error) throw error;
        if (data?.status === "trained") {
          trained++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      setBatchResults({ trained, failed });
    }

    setBatchTraining(false);
    toast.success(`Treinamento concluído: ${trained} treinados, ${failed} erros`);
    fetchLibrary();
  };

  return (
    <Tabs defaultValue="library" className="space-y-4">
      <TabsList className="bg-secondary/50 border border-border p-1">
        <TabsTrigger value="library" className="text-xs font-mono uppercase tracking-wider px-3 py-1.5 flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          {t("scan.lib_tab")}
        </TabsTrigger>
        <TabsTrigger value="bulk" className="text-xs font-mono uppercase tracking-wider px-3 py-1.5 flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
          <Upload className="h-3.5 w-3.5" />
          {t("scan.bulk_tab")}
        </TabsTrigger>
        <TabsTrigger value="screenshots" className="text-xs font-mono uppercase tracking-wider px-3 py-1.5 flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
          <Camera className="h-3.5 w-3.5" />
          Treinar com Prints
        </TabsTrigger>
      </TabsList>

      <TabsContent value="library">
      <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{library.length}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("scan.lib_total")}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-primary">{trainedCount}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("scan.lib_trained")}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-accent-foreground">{processingCount}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("scan.lib_processing")}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{new Set(library.map(e => e.provider_slug)).size}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("scan.lib_providers")}</p>
        </Card>
      </div>

      {/* Batch Train Button */}
      {pendingCount > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-primary" />
                Treinar Todos Pendentes
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {pendingCount} jogos aguardando treinamento de Visual DNA via IA
              </p>
            </div>
            <Button onClick={handleBatchTrain} disabled={batchTraining} size="sm">
              {batchTraining ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Treinando...
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4 mr-2" />
                  Treinar ({pendingCount})
                </>
              )}
            </Button>
          </div>
          {batchTraining && (
            <div className="space-y-2">
              <Progress value={(batchProgress.current / batchProgress.total) * 100} />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{batchProgress.current}/{batchProgress.total} — {batchProgress.currentGame}</span>
                <span>✅ {batchResults.trained} | ❌ {batchResults.failed}</span>
              </div>
            </div>
          )}
        </Card>
      )}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          {t("scan.lib_quick_import")}
        </h3>

        {/* Provider Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {ELITE_PROVIDERS.map(p => (
            <button
              key={p.slug}
              onClick={() => setSelectedProvider(selectedProvider === p.slug ? null : p.slug)}
              className={`relative rounded-lg border p-3 text-center transition-all text-xs font-medium ${
                selectedProvider === p.slug
                  ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30"
                  : "border-border bg-secondary/30 text-foreground hover:border-primary/50"
              }`}
            >
              <div className={`h-1 w-full rounded-full bg-gradient-to-r ${p.color} mb-2`} />
              {p.name}
              {selectedProvider === p.slug && (
                <div className="absolute -top-1 -right-1 h-3 w-3 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* URL Input */}
        {selectedProvider && (
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                placeholder={t("scan.lib_game_name_hint")}
                value={gameName}
                onChange={e => setGameName(e.target.value)}
              />
              <Input
                placeholder={t("scan.lib_game_url")}
                value={gameUrl}
                onChange={e => setGameUrl(e.target.value)}
              />
            </div>
            <Button onClick={handleTrain} disabled={training || !gameUrl} size="sm">
              {training ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t("scan.lib_training")}
                </>
              ) : (
                <>
                  <BookOpen className="h-4 w-4 mr-2" />
                  {t("scan.lib_start_training")}
                </>
              )}
            </Button>
          </div>
        )}
      </Card>

      {/* Library List */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {t("scan.lib_title")} ({filteredLibrary.length}{filterProvider !== "all" ? ` / ${library.length}` : ""})
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">Todas as provedoras</option>
              {providerOptions.map(([slug, name]) => (
                <option key={slug} value={slug}>{name}</option>
              ))}
            </select>
            {filterProvider !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => setFilterProvider("all")} className="h-8 px-2 text-xs">
                Limpar
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filteredLibrary.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t("scan.lib_empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredLibrary.map(entry => {
              const status = STATUS_CONFIG[entry.training_status] || STATUS_CONFIG.pending;
              const StatusIcon = status.icon;
              const isExpanded = expandedId === entry.id;
              const dna = entry.visual_dna || {};

              return (
                <div key={entry.id} className="border border-border rounded-lg overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-secondary/20 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon className={`h-4 w-4 ${status.color} ${entry.training_status === "processing" ? "animate-spin" : ""}`} />
                      <div>
                        <span className="text-sm font-medium text-foreground">{entry.game_name}</span>
                        <Badge variant="outline" className="ml-2 text-[10px]">{entry.provider_name}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{status.label}</Badge>
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                      {/* Visual DNA */}
                      {dna.unique_visual_traits && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">DNA Visual</p>
                          <ul className="space-y-1">
                            {dna.unique_visual_traits.map((trait: string, i: number) => (
                              <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                                <span className="text-primary mt-0.5">•</span>
                                {trait}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Color Palette */}
                      {dna.color_palette && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Paleta</p>
                          <div className="flex gap-1">
                            {dna.color_palette.map((c: string, i: number) => (
                              <div
                                key={i}
                                className="h-6 w-6 rounded border border-border"
                                style={{ backgroundColor: c }}
                                title={c}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Detection Keywords */}
                      {dna.detection_keywords && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Keywords</p>
                          <div className="flex flex-wrap gap-1">
                            {dna.detection_keywords.map((kw: string, i: number) => (
                              <Badge key={i} variant="secondary" className="text-[10px]">{kw}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* HUD Layout */}
                      {dna.hud_layout && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">HUD Layout</p>
                          <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                            {Object.entries(dna.hud_layout).map(([k, v]) => (
                              <div key={k}><span className="text-foreground">{k}:</span> {String(v)}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Screenshots */}
                      <div className="flex gap-2">
                        {entry.logo_url && (
                          <a href={entry.logo_url} target="_blank" rel="noreferrer" className="text-[10px] text-primary flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> Logo
                          </a>
                        )}
                        {entry.hud_url && (
                          <a href={entry.hud_url} target="_blank" rel="noreferrer" className="text-[10px] text-primary flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> HUD
                          </a>
                        )}
                        {entry.paytable_url && (
                          <a href={entry.paytable_url} target="_blank" rel="noreferrer" className="text-[10px] text-primary flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> Paytable
                          </a>
                        )}
                      </div>

                      {/* Error */}
                      {entry.error_message && (
                        <p className="text-xs text-destructive">{entry.error_message}</p>
                      )}

                      {/* Agente IA */}
                      <div className="border-t border-border pt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Brain className="h-3 w-3 text-primary" /> Agente IA
                            {entry.agent_learned_at && (
                              <Badge variant="outline" className="text-[9px] ml-1">
                                {(entry.agent_keywords?.length || 0)} kw · {(entry.agent_visual_markers?.length || 0)} mk
                              </Badge>
                            )}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px]"
                            disabled={learningId === entry.id || entry.training_status !== "trained"}
                            onClick={() => handleLearn(entry.id)}
                          >
                            {learningId === entry.id ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <Brain className="h-3 w-3 mr-1" />
                            )}
                            {entry.agent_learned_at ? "Re-aprender" : "Aprender"}
                          </Button>
                        </div>
                        {entry.agent_learned_at && (
                          <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-muted-foreground">
                            <div>Identificações: <span className="text-foreground">{entry.agent_times_identified || 0}</span></div>
                            <div>Correções: <span className="text-destructive">{entry.agent_times_corrected || 0}</span></div>
                            <div>Confiança média: <span className="text-primary">{((Number(entry.agent_average_confidence) || 0) * 100).toFixed(0)}%</span></div>
                          </div>
                        )}
                        {entry.agent_keywords && entry.agent_keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {entry.agent_keywords.slice(0, 12).map((k, i) => (
                              <Badge key={i} variant="secondary" className="text-[9px]">{k}</Badge>
                            ))}
                            {entry.agent_keywords.length > 12 && (
                              <Badge variant="outline" className="text-[9px]">+{entry.agent_keywords.length - 12}</Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(entry.id)}>
                          <Trash2 className="h-3 w-3 mr-1" /> Remover
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
      </TabsContent>

      <TabsContent value="bulk">
        <BulkImportTab onComplete={fetchLibrary} />
      </TabsContent>

      <TabsContent value="screenshots">
        <ScreenshotTrainingTab onTrained={fetchLibrary} />
      </TabsContent>
    </Tabs>
  );
}
