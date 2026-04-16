import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Shield, LogOut, ArrowRight, BarChart3, Instagram, Tv, Youtube, Monitor, Zap, Search, Video, Target, Globe, ScanLine } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { TranslationKey } from "@/lib/translations";

interface ModuleConfig {
  id: string;
  icon: typeof Target;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  color: string;
  route?: string; // if different from /app?tab=id
}

const modules: ModuleConfig[] = [
  { id: "scanner", icon: ScanLine, titleKey: "mod.scanner.title", descKey: "mod.scanner.desc", color: "from-orange-500/20 to-red-600/10", route: "/scanner" },
  { id: "icp", icon: Target, titleKey: "mod.icp.title", descKey: "mod.icp.desc", color: "from-blue-500/20 to-blue-600/10" },
  { id: "discovery", icon: Search, titleKey: "mod.discovery.title", descKey: "mod.discovery.desc", color: "from-teal-500/20 to-teal-600/10" },
  { id: "instagram", icon: Instagram, titleKey: "mod.instagram.title", descKey: "mod.instagram.desc", color: "from-pink-500/20 to-purple-600/10" },
  { id: "twitch", icon: Tv, titleKey: "mod.twitch.title", descKey: "mod.twitch.desc", color: "from-violet-500/20 to-violet-600/10" },
  { id: "youtube", icon: Youtube, titleKey: "mod.youtube.title", descKey: "mod.youtube.desc", color: "from-red-500/20 to-red-600/10" },
  { id: "kick", icon: Tv, titleKey: "mod.kick.title", descKey: "mod.kick.desc", color: "from-green-500/20 to-green-600/10" },
  { id: "vod", icon: Video, titleKey: "mod.vod.title", descKey: "mod.vod.desc", color: "from-amber-500/20 to-amber-600/10" },
  { id: "monitor", icon: Monitor, titleKey: "mod.monitor.title", descKey: "mod.monitor.desc", color: "from-cyan-500/20 to-cyan-600/10" },
  { id: "simulator", icon: Zap, titleKey: "mod.simulator.title", descKey: "mod.simulator.desc", color: "from-yellow-500/20 to-yellow-600/10" },
  { id: "authenticity", icon: Search, titleKey: "mod.authenticity.title", descKey: "mod.authenticity.desc", color: "from-emerald-500/20 to-emerald-600/10" },
];

const Home = () => {
  const { isAdmin, userAccess, signOut } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const allowedTabs = userAccess?.allowed_tabs || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-foreground">{t("app.name")}</h1>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            {t("app.subtitle")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLanguage(language === "pt" ? "en" : "pt")}
            className="text-xs font-mono gap-1.5"
          >
            <Globe className="h-3.5 w-3.5" />
            {t("lang.switch")}
          </Button>
          <ThemeToggle />
          {userAccess?.expires_at && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {t("app.access_until")} {new Date(userAccess.expires_at).toLocaleDateString(language === "pt" ? "pt-BR" : "en-US")}
            </span>
          )}
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} title="Admin">
              <Shield className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={signOut} title={t("app.logout")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {t("home.welcome")}
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("home.description")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules
            .filter((m) => allowedTabs.includes(m.id))
            .map((mod) => (
              <button
                key={mod.id}
                onClick={() => navigate(mod.route || `/app?tab=${mod.id}`)}
                className={`group relative text-left rounded-xl border border-border p-5 bg-gradient-to-br ${mod.color} hover:border-primary/40 transition-all duration-200 hover:shadow-md`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-lg bg-background/80 border border-border">
                    <mod.icon className="h-5 w-5 text-foreground" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{t(mod.titleKey)}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{t(mod.descKey)}</p>
              </button>
            ))}
        </div>

        <div className="border border-border rounded-xl p-6 bg-secondary/30 space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> {t("home.how_to_use")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div className="space-y-1">
              <p className="font-medium text-foreground">{t("home.step1_title")}</p>
              <p>{t("home.step1_desc")}</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">{t("home.step2_title")}</p>
              <p>{t("home.step2_desc")}</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">{t("home.step3_title")}</p>
              <p>{t("home.step3_desc")}</p>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <Button onClick={() => navigate("/app")} className="gap-2">
            {t("app.access_tools")} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Home;
