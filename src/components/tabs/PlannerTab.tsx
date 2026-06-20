import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, Target, Save, Sparkles, Users, TrendingUp, DollarSign } from "lucide-react";
import { toast } from "sonner";

interface Candidate {
  username: string;
  display_name: string | null;
  platform: string;
  followers: number;
  avg_views: number;
  match_score_raw: number;
  has_casino_content: boolean;
  location: string | null;
  score: number;
  tier: string;
  cost_min: number;
  cost_max: number;
  est_reach: number;
  justification?: string;
}

interface Result {
  candidates: Candidate[];
  budget_fit: {
    items: Candidate[];
    count: number;
    spent_min: number;
    spent_max: number;
    estimated_reach: number;
  };
}

interface SavedCampaign {
  id: string;
  name: string;
  budget: number;
  created_at: string;
}

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

export function PlannerTab() {
  const { currentOrg, user } = useAuth();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("10000");
  const [targetGames, setTargetGames] = useState("");
  const [targetProviders, setTargetProviders] = useState("");
  const [region, setRegion] = useState("");
  const [objective, setObjective] = useState("Awareness");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState<SavedCampaign[]>([]);

  const loadSaved = async () => {
    if (!currentOrg) return;
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, budget, created_at")
      .eq("org_id", currentOrg.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setSaved((data || []) as SavedCampaign[]);
  };

  useEffect(() => {
    loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrg?.id]);

  const run = async () => {
    if (!currentOrg) return toast.error("Selecione uma organização ativa.");
    const budgetNum = parseFloat(budget);
    if (!budgetNum || budgetNum <= 0) return toast.error("Informe um budget válido.");
    setBusy(true);
    setResult(null);
    try {
      const brief = {
        budget: budgetNum,
        target_games: targetGames.split(",").map((s) => s.trim()).filter(Boolean),
        target_providers: targetProviders.split(",").map((s) => s.trim()).filter(Boolean),
        region: region.trim() || undefined,
        objective: objective.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const { data, error } = await supabase.functions.invoke("campaign-matchmaker", { body: brief });
      if (error) throw new Error(error.message);
      setResult(data as Result);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!currentOrg || !result || !user) return;
    if (!name.trim()) return toast.error("Dê um nome à campanha.");
    const { error } = await supabase.from("campaigns").insert({
      org_id: currentOrg.id,
      created_by: user.id,
      name: name.trim(),
      budget: parseFloat(budget) || 0,
      target_games: targetGames.split(",").map((s) => s.trim()).filter(Boolean),
      target_providers: targetProviders.split(",").map((s) => s.trim()).filter(Boolean),
      region: region.trim() || null,
      objective: objective.trim() || null,
      notes: notes.trim() || null,
      results: result as any,
    });
    if (error) return toast.error(error.message);
    toast.success("Campanha salva.");
    loadSaved();
  };

  const loadCampaign = async (id: string) => {
    const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
    if (error || !data) return toast.error(error?.message || "não encontrada");
    setName(data.name);
    setBudget(String(data.budget));
    setTargetGames((data.target_games || []).join(", "));
    setTargetProviders((data.target_providers || []).join(", "));
    setRegion(data.region || "");
    setObjective(data.objective || "");
    setNotes(data.notes || "");
    setResult((data.results as any) || null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Target className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-xl font-bold">Planejador de Campanha</h2>
          <p className="text-sm text-muted-foreground">
            Brief →  ranking + budget-fit{" "}
            {currentOrg ? <Badge variant="outline">{currentOrg.name}</Badge> : <Badge variant="destructive">sem org</Badge>}
          </p>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Nome da campanha</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Lançamento Sweet Bonanza" />
          </div>
          <div>
            <Label>Budget (BRL)</Label>
            <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <div>
            <Label>Jogos-alvo (vírgula)</Label>
            <Input value={targetGames} onChange={(e) => setTargetGames(e.target.value)} placeholder="Sweet Bonanza, Gates of Olympus" />
          </div>
          <div>
            <Label>Provedores-alvo (vírgula)</Label>
            <Input value={targetProviders} onChange={(e) => setTargetProviders(e.target.value)} placeholder="Pragmatic Play, PG Soft" />
          </div>
          <div>
            <Label>Região</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Brasil, SP..." />
          </div>
          <div>
            <Label>Objetivo</Label>
            <Input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Awareness, Conversão..." />
          </div>
        </div>
        <div>
          <Label>Notas</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        <div className="flex gap-2">
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Gerar recomendações
          </Button>
          {result && (
            <Button variant="outline" onClick={save}>
              <Save className="h-4 w-4 mr-1" /> Salvar campanha
            </Button>
          )}
        </div>
      </Card>

      {result && (
        <>
          <Card className="p-4 bg-primary/5 border-primary/30">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground">Perfis que cabem no budget</div>
                  <div className="text-2xl font-bold">~{result.budget_fit.count}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground">Alcance estimado</div>
                  <div className="text-2xl font-bold">~{fmtNum(result.budget_fit.estimated_reach)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground">Investimento</div>
                  <div className="text-sm font-bold">
                    {fmtBRL(result.budget_fit.spent_min)} – {fmtBRL(result.budget_fit.spent_max)}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="space-y-2">
            <div className="text-sm font-medium">Top candidatos ({result.candidates.length})</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {result.candidates.map((c) => {
                const inFit = result.budget_fit.items.some((i) => i.username === c.username);
                return (
                  <Card key={c.username} className={`p-3 ${inFit ? "border-primary/50" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">@{c.username}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {c.display_name} · {c.platform}
                        </div>
                      </div>
                      <Badge variant={c.score >= 70 ? "default" : "secondary"}>{c.score}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Followers</div>
                        <div className="font-medium">{fmtNum(c.followers)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Tier</div>
                        <div className="font-medium">{c.tier}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Custo</div>
                        <div className="font-medium">{fmtBRL(c.cost_min)}+</div>
                      </div>
                    </div>
                    {c.justification && (
                      <div className="mt-2 text-xs text-muted-foreground italic">"{c.justification}"</div>
                    )}
                    {inFit && <Badge variant="outline" className="mt-2 text-[10px]">no budget-fit</Badge>}
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Campanhas salvas</div>
        {saved.length === 0 ? (
          <div className="text-xs text-muted-foreground">Nenhuma ainda.</div>
        ) : (
          <Accordion type="single" collapsible>
            {saved.map((s) => (
              <AccordionItem key={s.id} value={s.id}>
                <AccordionTrigger className="text-sm">
                  {s.name} · {fmtBRL(s.budget)} · {new Date(s.created_at).toLocaleDateString("pt-BR")}
                </AccordionTrigger>
                <AccordionContent>
                  <Button size="sm" variant="outline" onClick={() => loadCampaign(s.id)}>
                    Carregar no editor
                  </Button>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </Card>
    </div>
  );
}
