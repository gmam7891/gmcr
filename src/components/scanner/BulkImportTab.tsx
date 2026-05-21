import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Upload, CheckCircle2, Search, Trash2, Play,
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";

interface ParsedGame {
  game_name: string;
  provider: string;
  url: string;
  id_raw?: string;
  selected: boolean;
  status?: "pending" | "processing" | "done" | "error" | "duplicate";
  error?: string;
}

const PROVIDER_PATTERNS: Record<string, RegExp[]> = {
  "PG Soft": [/pg\s*soft/i, /pgsoft/i],
  "Pragmatic Play": [/pragmatic/i, /pragma/i],
  "Games Global": [/games\s*global/i, /slingshot/i, /jftw/i, /microgaming/i],
  "Hacksaw Gaming": [/hacksaw/i],
  "NoLimit City": [/nolimit/i, /no\s*limit/i],
  "Evolution": [/evolution/i, /evo\s*play/i],
  "Endorphina": [/endorphina/i],
  "Amusnet": [/amusnet/i, /egt/i],
  "Tada Gaming": [/tada/i],
  "Caleta": [/caleta/i],
  "Relax Gaming": [/relax/i],
  "Play'n GO": [/play.n.go/i, /playngo/i],
  "NetEnt": [/netent/i],
  "Red Tiger": [/red\s*tiger/i],
  "Blueprint Gaming": [/blueprint/i],
  "Big Time Gaming": [/big\s*time/i, /btg/i],
  "Push Gaming": [/push\s*gaming/i],
  "Yggdrasil": [/yggdrasil/i],
  "Thunderkick": [/thunderkick/i],
  "Spinomenal": [/spinomenal/i],
};


function parseRawText(raw: string): ParsedGame[] {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const games: ParsedGame[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Skip headers/separators
    if (/^[-=#+*]{3,}/.test(line) || /^(game|nome|name|title|provider|id)\b/i.test(line)) continue;

    // Try JSON-like: {"name": "...", "provider": "..."}
    if (line.startsWith("{")) {
      try {
        const obj = JSON.parse(line);
        const name = obj.name || obj.game_name || obj.title || obj.gameName || "";
        const prov = obj.provider || obj.provider_name || obj.providerName || obj.studio || "";
        const url = obj.url || obj.source_url || obj.demo_url || "";
        if (name) {
          const key = `${name.toLowerCase()}|${prov.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            games.push({ game_name: name, provider: prov, url, id_raw: obj.id, selected: true });
          }
        }
        continue;
      } catch { /* fall through */ }
    }

    // Try CSV/TSV: "Game Name, Provider, URL" or "Game Name\tProvider\tURL"
    const sep = line.includes("\t") ? "\t" : ",";
    const parts = line.split(sep).map(p => p.trim().replace(/^["']|["']$/g, ""));

    if (parts.length >= 2) {
      const [gameName, providerRaw, url] = parts;
      if (gameName && providerRaw) {
        const key = `${gameName.toLowerCase()}|${providerRaw.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          games.push({ game_name: gameName, provider: providerRaw, url: url || "", selected: true });
        }
        continue;
      }
    }

    // Try "Game Name - Provider" or "Game Name | Provider" or "Game Name (Provider)"
    let match = line.match(/^(.+?)\s*[-|–—]\s*(.+)$/);
    if (!match) match = line.match(/^(.+?)\s*\((.+?)\)\s*$/);

    if (match) {
      const [, gameName, providerRaw] = match;
      const key = `${gameName.trim().toLowerCase()}|${providerRaw.trim().toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        games.push({ game_name: gameName.trim(), provider: providerRaw.trim(), url: "", selected: true });
      }
      continue;
    }

    // Auto-detect provider from the line
    let detectedProvider = "";
    for (const [name, patterns] of Object.entries(PROVIDER_PATTERNS)) {
      if (patterns.some(p => p.test(line))) {
        detectedProvider = name;
        break;
      }
    }

    // Single game name per line (no provider info)
    if (line.length > 2 && line.length < 200) {
      const gameName = detectedProvider
        ? line.replace(new RegExp(detectedProvider, "gi"), "").replace(/[-|–—()]/g, "").trim()
        : line;
      if (gameName) {
        const key = `${gameName.toLowerCase()}|${detectedProvider.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          games.push({ game_name: gameName, provider: detectedProvider || "Unknown", url: "", selected: true });
        }
      }
    }
  }

  return games;
}

export function BulkImportTab({ onComplete }: { onComplete?: () => void }) {
  const { t } = useLanguage();
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParsedGame[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<"input" | "review" | "importing" | "done">("input");

  const handleParse = () => {
    if (!rawText.trim()) {
      toast.error("Cole os dados dos jogos na área de texto");
      return;
    }
    const results = parseRawText(rawText);
    if (results.length === 0) {
      toast.error("Nenhum jogo identificado. Verifique o formato dos dados.");
      return;
    }
    setParsed(results);
    setStep("review");
    toast.success(`${results.length} jogos identificados`);
  };

  const toggleSelect = (i: number) => {
    setParsed(prev => prev.map((g, idx) => idx === i ? { ...g, selected: !g.selected } : g));
  };

  const toggleAll = (checked: boolean) => {
    setParsed(prev => prev.map(g => ({ ...g, selected: checked })));
  };

  const removeGame = (i: number) => {
    setParsed(prev => prev.filter((_, idx) => idx !== i));
  };

  const selectedCount = parsed.filter(g => g.selected).length;
  const doneCount = parsed.filter(g => g.status === "done").length;
  const errorCount = parsed.filter(g => g.status === "error").length;
  const dupCount = parsed.filter(g => g.status === "duplicate").length;

  const handleImport = async () => {
    const toImport = parsed.filter(g => g.selected && g.status !== "done" && g.status !== "duplicate");
    if (toImport.length === 0) {
      toast.error("Nenhum jogo selecionado para importar");
      return;
    }

    setStep("importing");
    setImporting(true);
    setProgress(0);

    try {
      const { data, error } = await supabase.functions.invoke("game-scrapper", {
        body: {
          action: "bulk_import",
          games: toImport.map(g => ({
            game_name: g.game_name,
            provider: g.provider,
            url: g.url,
          })),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const results = data?.results || [];
      setParsed(prev => prev.map(g => {
        const result = results.find((r: any) =>
          r.game_name.toLowerCase() === g.game_name.toLowerCase() &&
          r.provider.toLowerCase() === g.provider.toLowerCase()
        );
        if (!result) return g;
        return {
          ...g,
          status: result.status as any,
          error: result.error,
        };
      }));

      const imported = results.filter((r: any) => r.status === "done").length;
      const dups = results.filter((r: any) => r.status === "duplicate").length;
      const errors = results.filter((r: any) => r.status === "error").length;

      toast.success(`Importação concluída: ${imported} novos, ${dups} duplicados, ${errors} erros`);
      setStep("done");
      onComplete?.();
    } catch (e: any) {
      toast.error(e.message || "Erro na importação");
    }

    setImporting(false);
    setProgress(100);
  };

  const handleReset = () => {
    setRawText("");
    setParsed([]);
    setStep("input");
    setProgress(0);
  };

  return (
    <div className="space-y-4">
      {step === "input" && (
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            {t("scan.bulk_title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("scan.bulk_desc")}
          </p>

          <Textarea
            placeholder={t("scan.bulk_placeholder")}
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            className="min-h-[250px] font-mono text-xs"
          />

          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              {t("scan.bulk_formats")}
            </p>
            <Button onClick={handleParse} disabled={!rawText.trim()} size="sm">
              <Search className="h-4 w-4 mr-2" />
              {t("scan.bulk_parse")}
            </Button>
          </div>
        </Card>
      )}

      {(step === "review" || step === "importing" || step === "done") && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              {t("scan.bulk_review")} ({parsed.length} {t("scan.bulk_games_found")})
            </h3>
            <div className="flex gap-2">
              {step === "done" && (
                <Button variant="outline" size="sm" onClick={handleReset}>
                  {t("scan.bulk_new_import")}
                </Button>
              )}
              {step === "review" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setStep("input")}>
                    {t("scan.bulk_back")}
                  </Button>
                  <Button size="sm" onClick={handleImport} disabled={selectedCount === 0}>
                    <Play className="h-4 w-4 mr-2" />
                    {t("scan.bulk_confirm")} ({selectedCount})
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Stats bar */}
          {(step === "importing" || step === "done") && (
            <div className="space-y-2">
              <Progress value={progress} />
              <div className="flex gap-4 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>✅ {doneCount} {t("scan.bulk_imported")}</span>
                <span>🔄 {dupCount} {t("scan.bulk_duplicates")}</span>
                <span>❌ {errorCount} {t("scan.bulk_errors")}</span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="border border-border rounded-lg overflow-auto max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={parsed.every(g => g.selected)}
                      onCheckedChange={(c) => toggleAll(!!c)}
                      disabled={step !== "review"}
                    />
                  </TableHead>
                  <TableHead className="text-[10px] uppercase">{t("scan.bulk_col_game")}</TableHead>
                  <TableHead className="text-[10px] uppercase">{t("scan.bulk_col_provider")}</TableHead>
                  <TableHead className="text-[10px] uppercase">URL</TableHead>
                  <TableHead className="text-[10px] uppercase">Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.map((g, i) => (
                  <TableRow key={i} className={!g.selected ? "opacity-50" : ""}>
                    <TableCell>
                      <Checkbox
                        checked={g.selected}
                        onCheckedChange={() => toggleSelect(i)}
                        disabled={step !== "review"}
                      />
                    </TableCell>
                    <TableCell className="text-xs font-medium">{g.game_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{g.provider || "?"}</Badge>
                    </TableCell>
                    <TableCell className="text-[10px] text-muted-foreground max-w-[200px] truncate">
                      {g.url || "—"}
                    </TableCell>
                    <TableCell>
                      {g.status === "done" && <Badge className="bg-primary/20 text-primary text-[10px]">✅ OK</Badge>}
                      {g.status === "duplicate" && <Badge variant="secondary" className="text-[10px]">🔄 Dup</Badge>}
                      {g.status === "error" && (
                        <Badge variant="destructive" className="text-[10px]" title={g.error}>❌ Erro</Badge>
                      )}
                      {g.status === "processing" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                      {!g.status && <span className="text-[10px] text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {step === "review" && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeGame(i)}>
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {importing && (
        <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("scan.bulk_processing")}
        </div>
      )}
    </div>
  );
}
