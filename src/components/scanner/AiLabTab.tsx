import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Upload, Loader2, Sparkles, Save, AlertTriangle, CheckCircle2, FlaskConical, BookOpen } from "lucide-react";
import { GameLibraryTab } from "./GameLibraryTab";

interface VisionResult {
  game: string | null;
  provider: string;
  category: string;
  confidence: number;
  balance: string | null;
  bet_amount: string | null;
  visual_elements: string[];
  bonus_hud: boolean;
  free_spins_active: boolean;
  big_win_banner: boolean;
  evidence: string;
  parse_error?: boolean;
}

function VisionPlayground() {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [rawJson, setRawJson] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editGame, setEditGame] = useState("");
  const [editProvider, setEditProvider] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Envie um arquivo de imagem (PNG, JPG, WEBP)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx 10MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
      setResult(null);
      setRawJson("");
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const analyze = async () => {
    if (!imageDataUrl) {
      toast.error("Faça upload de uma imagem primeiro");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-vision-test", {
        body: { action: "test", image_data_url: imageDataUrl, persist_snapshot: true },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha na análise");
      setResult(data.parsed);
      setRawJson(data.raw || JSON.stringify(data.parsed, null, 2));
      setElapsedMs(data.elapsed_ms || 0);
      if (data.parsed?.game) setEditGame(data.parsed.game);
      if (data.parsed?.provider && data.parsed.provider !== "Unknown") setEditProvider(data.parsed.provider);
      if (data.parsed?.parse_error) {
        toast.warning("A IA respondeu mas o JSON precisou ser reparado. Veja o JSON bruto abaixo.");
      } else if (data.parsed?.category === "not_game") {
        toast.info("Imagem analisada — nenhum elemento de iGaming detectado.");
      } else {
        toast.success(
          data.snapshot_id
            ? `Análise concluída em ${data.elapsed_ms}ms • snapshot salvo`
            : `Análise concluída em ${data.elapsed_ms}ms`
        );
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao chamar a IA");
    } finally {
      setLoading(false);
    }
  };

  const saveAsDna = async () => {
    if (!editGame.trim() || !editProvider.trim()) {
      toast.error("Preencha jogo e provedora");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-vision-test", {
        body: {
          action: "save_dna",
          game_name: editGame.trim(),
          provider_name: editProvider.trim(),
          visual_dna: result,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao salvar");
      toast.success(`DNA visual de "${editGame}" salvo na biblioteca`);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar DNA");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setImageDataUrl(null);
    setResult(null);
    setRawJson("");
    setEditGame("");
    setEditProvider("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isGameDetected = result && !result.parse_error && result.category !== "not_game" && result.game;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Upload column */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Teste de Visão de IA</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Faça upload de um print/frame para validar se a IA identifica corretamente o jogo, provedora e elementos visuais (saldo, HUD, botão de spin).
        </p>

        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-md cursor-pointer transition-colors min-h-[240px] flex items-center justify-center ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
        >
          {imageDataUrl ? (
            <img src={imageDataUrl} alt="preview" className="max-h-[320px] w-auto rounded-md" />
          ) : (
            <div className="text-center p-6">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Arraste uma imagem ou clique para selecionar
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">PNG, JPG, WEBP — máx 10MB</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={analyze} disabled={!imageDataUrl || loading} className="flex-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Analisando..." : "Analisar com IA"}
          </Button>
          {imageDataUrl && (
            <Button variant="outline" onClick={reset} disabled={loading}>
              Limpar
            </Button>
          )}
        </div>
      </Card>

      {/* Result column */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Veredito da IA</h3>
          {elapsedMs > 0 && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {elapsedMs}ms
            </Badge>
          )}
        </div>

        {!result && !loading && (
          <div className="text-center py-12 text-xs text-muted-foreground">
            Aguardando análise...
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
            <p className="text-xs text-muted-foreground mt-2">IA analisando frame...</p>
          </div>
        )}

        {result && result.parse_error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 text-xs text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>A IA não retornou JSON válido. Veja resposta bruta abaixo.</span>
          </div>
        )}

        {result && !result.parse_error && result.category === "not_game" && (
          <div className="bg-muted/40 border border-border rounded-md p-3 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <span>Não foi possível identificar elementos de iGaming nesta imagem. Verifique a resolução ou a provedora.</span>
          </div>
        )}

        {isGameDetected && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-secondary/50 rounded-md p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Jogo</div>
                <div className="text-sm font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  {result.game}
                </div>
              </div>
              <div className="bg-secondary/50 rounded-md p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Provedora</div>
                <div className="text-sm font-semibold">{result.provider}</div>
              </div>
              <div className="bg-secondary/50 rounded-md p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Confiança</div>
                <div className="text-sm font-semibold">{result.confidence}%</div>
              </div>
              <div className="bg-secondary/50 rounded-md p-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Categoria</div>
                <div className="text-sm font-semibold capitalize">{result.category.replace("_", " ")}</div>
              </div>
            </div>

            {(result.balance || result.bet_amount) && (
              <div className="grid grid-cols-2 gap-2">
                {result.balance && (
                  <div className="bg-primary/5 border border-primary/20 rounded-md p-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Saldo na tela</div>
                    <div className="text-sm font-semibold text-primary">{result.balance}</div>
                  </div>
                )}
                {result.bet_amount && (
                  <div className="bg-primary/5 border border-primary/20 rounded-md p-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Aposta</div>
                    <div className="text-sm font-semibold text-primary">{result.bet_amount}</div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-1">
              {result.bonus_hud && <Badge className="text-[10px]">HUD de bônus</Badge>}
              {result.free_spins_active && <Badge className="text-[10px]">Free spins</Badge>}
              {result.big_win_banner && <Badge className="text-[10px]">Big win</Badge>}
            </div>

            {result.visual_elements?.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Elementos visuais ({result.visual_elements.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {result.visual_elements.map((el, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{el}</Badge>
                  ))}
                </div>
              </div>
            )}

            {result.evidence && (
              <div className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
                {result.evidence}
              </div>
            )}

            {/* Save as DNA */}
            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Salvar como DNA visual
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Nome do jogo"
                  value={editGame}
                  onChange={(e) => setEditGame(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="Provedora"
                  value={editProvider}
                  onChange={(e) => setEditProvider(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button onClick={saveAsDna} disabled={saving} size="sm" className="w-full">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar como DNA Visual
              </Button>
            </div>
          </div>
        )}

        {rawJson && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-mono uppercase tracking-wider text-[10px]">
              JSON bruto da IA
            </summary>
            <pre className="mt-2 p-2 bg-secondary/30 rounded-md overflow-x-auto text-[10px] max-h-64">
              {rawJson}
            </pre>
          </details>
        )}
      </Card>
    </div>
  );
}

export function AiLabTab() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="playground" className="space-y-4">
        <TabsList className="bg-secondary/50 border border-border p-1 h-auto gap-1">
          <TabsTrigger value="playground" className="text-xs font-mono uppercase tracking-wider gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" /> Playground de Visão
          </TabsTrigger>
          <TabsTrigger value="library" className="text-xs font-mono uppercase tracking-wider gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Biblioteca de Jogos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="playground">
          <VisionPlayground />
        </TabsContent>
        <TabsContent value="library">
          <GameLibraryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
