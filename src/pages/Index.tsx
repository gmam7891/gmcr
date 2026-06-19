import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams, useNavigate } from "react-router-dom";
import { InstagramTab } from "@/components/tabs/InstagramTab";
import { TwitchTab } from "@/components/tabs/TwitchTab";
import { YouTubeTab } from "@/components/tabs/YouTubeTab";
import { KickTab } from "@/components/tabs/KickTab";
import { IcpTab } from "@/components/tabs/IcpTab";
import { DiscoveryTab } from "@/components/tabs/DiscoveryTab";
import { VodTab } from "@/components/tabs/VodTab";
import { SimulatorTab } from "@/components/tabs/SimulatorTab";
import { MonitorTab } from "@/components/tabs/MonitorTab";
import { AuthenticityTab } from "@/components/tabs/AuthenticityTab";
import { AnalystTab } from "@/components/tabs/AnalystTab";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Shield, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import instagramIcon from "@/assets/instagram-icon.png";
import twitchLogo from "@/assets/twitch-logo.png";
import youtubeLogo from "@/assets/youtube-logo.png";
import kickLogo from "@/assets/kick-logo.png";
import type { ComponentType } from "react";

interface TabConfig {
  id: string;
  label: string;
  icon?: string;
  component: ComponentType | null;
  route?: string;
}

const Index = () => {
  const { isAdmin, userAccess, signOut } = useAuth();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const TAB_CONFIG: TabConfig[] = [
    { id: "analyst", label: "Analista", icon: "✨", component: AnalystTab },
    { id: "scanner", label: t("mod.scanner.title"), icon: "🎰", component: null, route: "/scanner" },
    { id: "icp", label: t("mod.icp.title"), icon: "📊", component: IcpTab },
    { id: "discovery", label: t("mod.discovery.title"), icon: "🔎", component: DiscoveryTab },
    { id: "instagram", label: t("mod.instagram.title"), icon: instagramIcon, component: InstagramTab },
    { id: "twitch", label: t("mod.twitch.title"), icon: twitchLogo, component: TwitchTab },
    { id: "youtube", label: t("mod.youtube.title"), icon: youtubeLogo, component: YouTubeTab },
    { id: "kick", label: t("mod.kick.title"), icon: kickLogo, component: KickTab },
    { id: "vod", label: t("mod.vod.title"), icon: "📈", component: VodTab },
    { id: "monitor", label: t("mod.monitor.title"), icon: "📡", component: MonitorTab },
    { id: "simulator", label: t("mod.simulator.title"), icon: "⚡", component: SimulatorTab },
    { id: "authenticity", label: t("mod.authenticity.title"), icon: "🔍", component: AuthenticityTab },
  ];

  const allowedTabs = userAccess?.allowed_tabs || [];
  const visibleTabs = TAB_CONFIG.filter((t) => allowedTabs.includes(t.id));
  const contentTabs = visibleTabs.filter((t) => t.component !== null);
  const tabFromUrl = searchParams.get("tab");
  const defaultTab = (tabFromUrl && contentTabs.some(t => t.id === tabFromUrl)) ? tabFromUrl : contentTabs[0]?.id || "icp";

  const isExpired = userAccess?.expires_at && new Date(userAccess.expires_at) < new Date();

  if (!userAccess?.is_active || isExpired || visibleTabs.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-lg font-semibold text-foreground">{t("index.expired_title")}</h1>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          {isExpired ? t("index.expired_msg") : t("index.no_access_msg")}
        </p>
        <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
          <LogOut className="h-4 w-4 mr-1" /> {t("app.logout")}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h1 className="text-sm sm:text-base font-semibold tracking-tight text-foreground cursor-pointer hover:opacity-80 transition-opacity truncate" onClick={() => navigate("/")}>{t("app.name")}</h1>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <ThemeToggle />
          {userAccess?.expires_at && (
            <span className="text-[10px] text-muted-foreground font-mono hidden md:inline">
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

      <main className="p-3 sm:p-6">
        <Tabs defaultValue={defaultTab} className="space-y-4 sm:space-y-6">
          <TabsList className="bg-secondary/50 border border-border p-1 h-auto gap-1 flex-wrap overflow-x-auto">
            {visibleTabs.map((tab) => {
              if (tab.route) {
                // Tab de navegação — renderiza como botão simples
                return (
                  <button
                    key={tab.id}
                    onClick={() => navigate(tab.route!)}
                    className="text-[10px] sm:text-xs font-mono uppercase tracking-wider px-2 sm:px-4 py-1.5 sm:py-2 flex items-center gap-1 sm:gap-1.5 rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    {tab.icon && (tab.icon.length > 5 ? (
                      <img src={tab.icon} alt="" className="h-3.5 w-3.5 sm:h-4 sm:w-4 object-contain" />
                    ) : (
                      <span className="text-xs sm:text-sm">{tab.icon}</span>
                    ))}
                    <span className="hidden xs:inline sm:inline">{tab.label}</span>
                  </button>
                );
              }
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] sm:text-xs font-mono uppercase tracking-wider px-2 sm:px-4 py-1.5 sm:py-2 flex items-center gap-1 sm:gap-1.5"
                >
                  {tab.icon && (tab.icon.length > 5 ? (
                    <img src={tab.icon} alt="" className="h-3.5 w-3.5 sm:h-4 sm:w-4 object-contain" />
                  ) : (
                    <span className="text-xs sm:text-sm">{tab.icon}</span>
                  ))}
                  <span className="hidden xs:inline sm:inline">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {contentTabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id}>
              {tab.component && <tab.component />}
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
