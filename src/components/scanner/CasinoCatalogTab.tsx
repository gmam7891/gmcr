import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Building2,
  Download,
  RefreshCw,
  Sparkles,
  Plus,
  ImageIcon,
  ClipboardPaste,
  Upload,
  Brain,
  X,
} from "lucide-react";

interface Casino {
  id: string;
  casino_slug: string;
  casino_name: string;
  urls: string[];
  is_active: boolean;
  last_scraped_at: string | null;
}

interface CatalogStatus {
  casino: Casino | null;
  total: number;
  matched: number;
  pending: number;
  new_pending_dna: number;
  samples: Array<{
    game_name_raw: string;
    provider_name: string | null;
    thumbnail_url: string;
    status: string;
    game_library_id: string | null;
    metadata: { phash_hex?: string | null } | null;
  }>;
}

async function call<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(
    "casino-catalog-scraper",
    { body },
  );
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

const STORAGE_BASE = `${
  import.meta.env.VITE_SUPABASE_URL ?? ""
}/storage/v1/object/public/game-thumbnails/`;

export function CasinoCatalogTab() {
  const qc = useQueryClient();
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPasteForm, setShowPasteForm] = useState(false);
  const [pasteHtml, setPasteHtml] = useState("");
  const [pasteSourceUrl, setPasteSourceUrl] = useState("");
  const [newCasino, setNewCasino] = useState({
    casino_slug: "",
    casino_name: "",
    urls: "",
  });

  const casinosQuery = useQuery({
    queryKey: ["casino-catalogs"],
    queryFn: () => call<{ casinos: Casino[] }>({ action: "list_casinos" }),
  });

  const statusQuery = useQuery({
    queryKey: ["casino-catalog-status", selectedSlug],
    queryFn: () =>
      call<CatalogStatus>({ action: "status", casino_slug: selectedSlug }),
    enabled: !!selectedSlug,
    refetchInterval: 5000,
  });

  const scrapeMut = useMutation({
    mutationFn: (casino: Casino) =>
      call({
        action: "scrape_casino",
        casino_slug: casino.casino_slug,
        casino_name: casino.casino_name,
        urls: casino.urls,
      }),
    onSuccess: () => {
      toast.success("Varredura iniciada em background");
      qc.invalidateQueries({ queryKey: ["casino-catalog-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mergeMut = useMutation({
    mutationFn: (slug: string) =>
      call({ action: "merge_to_library", casino_slug: slug }),
    onSuccess: (data: any) => {
      toast.success(
        `Sincronizado: ${data.matched} casados, ${data.created} novos`,
      );
      qc.invalidateQueries({ queryKey: ["casino-catalog-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upsertMut = useMutation({
    mutationFn: () => {
      const urls = newCasino.urls
        .split(/\s|,|\n/)
        .map((u) => u.trim())
        .filter(Boolean);
      return call({
        action: "upsert_casino",
        casino_slug: newCasino.casino_slug.trim().toLowerCase(),
        casino_name: newCasino.casino_name.trim(),
        urls,
        is_active: true,
      });
    },
    onSuccess: () => {
      toast.success("Casa cadastrada");
      setShowAddForm(false);
      setNewCasino({ casino_slug: "", casino_name: "", urls: "" });
      qc.invalidateQueries({ queryKey: ["casino-catalogs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (slug: string) =>
      call({ action: "delete_casino", casino_slug: slug }),
    onSuccess: (_d, slug) => {
      toast.success("Origem removida");
      if (selectedSlug === slug) setSelectedSlug("");
      qc.invalidateQueries({ queryKey: ["casino-catalogs"] });
      qc.invalidateQueries({ queryKey: ["casino-catalog-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const ingestMut = useMutation({
    mutationFn: (args: { casino: Casino; html: string; sourceUrl: string }) =>
      call<{ tiles_found: number; message: string }>({
        action: "ingest_html",
        casino_slug: args.casino.casino_slug,
        casino_name: args.casino.casino_name,
        html: args.html,
        source_page_url: args.sourceUrl || undefined,
      }),
    onSuccess: (data) => {
      toast.success(data.message || `${data.tiles_found} tiles detectados`);
      setShowPasteForm(false);
      setPasteHtml("");
      setPasteSourceUrl("");
      qc.invalidateQueries({ queryKey: ["casino-catalog-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Treina o agente IA com as novas entradas do catálogo (gera keywords + markers
  // a partir da thumbnail/nome). Roda em lotes até esgotar pendentes.
  const trainMut = useMutation({
    mutationFn: async () => {
      let processed = 0;
      let succeeded = 0;
      for (let i = 0; i < 25; i++) {
        const { data, error } = await supabase.functions.invoke(
          "intelligent-vod-agent",
          { body: { action: "learn_all_pending", limit: 4 } },
        );
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        processed += data?.processed ?? 0;
        succeeded += data?.succeeded ?? 0;
        if (!data?.has_more) break;
      }
      return { processed, succeeded };
    },
    onSuccess: (data) => {
      toast.success(
        `Agente treinado: ${data.succeeded}/${data.processed} perfis novos`,
      );
      qc.invalidateQueries({ queryKey: ["casino-catalog-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    casino: Casino,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 12MB)");
      return;
    }
    const text = await file.text();
    ingestMut.mutate({ casino, html: text, sourceUrl: pasteSourceUrl });
    e.target.value = "";
  };

  const casinos = casinosQuery.data?.casinos ?? [];
  const selected = casinos.find((c) => c.casino_slug === selectedSlug);
  const status = statusQuery.data;

  useEffect(() => {
    if (!selectedSlug && casinos.length > 0) {
      setSelectedSlug(casinos[0].casino_slug);
    }
    if (selectedSlug && casinos.length > 0 && !selected) {
      setSelectedSlug(casinos[0].casino_slug);
    }
  }, [casinos, selectedSlug, selected]);

  return (
    <div className="space-y-4">
      {/* Header + site selector */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">
              Catálogo de Thumbnails (qualquer site)
            </h3>
            <Badge variant="outline" className="text-[10px]">
              Genérico
            </Badge>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddForm((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Nova origem
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Importa as miniaturas oficiais dos jogos (vindas do lobby de qualquer
          casa — as imagens são do provedor, então servem cross-site), calcula{" "}
          <code className="text-[10px]">pHash</code> e alimenta a Biblioteca
          Visual. O agente IA usa essas thumbs pra reconhecer o jogo no VOD a
          partir do momento em que o streamer entra no gameplay e fecha a
          sessão após 60s sem ver o jogo (volta pro lobby, troca ou sai).
        </p>



        {showAddForm && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-border">
            <Input
              placeholder="slug (ex: bullsbet)"
              value={newCasino.casino_slug}
              onChange={(e) =>
                setNewCasino((p) => ({ ...p, casino_slug: e.target.value }))
              }
            />
            <Input
              placeholder="Nome (ex: BullsBet)"
              value={newCasino.casino_name}
              onChange={(e) =>
                setNewCasino((p) => ({ ...p, casino_name: e.target.value }))
              }
            />
            <Textarea
              placeholder="URLs do catálogo (uma por linha)"
              className="sm:col-span-3 text-xs font-mono"
              rows={3}
              value={newCasino.urls}
              onChange={(e) =>
                setNewCasino((p) => ({ ...p, urls: e.target.value }))
              }
            />
            <div className="sm:col-span-3">
              <Button
                size="sm"
                onClick={() => upsertMut.mutate()}
                disabled={
                  upsertMut.isPending ||
                  !newCasino.casino_slug ||
                  !newCasino.casino_name ||
                  !newCasino.urls.trim()
                }
              >
                {upsertMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : null}
                Salvar
              </Button>
            </div>
          </div>
        )}

        {/* Casino tabs */}
        <div className="flex flex-wrap gap-2 pt-2">
          {casinos.length === 0 && !casinosQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma casa cadastrada. Use "Nova casa" para começar.
            </p>
          ) : (
            casinos.map((c) => {
              const active = selectedSlug === c.casino_slug;
              return (
                <div
                  key={c.casino_slug}
                  className={`inline-flex items-stretch rounded border overflow-hidden transition-colors ${
                    active
                      ? "border-primary"
                      : "border-border hover:border-foreground/40"
                  }`}
                >
                  <button
                    onClick={() => setSelectedSlug(c.casino_slug)}
                    className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c.casino_name}
                  </button>
                  <button
                    onClick={() => {
                      if (deleteMut.isPending) return;
                      if (
                        confirm(
                          `Remover "${c.casino_name}" e todas as thumbnails importadas dessa origem? Esta ação não pode ser desfeita.`,
                        )
                      ) {
                        deleteMut.mutate(c.casino_slug);
                      }
                    }}
                    title="Remover origem"
                    className={`px-1.5 flex items-center justify-center border-l transition-colors ${
                      active
                        ? "border-primary-foreground/30 bg-primary text-primary-foreground hover:bg-destructive hover:text-destructive-foreground"
                        : "border-border bg-secondary/50 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                    }`}
                  >
                    {deleteMut.isPending && deleteMut.variables === c.casino_slug ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Selected casino panel */}
      {selected && (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold">{selected.casino_name}</h4>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {selected.urls.length} URL(s) ·{" "}
                  {selected.last_scraped_at
                    ? `Último scrape: ${new Date(
                        selected.last_scraped_at,
                      ).toLocaleString()}`
                    : "Nunca escaneado"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => scrapeMut.mutate(selected)}
                  disabled={scrapeMut.isPending}
                >
                  {scrapeMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 mr-1" />
                  )}
                  Importar catálogo
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowPasteForm((v) => !v)}
                >
                  <ClipboardPaste className="h-3.5 w-3.5 mr-1" />
                  Colar HTML
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mergeMut.mutate(selected.casino_slug)}
                  disabled={mergeMut.isPending || (status?.pending ?? 0) === 0}
                >
                  {mergeMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  Sincronizar com biblioteca
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => trainMut.mutate()}
                  disabled={trainMut.isPending}
                  title="Treina o agente IA com as thumbs novas (gera keywords + marcadores visuais)"
                >
                  {trainMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Brain className="h-3.5 w-3.5 mr-1" />
                  )}
                  Treinar agente
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    qc.invalidateQueries({
                      queryKey: ["casino-catalog-status"],
                    })
                  }
                  title="Atualizar"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Total" value={status?.total ?? 0} />
              <Metric
                label="Casados"
                value={status?.matched ?? 0}
                accent="text-green-500"
              />
              <Metric
                label="Pendentes"
                value={status?.pending ?? 0}
                accent="text-amber-500"
              />
              <Metric
                label="Novos (DNA pendente)"
                value={status?.new_pending_dna ?? 0}
                accent="text-blue-500"
              />
            </div>
          </Card>

          {showPasteForm && (
            <Card className="p-4 space-y-3 border-primary/40">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <ClipboardPaste className="h-4 w-4 text-primary" />
                  Importar via HTML colado
                </h4>
                <p className="text-[10px] text-muted-foreground">
                  Funciona com páginas logadas · sem custo de scraping
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Abra o lobby da casa, role até o fim para carregar todos os
                tiles, clique com botão direito → <strong>Inspecionar</strong> →
                selecione o <code>{"<html>"}</code> → <strong>Copy → Copy outerHTML</strong>.
                Cole abaixo. Aceita também upload de um <code>.html</code> salvo
                (Ctrl+S → "Página completa").
              </p>
              <Input
                placeholder="URL de origem (opcional, para rastreabilidade)"
                value={pasteSourceUrl}
                onChange={(e) => setPasteSourceUrl(e.target.value)}
                className="text-xs font-mono"
              />
              <Textarea
                placeholder="Cole aqui o HTML da página do lobby…"
                value={pasteHtml}
                onChange={(e) => setPasteHtml(e.target.value)}
                rows={8}
                className="text-[10px] font-mono"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    ingestMut.mutate({
                      casino: selected,
                      html: pasteHtml,
                      sourceUrl: pasteSourceUrl,
                    })
                  }
                  disabled={ingestMut.isPending || pasteHtml.trim().length < 100}
                >
                  {ingestMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  Processar HTML
                </Button>
                <label className="inline-flex">
                  <input
                    type="file"
                    accept=".html,.htm,text/html"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e, selected)}
                  />
                  <span className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-border bg-secondary/50 hover:bg-secondary cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    Enviar arquivo .html
                  </span>
                </label>
                <span className="text-[10px] text-muted-foreground">
                  {pasteHtml.length.toLocaleString()} caracteres · máx 12MB
                </span>
              </div>
            </Card>
          )}

          {/* Samples grid */}
          <Card className="p-4 space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              Amostras recentes
              {statusQuery.isFetching && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </h4>
            {(status?.samples ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma miniatura ainda. Clique em "Importar catálogo".
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {status?.samples.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-secondary/30 overflow-hidden"
                  >
                    <img
                      src={`${STORAGE_BASE}${s.thumbnail_url}`}
                      alt={s.game_name_raw}
                      className="w-full aspect-square object-cover bg-muted"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = "0.2";
                      }}
                    />
                    <div className="p-2 space-y-1">
                      <p className="text-[11px] font-medium leading-tight truncate">
                        {s.game_name_raw}
                      </p>
                      <p className="text-[9px] font-mono text-muted-foreground truncate">
                        {s.provider_name ?? "—"}
                      </p>
                      <div className="flex items-center justify-between">
                        <Badge
                          variant={
                            s.status === "matched"
                              ? "default"
                              : s.status === "new_pending_dna"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-[8px] px-1 py-0"
                        >
                          {s.status}
                        </Badge>
                        {s.metadata?.phash_hex && (
                          <span className="text-[8px] font-mono text-muted-foreground">
                            {s.metadata.phash_hex.slice(0, 6)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">
        {label}
      </p>
      <p className={`text-2xl font-bold ${accent ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
