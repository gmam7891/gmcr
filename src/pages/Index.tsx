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

const TAB_CONFIG = [
  { id: "simulator", label: "⚡ Simulador", component: SimulatorTab },
  { id: "monitor", label: "📡 Monitor", component: MonitorTab },
  { id: "instagram", label: "Instagram", component: InstagramTab },
  { id: "twitch", label: "Twitch", component: TwitchTab },
  { id: "youtube", label: "YouTube", component: YouTubeTab },
  { id: "kick", label: "Kick", component: KickTab },
  { id: "icp", label: "ICP Calc", component: IcpTab },
  { id: "vod", label: "VOD Analyzer", component: VodTab },
];

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
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2"
              >
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
