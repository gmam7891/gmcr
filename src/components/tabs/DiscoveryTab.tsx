import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Search, Sparkles, MapPin, Users, Activity, Gamepad2, AlertTriangle, Download, ExternalLink, X, Plus, Wand2, SlidersHorizontal, Heart, Link2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import * as XLSX from "xlsx";

interface Prospect {
  id?: string;
  platform: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  profile_url: string;
  followers: number;
  avg_views: number;
  posts_last_30d: number;
  lives_last_30d: number;
  location_declared: string;
  location_inferred: string;
  has_casino_content: boolean;
  gender_inferred?: "female" | "male" | "unknown";
  engagement_rate?: number;
  match_score: number;
  score_breakdown?: { location?: number; followers?: number; frequency?: number; content?: number; reason?: string };
  is_spam: boolean;
}

interface DiscoveryResult {
  briefing_id: string;
  keywords: string[];
  filters: any;
  total_scraped: number;
  total_qualified: number;
  total_spam: number;
  total_low_score: number;
  prospects: Prospect[];
}

type Gender = "any" | "female" | "male";

export function DiscoveryTab() {
  const { t } = useLanguage();
  const [briefing, setBriefing] = useState("");
  const [useAiExpansion, setUseAiExpansion] = useState(false); // OFF by default — user has full control
  const [platforms, setPlatforms] = useState<string[]>(["twitch", "instagram"]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [step, setStep] = useState<"input" | "expanding" | "scraping" | "scoring" | "done">("input");

  // Manual keywords (no auto-suggestion)
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");

  // Demographic / audience filters (all manual, all optional)
  const [locations, setLocations] = useState<string[]>([]);
  const [newLocation, setNewLocation] = useState("");
  const [gender, setGender] = useState<Gender>("any");
  const [minAge, setMinAge] = useState<string>("");
  const [maxAge, setMaxAge] = useState<string>("");
  const [minFollowers, setMinFollowers] = useState<string>("");
  const [maxFollowers, setMaxFollowers] = useState<string>("");
  const [minEngagement, setMinEngagement] = useState<number>(0); // % — 0 to 1000
  const [referenceUrls, setReferenceUrls] = useState<string[]>([]);
  const [newReferenceUrl, setNewReferenceUrl] = useState<string>("");

  // Result sorting (no filtering — all profiles always shown)
  const [sortBy, setSortBy] = useState<"original" | "score" | "followers" | "engagement">("original");

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const addKeyword = () => {
    const k = newKeyword.trim();
    if (!k || customKeywords.includes(k)) return;
    setCustomKeywords([...customKeywords, k]);
    setNewKeyword("");
  };
  const removeKeyword = (kw: string) => setCustomKeywords(customKeywords.filter((k) => k !== kw));

  const addLocation = () => {
    const l = newLocation.trim();
    if (!l || locations.includes(l)) return;
    setLocations([...locations, l]);
    setNewLocation("");
  };
  const removeLocation = (loc: string) => setLocations(locations.filter((l) => l !== loc));

  const addReference = () => {
    const u = newReferenceUrl.trim();
    if (!u || referenceUrls.includes(u)) return;
    if (referenceUrls.length >= 3) {
      toast({ title: "Máximo 3 referências", variant: "destructive" });
      return;
    }
    setReferenceUrls([...referenceUrls, u]);
    setNewReferenceUrl("");
  };
  const removeReference = (url: string) => setReferenceUrls(referenceUrls.filter((u) => u !== url));

  const handleDiscover = async () => {
    if (platforms.length === 0) {
      toast({ title: t("disc.error"), description: t("disc.platform_required"), variant: "destructive" });
      return;
    }

    const hasSearchCriteria =
      briefing.trim().length > 0 ||
      customKeywords.length > 0 ||
      referenceUrls.length > 0 ||
      locations.length > 0;

    if (!hasSearchCriteria) {
      toast({
        title: t("disc.error"),
        description: "Adicione ao menos uma referência, briefing, termo de busca ou localização.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setStep(useAiExpansion && briefing.trim() ? "expanding" : "scraping");

    try {
      setTimeout(() => setStep("scraping"), 2000);
      setTimeout(() => setStep("scoring"), 7000);

      const { data, error } = await supabase.functions.invoke("influencer-discovery", {
        body: {
          action: "discover",
          briefing: briefing || "",
          platforms,
          limit: 50,
          custom_keywords: customKeywords.length > 0 ? customKeywords : undefined,
          use_ai_expansion: useAiExpansion,
          reference_urls: referenceUrls,
          manual_filters: {
            locations,
            gender,
            min_age: minAge ? Number(minAge) : 0,
            max_age: maxAge ? Number(maxAge) : 0,
            min_followers: minFollowers ? Number(minFollowers) : 0,
            max_followers: maxFollowers ? Number(maxFollowers) : 0,
            min_engagement: minEngagement,
          },
        },
      });

      if (error) {
        toast({ title: t("disc.error"), description: error.message, variant: "destructive" });
        setStep("input");
        return;
      }
      setResult(data);
      setStep("done");
      toast({ title: t("disc.success"), description: `${data.total_qualified} ${t("disc.profiles_found")}` });
    } catch (e: any) {
      console.error("Discovery error:", e);
      toast({ title: t("disc.error"), description: e.message, variant: "destructive" });
      setStep("input");
    } finally {
      setLoading(false);
    }
  };

  const filteredProspects = useMemo(() => {
    if (!result?.prospects) return [];
    const list = [...result.prospects];
    if (sortBy === "score") return list.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
    if (sortBy === "followers") return list.sort((a, b) => (b.followers || 0) - (a.followers || 0));
    if (sortBy === "engagement") return list.sort((a, b) => (b.engagement_rate || 0) - (a.engagement_rate || 0));
    return list; // "original" — order returned by backend
  }, [result, sortBy]);

  const exportExcel = () => {
    if (!result?.prospects?.length) return;
    const rows = result.prospects.map((p) => ({
      [t("disc.platform")]: p.platform,
      [t("disc.username")]: p.username,
      [t("disc.name")]: p.display_name,
      [t("disc.followers")]: p.followers,
      [t("disc.avg_views")]: p.avg_views,
      [t("disc.location")]: p.location_declared || p.location_inferred || "-",
      Gênero: p.gender_inferred || "-",
      [t("disc.match_score")]: p.match_score,
      URL: p.profile_url,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Discovery");
    XLSX.writeFile(wb, `discovery-${result.briefing_id.slice(0, 8)}.xlsx`);
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-accent";
    if (score >= 80) return "text-primary";
    return "text-warning";
  };

  const stepProgress = { input: 0, expanding: 20, scraping: 50, scoring: 80, done: 100 };

  return (
    <div className="space-y-6">
      {/* ── Search Builder ────────────────────────────────────────── */}
      <div className="card-surface p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            {t("disc.title")}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Monte sua busca manualmente. Todos os campos são opcionais — combine como preferir.
        </p>

        {/* Briefing — optional, AI-expansion is opt-in */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Briefing (opcional)
            </Label>
            <div className="flex items-center gap-2">
              <Wand2 className="h-3 w-3 text-muted-foreground" />
              <Label htmlFor="ai-toggle" className="text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer">
                Expandir com IA
              </Label>
              <Switch
                id="ai-toggle"
                checked={useAiExpansion}
                onCheckedChange={setUseAiExpansion}
                disabled={loading}
              />
            </div>
          </div>
          <Textarea
            placeholder="Descreva quem você procura. Exemplo: 'Streamers de games competitivos no Norte do Brasil' ou deixe vazio."
            value={briefing}
            onChange={(e) => setBriefing(e.target.value)}
            className="min-h-[80px] text-sm"
            disabled={loading}
          />
          {useAiExpansion && (
            <p className="text-[10px] text-muted-foreground/70">
              ⚠ A IA gerará termos automaticamente a partir do briefing acima.
            </p>
          )}
        </div>

        {/* Reference profile URLs — find similar */}
        <div className="space-y-2 border-t border-border/40 pt-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Link2 className="h-3 w-3" />
            Perfis de referência (opcional)
          </Label>
          <div className="flex flex-wrap gap-1.5 min-h-[24px]">
            {referenceUrls.map((url) => (
              <Badge key={url} variant="secondary" className="text-[10px] font-mono gap-1 pr-1 max-w-full">
                <span className="truncate max-w-[220px]">{url}</span>
                <button
                  type="button"
                  onClick={() => removeReference(url)}
                  disabled={loading}
                  className="hover:text-destructive transition-colors"
                  aria-label={`Remover ${url}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {referenceUrls.length === 0 && (
              <span className="text-[10px] text-muted-foreground/60 italic">Nenhuma referência adicionada</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://instagram.com/usuario ou @usuario"
              value={newReferenceUrl}
              onChange={(e) => setNewReferenceUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addReference(); } }}
              disabled={loading || referenceUrls.length >= 3}
              className="h-9 text-xs font-mono flex-1"
            />
            <Button type="button" size="sm" variant="outline" onClick={addReference} disabled={loading || !newReferenceUrl.trim() || referenceUrls.length >= 3} className="h-9 gap-1">
              <Plus className="h-3 w-3" /> Adicionar
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            ⓘ Use 1–3 perfis do Instagram. O sistema descobre contas seguidas por eles e enriquece dados reais.
          </p>
        </div>

        {/* Manual keywords */}
        <div className="space-y-2 border-t border-border/40 pt-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Termos de busca <span className="text-muted-foreground/60 normal-case tracking-normal">(opcional)</span>
            {customKeywords.length > 0 && <span className="text-foreground ml-1">({customKeywords.length})</span>}
          </Label>
          <div className="flex flex-wrap gap-1.5 min-h-[24px]">
            {customKeywords.map((kw) => (
              <Badge key={kw} variant="secondary" className="text-[10px] font-mono gap-1 pr-1">
                {kw}
                <button
                  type="button"
                  onClick={() => removeKeyword(kw)}
                  disabled={loading}
                  className="hover:text-destructive transition-colors"
                  aria-label={`Remover ${kw}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {customKeywords.length === 0 && (
              <span className="text-[10px] text-muted-foreground/60 italic">Nenhum termo adicionado</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder='ex: "minecraft", #fitness, viagem'
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
              disabled={loading}
              className="h-8 text-xs flex-1"
            />
            <Button type="button" size="sm" variant="outline" onClick={addKeyword} disabled={loading || !newKeyword.trim()} className="h-8 gap-1">
              <Plus className="h-3 w-3" /> Adicionar
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            <code className="font-mono">#hashtag</code> para Instagram · termos sem # para Twitch.
          </p>
        </div>

        {/* Demographic filters */}
        <div className="space-y-3 border-t border-border/40 pt-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Filtros de público (opcionais)
            </Label>
          </div>

          {/* Locations */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
              <MapPin className="h-3 w-3 inline mr-1" />Localização
            </Label>
            <div className="flex flex-wrap gap-1.5 min-h-[20px]">
              {locations.map((loc) => (
                <Badge key={loc} variant="outline" className="text-[10px] font-mono gap-1 pr-1">
                  {loc}
                  <button
                    type="button"
                    onClick={() => removeLocation(loc)}
                    disabled={loading}
                    className="hover:text-destructive"
                    aria-label={`Remover ${loc}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {locations.length === 0 && (
                <span className="text-[10px] text-muted-foreground/60 italic">Qualquer local</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="ex: São Paulo, Brasil, Lisboa, Portugal"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocation(); } }}
                disabled={loading}
                className="h-8 text-xs flex-1"
              />
              <Button type="button" size="sm" variant="outline" onClick={addLocation} disabled={loading || !newLocation.trim()} className="h-8 gap-1">
                <Plus className="h-3 w-3" /> Adicionar
              </Button>
            </div>
          </div>

          {/* Gender + Age */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Gênero</Label>
              <Select value={gender} onValueChange={(v) => setGender(v as Gender)} disabled={loading}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any" className="text-xs">Qualquer</SelectItem>
                  <SelectItem value="female" className="text-xs">Feminino</SelectItem>
                  <SelectItem value="male" className="text-xs">Masculino</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Idade mín.</Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="ex: 18"
                value={minAge}
                onChange={(e) => setMinAge(e.target.value)}
                disabled={loading}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Idade máx.</Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="ex: 35"
                value={maxAge}
                onChange={(e) => setMaxAge(e.target.value)}
                disabled={loading}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Followers range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                <Users className="h-3 w-3 inline mr-1" />Seguidores mín.
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="ex: 5000"
                value={minFollowers}
                onChange={(e) => setMinFollowers(e.target.value)}
                disabled={loading}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Seguidores máx.</Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="ex: 500000"
                value={maxFollowers}
                onChange={(e) => setMaxFollowers(e.target.value)}
                disabled={loading}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Engagement minimum (≥) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1">
                <Heart className="h-3 w-3" /> Engajamento ≥
              </Label>
              <span className="text-xs font-mono font-bold text-foreground tabular-nums">
                {minEngagement}%
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Slider
                min={0}
                max={1000}
                step={1}
                value={[minEngagement]}
                onValueChange={(v) => setMinEngagement(v[0] ?? 0)}
                disabled={loading}
                className="flex-1"
              />
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                value={minEngagement}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(1000, Number(e.target.value) || 0));
                  setMinEngagement(n);
                }}
                disabled={loading}
                className="h-8 w-20 text-xs"
              />
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              Filtra perfis com engajamento mínimo (0% = sem filtro · até 1000%).
            </p>
          </div>

          <p className="text-[10px] text-muted-foreground/70">
            ⓘ Idade e gênero são inferidos a partir de bio/nome — nem todos os perfis serão classificados.
          </p>
        </div>


        <div className="flex items-center gap-4 border-t border-border/40 pt-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("disc.platforms")}:</span>
          {["twitch", "instagram"].map((p) => (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              disabled={loading}
              className={`text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
                platforms.includes(p)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <Button onClick={handleDiscover} disabled={loading} className="gap-2">
            <Search className="h-4 w-4" />
            {loading ? t("disc.searching") : t("disc.search_btn")}
          </Button>
          {result && (
            <Button variant="outline" size="sm" onClick={exportExcel} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              {t("app.export_excel")}
            </Button>
          )}
        </div>

        {loading && (
          <div className="space-y-2">
            <Progress value={stepProgress[step]} className="h-1.5" />
            <p className="text-xs text-muted-foreground font-mono">
              {step === "expanding" && t("disc.step_expanding")}
              {step === "scraping" && t("disc.step_scraping")}
              {step === "scoring" && t("disc.step_scoring")}
            </p>
          </div>
        )}
      </div>

      {/* ── Result stats + filter ─────────────────────────────────── */}
      {result && (
        <div className="card-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>{t("disc.total_scraped")}: <strong className="text-foreground">{result.total_scraped}</strong></span>
            <span>{t("disc.qualified")}: <strong className="text-accent">{result.total_qualified}</strong></span>
            <span>{t("disc.spam_filtered")}: <strong className="text-destructive">{result.total_spam}</strong></span>
            <span>{t("disc.low_score")}: <strong className="text-warning">{result.total_low_score}</strong></span>
          </div>
          {result.keywords?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Termos usados:</span>
              {result.keywords.map((kw) => (
                <Badge key={kw} variant="outline" className="text-[9px] font-mono">{kw}</Badge>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Mostrando todos os {result.prospects.length} perfis encontrados — ordenar por:
            </span>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-7 w-[180px] text-[10px] font-mono uppercase tracking-wider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original" className="text-xs">Ordem original</SelectItem>
                <SelectItem value="score" className="text-xs">Match score (maior)</SelectItem>
                <SelectItem value="followers" className="text-xs">Seguidores (maior)</SelectItem>
                <SelectItem value="engagement" className="text-xs">Engajamento (maior)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* ── Results Grid ─────────────────────────────────────────── */}
      {result && filteredProspects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProspects.map((p, i) => (
            <div key={i} className="card-surface p-4 space-y-3 hover:border-primary/50 transition-colors">
              <div className="flex items-start gap-3">
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt={p.username} className="w-10 h-10 rounded-full object-cover border border-border" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-xs font-mono text-muted-foreground">
                    {p.username.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground truncate">{p.display_name || p.username}</h4>
                    <Badge variant="outline" className="text-[9px] font-mono shrink-0">{p.platform}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono">@{p.username}</p>
                </div>
                <div className={`text-lg font-bold font-mono ${getScoreColor(p.match_score)}`}>
                  {p.match_score}%
                </div>
              </div>

              {p.bio && <p className="text-xs text-muted-foreground line-clamp-2">{p.bio}</p>}

              {p.score_breakdown?.reason && (
                <p className="text-[10px] text-muted-foreground italic mt-1">
                  {p.score_breakdown.reason}
                </p>
              )}

              <div className="grid grid-cols-4 gap-1">
                {[
                  { icon: MapPin, label: t("disc.score_location"), value: p.score_breakdown?.location || 0, max: 30 },
                  { icon: Users, label: t("disc.score_followers"), value: p.score_breakdown?.followers || 0, max: 30 },
                  { icon: Activity, label: t("disc.score_frequency"), value: p.score_breakdown?.frequency || 0, max: 20 },
                  { icon: Gamepad2, label: t("disc.score_content"), value: p.score_breakdown?.content || 0, max: 20 },
                ].map((s) => (
                  <div key={s.label} className="text-center space-y-0.5">
                    <s.icon className="h-3 w-3 mx-auto text-muted-foreground" />
                    <div className="text-[9px] text-muted-foreground truncate">{s.label}</div>
                    <div className={`text-xs font-mono font-bold ${s.value >= s.max * 0.8 ? "text-accent" : s.value > 0 ? "text-foreground" : "text-muted-foreground/50"}`}>
                      +{s.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                <span><Users className="h-3 w-3 inline mr-0.5" />{(p.followers || 0).toLocaleString()}</span>
                {p.avg_views > 0 && <span>👁 {p.avg_views.toLocaleString()}</span>}
                {typeof p.engagement_rate === "number" && p.engagement_rate > 0 && (
                  <span><Heart className="h-3 w-3 inline mr-0.5" />{p.engagement_rate.toFixed(1)}%</span>
                )}
                {(p.location_declared || p.location_inferred) && (
                  <span><MapPin className="h-3 w-3 inline mr-0.5" />{p.location_declared || p.location_inferred}</span>
                )}
                {p.gender_inferred && p.gender_inferred !== "unknown" && (
                  <span className="capitalize">⚥ {p.gender_inferred === "female" ? "Fem" : "Masc"}</span>
                )}
              </div>

              {p.has_casino_content && (
                <Badge variant="default" className="text-[9px]">
                  <Gamepad2 className="h-3 w-3 mr-1" />{t("disc.casino_confirmed")}
                </Badge>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="text-[10px] h-7 gap-1" asChild>
                  <a href={p.profile_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3" />{t("disc.view_profile")}
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {result && result.prospects.length === 0 && (
        <div className="card-surface p-8 text-center space-y-2">
          <AlertTriangle className="h-8 w-8 mx-auto text-warning" />
          <p className="text-sm text-muted-foreground">{t("disc.no_results")}</p>
          <p className="text-xs text-muted-foreground">{t("disc.no_results_hint")}</p>
        </div>
      )}
    </div>
  );
}
