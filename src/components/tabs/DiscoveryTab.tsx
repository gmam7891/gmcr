import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Search, Sparkles, MapPin, Users, Activity, Gamepad2, AlertTriangle, Download, ExternalLink } from "lucide-react";
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
  match_score: number;
  score_breakdown: { location: number; followers: number; frequency: number; content: number };
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

export function DiscoveryTab() {
  const { t } = useLanguage();
  const [briefing, setBriefing] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["twitch", "instagram"]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [step, setStep] = useState<"input" | "expanding" | "scraping" | "scoring" | "done">("input");

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const handleDiscover = async () => {
    if (!briefing.trim()) {
      toast({ title: t("disc.error"), description: t("disc.briefing_required"), variant: "destructive" });
      return;
    }
    if (platforms.length === 0) {
      toast({ title: t("disc.error"), description: t("disc.platform_required"), variant: "destructive" });
      return;
    }

    setLoading(true);
    setStep("expanding");

    try {
      // Simulate step progress
      setTimeout(() => setStep("scraping"), 3000);
      setTimeout(() => setStep("scoring"), 8000);

      const { data, error } = await supabase.functions.invoke("influencer-discovery", {
        body: { action: "discover", briefing, platforms, limit: 50 },
      });

      if (error) throw error;
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

  const exportExcel = () => {
    if (!result?.prospects?.length) return;
    const rows = result.prospects.map((p) => ({
      [t("disc.platform")]: p.platform,
      [t("disc.username")]: p.username,
      [t("disc.name")]: p.display_name,
      [t("disc.followers")]: p.followers,
      [t("disc.avg_views")]: p.avg_views,
      [t("disc.location")]: p.location_declared || p.location_inferred || "-",
      [t("disc.casino_content")]: p.has_casino_content ? "✅" : "❌",
      [t("disc.match_score")]: p.match_score,
      [t("disc.score_location")]: p.score_breakdown?.location || 0,
      [t("disc.score_followers")]: p.score_breakdown?.followers || 0,
      [t("disc.score_frequency")]: p.score_breakdown?.frequency || 0,
      [t("disc.score_content")]: p.score_breakdown?.content || 0,
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
      {/* Briefing Input */}
      <div className="card-surface p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">{t("disc.title")}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{t("disc.subtitle")}</p>

        <Textarea
          placeholder={t("disc.placeholder")}
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
          className="min-h-[100px] text-sm"
          disabled={loading}
        />

        <div className="flex items-center gap-4">
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

        <div className="flex items-center gap-3">
          <Button onClick={handleDiscover} disabled={loading || !briefing.trim()} className="gap-2">
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

      {/* AI Keywords */}
      {result && (
        <div className="card-surface p-4 space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">{t("disc.ai_keywords")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {result.keywords.map((kw, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] font-mono">{kw}</Badge>
            ))}
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground mt-2">
            <span>{t("disc.total_scraped")}: <strong className="text-foreground">{result.total_scraped}</strong></span>
            <span>{t("disc.qualified")}: <strong className="text-accent">{result.total_qualified}</strong></span>
            <span>{t("disc.spam_filtered")}: <strong className="text-destructive">{result.total_spam}</strong></span>
            <span>{t("disc.low_score")}: <strong className="text-warning">{result.total_low_score}</strong></span>
          </div>
        </div>
      )}

      {/* Results Grid */}
      {result && result.prospects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {result.prospects.map((p, i) => (
            <div key={i} className="card-surface p-4 space-y-3 hover:border-primary/50 transition-colors">
              {/* Header */}
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

              {/* Bio */}
              {p.bio && (
                <p className="text-xs text-muted-foreground line-clamp-2">{p.bio}</p>
              )}

              {/* Score Breakdown */}
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

              {/* Metrics */}
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span><Users className="h-3 w-3 inline mr-0.5" />{(p.followers || 0).toLocaleString()}</span>
                {p.avg_views > 0 && <span>👁 {p.avg_views.toLocaleString()}</span>}
                {(p.location_declared || p.location_inferred) && (
                  <span><MapPin className="h-3 w-3 inline mr-0.5" />{p.location_declared || p.location_inferred}</span>
                )}
              </div>

              {/* Casino badge */}
              {p.has_casino_content && (
                <Badge variant="default" className="text-[9px]">
                  <Gamepad2 className="h-3 w-3 mr-1" />{t("disc.casino_confirmed")}
                </Badge>
              )}

              {/* Actions */}
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
