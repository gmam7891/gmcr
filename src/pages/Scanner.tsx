import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Shield, LogOut, ArrowLeft, LayoutDashboard, Users, Gamepad2,
  Building2, MessageSquare, FileCheck, ListChecks, ClipboardCheck,
  Search, Activity, BarChart3, FlaskConical, Trophy, ChevronDown, Settings2, Brain,
} from "lucide-react";
import { StatusHeader } from "@/components/scanner/StatusHeader";
import { GlobalFilters } from "@/components/scanner/GlobalFilters";
import { useScannerFilters } from "@/contexts/ScannerFiltersContext";
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
import { SullyGnomeTab } from "@/components/scanner/SullyGnomeTab";
import { AiLabTab } from "@/components/scanner/AiLabTab";
import { IntelAgentTab } from "@/components/scanner/IntelAgentTab";
import { ResultsTab } from "@/components/scanner/ResultsTab";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const Scanner = () => {
  const { isAdmin, userAccess, signOut } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { filters } = useScannerFilters();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [dataFilter, setDataFilter] = useState<"confirmed" | "all" | "suspect">("confirmed");

  const allowedTabs = userAccess?.allowed_tabs || [];
  const tier = userAccess?.package_name?.toLowerCase() || "starter";

  // Feature gating helpers (kept for FeatureGate components)
  const canAccessProviders = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_providers");
  const canAccessGames = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_games");
  const canAccessVodQuality = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_vod_quality");
  const canAccessQueue = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_queue");
  const canAccessChat = tier === "admin" || tier === "enterprise" || allowedTabs.includes("scanner_chat");
  const canAccessReview = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_review");
  const canAccessAudit = tier === "admin" || tier === "pro" || tier === "enterprise" || allowedTabs.includes("scanner_audit");
  const canAccessQuality = tier === "admin" || tier === "enterprise" || allowedTabs.includes("scanner_quality");
  const canAccessSullyGnome = isAdmin || allowedTabs.includes("scanner_ai_lab");
  const canAccessAiLab = isAdmin || allowedTabs.includes("scanner_ai_lab");

  // ── Analytics tabs — shown to all users ──
  const analyticsTabs = [
    { id: "dashboard", label: t("scan.dashboard"), icon: LayoutDashboard },
    { id: "streamers", label: t("scan.streamers"), icon: Users },
    { id: "games", label: t("scan.games_tab"), icon: Gamepad2 },
    { id: "providers", label: t("scan.providers_tab"), icon: Building2 },
    { id: "sullygnome", label: t("sully.tab"), icon: BarChart3 },
    { id: "results", label: t("scan.results_tab"), icon: Trophy },
  ];

  // ── Operations tabs — shown only to admin, in a dropdown ──
  const opsTabs = [
    { id: "audit", label: t("scan.audit_tab"), icon: Search },
    { id: "review", label: t("scan.review_tab"), icon: ClipboardCheck },
    { id: "quality", label: t("scan.quality_tab"), icon: Activity },
    { id: "vod_quality", label: t("scan.vod_quality"), icon: FileCheck },
    { id: "queue", label: t("scan.queue_tab"), icon: ListChecks },
    { id: "chat", label: t("scan.chat_tab"), icon: MessageSquare },
    { id: "ai_lab", label: t("scan.ai_lab_title"), icon: FlaskConical },
    { id: "intel_agent", label: "Agente IA", icon: Brain },
  ];

  const activeOpsTab = opsTabs.find(tab => tab.id === activeTab);

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground leading-tight">
              {t("scan.scanner_title")}
            </h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono leading-tight">
              {t("scan.scanner_desc")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
        {/* ── Admin-only: system status + scan panel ── */}
        {isAdmin && (
          <div className="space-y-3">
            <StatusHeader />
            <ScanStartPanel onComplete={() => {}} />
          </div>
        )}

        {/* ── Global Filters — always visible, clearly labelled ── */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            {t("scan.filters_label") || "Filtros"}
          </p>
          <GlobalFilters />
        </div>

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          {/* Tab bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Analytics tabs */}
            <TabsList className="bg-secondary/50 border border-border p-1 h-auto gap-1 flex-wrap">
              {analyticsTabs.map(tab => (
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

            {/* Admin-only: Operations dropdown */}
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={activeOpsTab ? "default" : "outline"}
                    size="sm"
                    className="text-xs font-mono uppercase tracking-wider gap-1.5 h-auto py-1.5"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    {activeOpsTab ? activeOpsTab.label : (t("scan.ops_menu") || "Operações")}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[180px]">
                  {opsTabs.map(tab => (
                    <DropdownMenuItem
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className="text-[11px] font-mono gap-2 cursor-pointer"
                    >
                      <tab.icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Data quality toggle — positioned next to tabs, clearly scoped */}
            <div className="flex items-center gap-1.5 ml-auto bg-secondary/50 rounded-md border border-border p-0.5">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono pl-1.5">
                {t("scan.data_quality") || "Dados"}:
              </span>
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
                  {f === "confirmed" ? t("scan.confirmed_only") : f === "all" ? t("scan.all_data") : t("scan.suspect_data")}
                </button>
              ))}
            </div>
          </div>

          {/* ── Analytics tab contents ── */}
          <TabsContent value="dashboard">
            <DashboardTab dataFilter={dataFilter} />
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

          <TabsContent value="sullygnome">
            <FeatureGate requiredPlan="Pro" isLocked={!canAccessSullyGnome}>
              <SullyGnomeTab />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="results">
            <FeatureGate requiredPlan="Pro" isLocked={!isAdmin && !allowedTabs.includes("scanner_results")}>
              <ResultsTab filters={filters} />
            </FeatureGate>
          </TabsContent>

          {/* ── Operations tab contents (admin only) ── */}
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

          <TabsContent value="chat">
            <FeatureGate requiredPlan="Enterprise" isLocked={!canAccessChat}>
              <ChatSentimentTab filters={filters} />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="ai_lab">
            <FeatureGate requiredPlan="Pro" isLocked={!canAccessAiLab}>
              <AiLabTab />
            </FeatureGate>
          </TabsContent>

          <TabsContent value="intel_agent">
            {isAdmin ? <IntelAgentTab /> : <FeatureGate requiredPlan="Enterprise" isLocked />}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Scanner;
