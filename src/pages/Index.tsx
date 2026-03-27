import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InstagramTab } from "@/components/tabs/InstagramTab";
import { TwitchTab } from "@/components/tabs/TwitchTab";
import { YouTubeTab } from "@/components/tabs/YouTubeTab";
import { KickTab } from "@/components/tabs/KickTab";
import { IcpTab } from "@/components/tabs/IcpTab";
import { VodTab } from "@/components/tabs/VodTab";
import { SimulatorTab } from "@/components/tabs/SimulatorTab";
import { MonitorTab } from "@/components/tabs/MonitorTab";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-foreground">Starklytic</h1>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            Media Buying Tool v2.3
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Data-Driven ROI
        </span>
      </header>

      <main className="p-6">
        <Tabs defaultValue="simulator" className="space-y-6">
          <TabsList className="bg-secondary/50 border border-border p-1 h-auto gap-1 flex-wrap">
            <TabsTrigger value="simulator" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2">
              ⚡ Simulador
            </TabsTrigger>
            <TabsTrigger value="monitor" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2">
              📡 Monitor
            </TabsTrigger>
            <TabsTrigger value="instagram" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2">
              Instagram
            </TabsTrigger>
            <TabsTrigger value="twitch" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2">
              Twitch
            </TabsTrigger>
            <TabsTrigger value="youtube" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2">
              YouTube
            </TabsTrigger>
            <TabsTrigger value="kick" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2">
              Kick
            </TabsTrigger>
            <TabsTrigger value="icp" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2">
              ICP Calc
            </TabsTrigger>
            <TabsTrigger value="vod" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-4 py-2">
              VOD Analyzer
            </TabsTrigger>
          </TabsList>

          <TabsContent value="simulator"><SimulatorTab /></TabsContent>
          <TabsContent value="monitor"><MonitorTab /></TabsContent>
          <TabsContent value="instagram"><InstagramTab /></TabsContent>
          <TabsContent value="twitch"><TwitchTab /></TabsContent>
          <TabsContent value="youtube"><YouTubeTab /></TabsContent>
          <TabsContent value="kick"><KickTab /></TabsContent>
          <TabsContent value="icp"><IcpTab /></TabsContent>
          <TabsContent value="vod"><VodTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
