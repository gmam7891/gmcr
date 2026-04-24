import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  requiredPlan: string;
  children: React.ReactNode;
  isLocked: boolean;
}

export function FeatureGate({ requiredPlan, children, isLocked }: Props) {
  const { t } = useLanguage();

  if (!isLocked) return <>{children}</>;

  const handleUpgradeClick = () => {
    window.location.href =
      "mailto:contato@starklytic.com?subject=Upgrade de Plano&body=Olá, gostaria de fazer upgrade para o plano " +
      requiredPlan;
  };

  return (
    <div className="relative">
      <div className="absolute inset-0 z-10 backdrop-blur-sm bg-background/60 rounded-lg flex flex-col items-center justify-center gap-3">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <Badge variant="outline" className="text-xs">{t("scan.premium_badge")}</Badge>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          {t("scan.feature_locked")} <strong>{requiredPlan}</strong>
        </p>
        <Button variant="outline" size="sm" className="text-xs" onClick={handleUpgradeClick}>
          {t("scan.upgrade_cta")}
        </Button>
      </div>
      <div className="pointer-events-none opacity-30">
        {children}
      </div>
    </div>
  );
}
