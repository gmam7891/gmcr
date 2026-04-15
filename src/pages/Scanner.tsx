import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Shield, LogOut, ArrowLeft, LayoutDashboard, Users, Gamepad2, Building2, MessageSquare, FileCheck, ListChecks, ClipboardCheck, Search, Activity, BookOpen } from "lucide-react";
import { StatusHeader } from "@/components/scanner/StatusHeader";
import { GlobalFilters, defaultFilters } from "@/components/scanner/GlobalFilters";
import type { ScannerFilters } from "@/components/scanner/GlobalFilters";
import { DashboardTab } from "@/components/scanner/DashboardTab";
import { RankingsTab } from "@/components/scanner/RankingsTab";
import { VodQualityTab } from "@/components/scanner/VodQualityTab";
import { QueueTab } from "@/components/scanner/QueueTab";
import { ChatSentimentTab } from "@/components/scanner/ChatSentimentTab";
import { FeatureGate } from "@/components/scanner/FeatureGate";
import { ReviewTab } from "@/components/scanner/ReviewTab";
import { AuditTab } from "@/components/scanner/AuditTab";
import { QualityTab } from "@/components/scanner/QualityTab";
import { ScanStartPanel } from "@/components/scanner/ScanStartPanel";
import { getDashboardData, getProviders, getGames } from "@/lib/scanner-api";
import { Badge } from "@/components/ui/badge";
import { GameLibraryTab } from "@/components/scanner/GameLibraryTab";

const Scanner = () => {
  const { isAdmin, userAccess, signOut } = useAuth();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ScannerFilters>(defaultFilters);
  const [dashData, setDashData] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [dataFilter, setDataFilter] = useState<"confirmed" | "all" | "suspect">("confirmed");

  const allowedTabs = userAccess?.allowed_tabs || [];
  const tier = userAccess?.package_name?.toLowerCase() || "starter";

  // Feature gating
  const canAccessProviders = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_providers");
  const canAccessGames = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_games");
  const canAccessVodQuality = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_vod_quality");
  const canAccessQueue = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_queue");
  const canAccessChat = tier === "admin" || tier === "enterprise" || allowedTabs.includes("scanner_chat");
  const canAccessReview = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_review");
  const canAccessAudit = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_audit");
  const canAccessQuality = tier === "admin" || tier === "enterprise" || allowedTabs.includes("scanner_quality");

  const refreshData = () => {
    setLoading(true);
    getDashboardData({ ...filters, block_status_filter: dataFilter })
      .then(setDashData)
      .catch(() => setDashData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    getProviders().then(setProviders);
    getGames().then(setGames);
  }, []);

  useEffect(() => {
    refreshData();
  }, [filters, dataFilter]);

  const tabs = [
    { id: "dashboard", label: t("scan.dashboard"), icon: LayoutDashboard },
    { id: "streamers", label: t("scan.streamers"), icon: Users },
    { id: "games", label: t("scan.games_tab"), icon: Gamepad2 },
    { id: "providers", label: t("scan.providers_tab"), icon: Building2 },
    { id: "chat", label: t("scan.chat_tab"), icon: MessageSquare },
    { id: "audit", label: t("scan.audit_tab"), icon: Search },
    { id: "review", label: t("scan.review_tab"), icon: ClipboardCheck },
    { id: "quality", label: t("scan.quality_tab"), icon: Activity },
    { id: "vod_quality", label: t("scan.vod_quality"), icon: FileCheck },
    { id: "queue", label: t("scan.queue_tab"), icon: ListChecks },
    { id: "game_library", label: t("scan.lib_tab"), icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold tracking-tight text-foreground">{t("scan.scanner_title")}</h1>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            {t("scan.scanner_desc")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Data filter toggle */}
          <div className="flex items-center gap-1 bg-secondary/50 rounded-md border border-border p-0.5">
            {(["confirmed", "suspect", "all"] as const).map(f => (
              <button
                key={f}
                onClick={() => setDataFilter(f)}
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded transition-colors ${
                  dataFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(f === "confirmed" ? "scan.confirmed_only" : f === "all" ? "scan.all_data" : "scan.suspect_data")}
              </button>
            ))}
          </div>
          <ThemeToggle />
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

      <main className="p-6 space-y-4">
        <StatusHeader />
        <ScanStartPanel onComplete={refreshData} />
        <GlobalFilters filters={filters} onChange={setFilters} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-secondary/50 border border-border p-1 h-auto gap-1 flex-wrap">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs font-mono uppercase tracking-wider px-3 py-1.5 flex items-center gap-1.5"
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="dashboard">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-12">{t("app.loading")}</p>
            ) : (
              <>
                {dashData?._meta && !dashData._meta.consistency_check && (
                  <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 text-xs text-destructive flex items-center gap-2 mb-4">
                    <span>⚠️</span>
                    <span>Consistency warning: provider/game totals don't match exposure total. This may indicate data issues.</span>
                  </div>
                )}
                <DashboardTab data={dashData} providers={providers} games={games} />
              </>
            )}
          </TabsContent>

          <TabsContent value="streamers">
            <RankingsTab filters={filters} rankBy="streamer" />
          </TabsContent>

          <TabsContent value="games">
            <FeatureGate requiredPlan="Pro" isLocked={!canAccessGames}>
              <RankingsTab filters={filters} rankBy="game" />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="providers">
            <FeatureGate requiredPlan="Pro" isLocked={!canAccessProviders}>
              <RankingsTab filters={filters} rankBy="provider" />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="chat">
            <FeatureGate requiredPlan="Enterprise" isLocked={!canAccessChat}>
              <ChatSentimentTab filters={filters} />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="audit">
            <FeatureGate requiredPlan="Pro" isLocked={!canAccessAudit}>
              <AuditTab filters={filters} />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="review">
            <FeatureGate requiredPlan="Pro" isLocked={!canAccessReview}>
              <ReviewTab />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="quality">
            <FeatureGate requiredPlan="Enterprise" isLocked={!canAccessQuality}>
              <QualityTab />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="vod_quality">
            <FeatureGate requiredPlan="Pro" isLocked={!canAccessVodQuality}>
              <VodQualityTab filters={filters} />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="queue">
            <FeatureGate requiredPlan="Pro" isLocked={!canAccessQueue}>
              <QueueTab />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="game_library">
            <FeatureGate requiredPlan="Admin" isLocked={!isAdmin}>
              <GameLibraryTab />
            </FeatureGate>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Scanner;
