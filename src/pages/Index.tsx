import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InstagramTab } from "@/components/tabs/InstagramTab";
import { TwitchTab } from "@/components/tabs/TwitchTab";
import { YouTubeTab } from "@/components/tabs/YouTubeTab";
import { KickTab } from "@/components/tabs/KickTab";
import { IcpTab } from "@/components/tabs/IcpTab";
import { VodTab } from "@/components/tabs/VodTab";
import { SimulatorTab } from "@/components/tabs/SimulatorTab";
import { MonitorTab } from "@/components/tabs/MonitorTab";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Shield, LogOut } from "lucide-react";
import instagramIcon from "@/assets/instagram-icon.png";
import twitchLogo from "@/assets/twitch-logo.png";
import youtubeLogo from "@/assets/youtube-logo.png";
import kickLogo from "@/assets/kick-logo.png";
import type { ComponentType } from "react";

interface TabConfig {
  id: string;
  label: string;
  icon?: string;
  component: ComponentType;
}

const TAB_CONFIG: TabConfig[] = [
  { id: "simulator", label: "Simulador", icon: "⚡" },
  { id: "monitor", label: "Monitor", icon: "📡" },
  { id: "instagram", label: "Instagram", icon: instagramIcon },
  { id: "twitch", label: "Twitch", icon: twitchLogo },
  { id: "youtube", label: "YouTube", icon: youtubeLogo },
  { id: "kick", label: "Kick", icon: kickLogo },
  { id: "icp", label: "ICP Calc", icon: "📊" },
  { id: "vod", label: "VOD Analyzer", icon: "📈" },
].map((t) => ({
  ...t,
  component: { simulator: SimulatorTab, monitor: MonitorTab, instagram: InstagramTab, twitch: TwitchTab, youtube: YouTubeTab, kick: KickTab, icp: IcpTab, vod: VodTab }[t.id] as ComponentType,
}));

const Index = () => {
  const { isAdmin, userAccess, signOut, user } = useAuth();
  const navigate = useNavigate();

  const allowedTabs = userAccess?.allowed_tabs || [];
  const visibleTabs = TAB_CONFIG.filter((t) => allowedTabs.includes(t.id));
  const defaultTab = visibleTabs[0]?.id || "simulator";

  const isExpired = userAccess?.expires_at && new Date(userAccess.expires_at) < new Date();

  if (!userAccess?.is_active || isExpired || visibleTabs.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-lg font-semibold text-foreground">Starklytic</h1>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          {isExpired
            ? "Seu período de acesso expirou. Entre em contato com o administrador para renovar."
            : "Você ainda não possui acesso a nenhum módulo. Entre em contato com o administrador."}
        </p>
        <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
          <LogOut className="h-4 w-4 mr-1" /> Sair
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-foreground">Starklytic</h1>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            Media Buying Tool v2.3
          </span>
        </div>
        <div className="flex items-center gap-2">
          {userAccess?.expires_at && (
            <span className="text-[10px] text-muted-foreground font-mono">
              Acesso até {new Date(userAccess.expires_at).toLocaleDateString("pt-BR")}
            </span>
          )}
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} title="Admin">
              <Shield className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={signOut} title="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="p-6">
        <Tabs defaultValue={defaultTab} className="space-y-6">
          <TabsList className="bg-secondary/50 border border-border p-1 h-auto gap-1 flex-wrap">
            {visibleTabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2 flex items-center gap-1.5"
              >
                {tab.icon && (tab.icon.length > 5 ? (
                  <img src={tab.icon} alt="" className="h-4 w-4 object-contain" />
                ) : (
                  <span>{tab.icon}</span>
                ))}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {visibleTabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id}>
              <tab.component />
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
