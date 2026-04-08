import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "@/contexts/LanguageContext";
import { getQueue } from "@/lib/scanner-api";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-primary/20 text-primary",
  completed: "bg-green-500/20 text-green-600",
  failed: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function QueueTab() {
  const { t } = useLanguage();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getQueue()
      .then(d => setJobs(d.jobs || []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">{t("app.loading")}</p>;
  if (jobs.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">{t("scan.no_data")}</p>;

  return (
    <Card className="p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("scan.job_type")}</TableHead>
            <TableHead>{t("scan.streamer")}</TableHead>
            <TableHead>{t("scan.priority")}</TableHead>
            <TableHead>{t("scan.status")}</TableHead>
            <TableHead className="text-right">{t("scan.attempts")}</TableHead>
            <TableHead>{t("scan.created")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((j: any) => (
            <TableRow key={j.id}>
              <TableCell className="font-mono text-xs">{j.job_type}</TableCell>
              <TableCell className="text-sm">{j.streamer_login}</TableCell>
              <TableCell>
                <Badge variant={j.priority === "critical" ? "destructive" : "outline"} className="text-[10px]">
                  {j.priority}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge className={`text-[10px] ${STATUS_COLORS[j.status] || ""}`}>{j.status}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-xs">{j.attempts}/{j.max_attempts}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(j.created_at).toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
