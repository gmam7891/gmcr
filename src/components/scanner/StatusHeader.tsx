import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getSystemStatus } from "@/lib/scanner-api";
import { Activity, Radio, Clock, Layers, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export function StatusHeader() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await getSystemStatus();
      setStatus(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const items = [
    { icon: Radio, label: t("scan.active_lives"), value: status?.active_lives ?? "—", color: status?.active_lives > 0 ? "text-green-500" : "text-muted-foreground" },
    { icon: Layers, label: t("scan.pending_jobs"), value: status?.pending_jobs ?? "—", color: "" },
    { icon: Activity, label: t("scan.running_jobs"), value: status?.running_jobs ?? "—", color: status?.running_jobs > 0 ? "text-primary" : "" },
    { icon: Clock, label: t("scan.monitored"), value: status?.monitored_streamers ?? "—", color: "" },
  ];

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <item.icon className={`h-3.5 w-3.5 ${item.color || "text-muted-foreground"}`} />
          <span className="text-muted-foreground">{item.label}:</span>
          <span className={`font-mono font-medium ${item.color || "text-foreground"}`}>{item.value}</span>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="h-7 text-xs">
        <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
        {t("scan.refresh")}
      </Button>
      <Badge variant="outline" className="text-[10px] ml-auto">
        {status ? `Last: ${new Date().toLocaleTimeString()}` : t("app.loading")}
      </Badge>
    </div>
  );
}
