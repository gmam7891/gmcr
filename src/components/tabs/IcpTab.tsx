import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { fmtInt, fmtPercent } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import * as XLSX from "xlsx";

export function IcpTab() {
  const { t } = useLanguage();
  const [seguidores, setSeguidores] = useState(0);
  const [percIdade, setPercIdade] = useState(0);
  const [percPais, setPercPais] = useState(0);
  const [percGenero, setPercGenero] = useState(0);
  const [taxaEng, setTaxaEng] = useState(0);
  const [tamanhoBase, setTamanhoBase] = useState(0);

  const results = useMemo(() => {
    const potenciais = seguidores * (percIdade / 100) * (percPais / 100) * (percGenero / 100);
    const percIcp = seguidores > 0 ? (potenciais / seguidores) * 100 : 0;
    const leads = potenciais * (taxaEng / 100);
    const crescimento = tamanhoBase > 0 && leads > 0 ? (leads / tamanhoBase) * 100 : 0;
    let qualidade: "go" | "warning" | "nogo" | undefined;
    if (percIcp >= 30) qualidade = "go";
    else if (percIcp >= 10) qualidade = "warning";
    else if (percIcp > 0) qualidade = "nogo";
    return { potenciais, percIcp, leads, crescimento, qualidade };
  }, [seguidores, percIdade, percPais, percGenero, taxaEng, tamanhoBase]);

  const funnel = [
    { label: t("icp.total_followers_label"), value: seguidores },
    { label: t("icp.after_filters"), value: Math.round(results.potenciais) },
    { label: t("icp.estimated_leads"), value: Math.round(results.leads) },
  ];
  const maxFunnel = Math.max(...funnel.map(f => f.value), 1);

  const downloadExcel = () => {
    const data = [
      ["Metric", "Value"],
      [t("icp.total_followers"), seguidores],
      [t("icp.age_pct"), `${percIdade}%`],
      [t("icp.country_pct"), `${percPais}%`],
      [t("icp.gender_pct"), `${percGenero}%`],
      [t("icp.realistic_engagement"), `${taxaEng}%`],
      [t("icp.current_base"), tamanhoBase],
      ["", ""],
      [t("icp.real_buyers_pct"), `${results.percIcp.toFixed(2)}%`],
      [t("icp.people_in_icp"), Math.round(results.potenciais)],
      [t("icp.realistic_leads"), Math.round(results.leads)],
      [t("icp.base_growth"), tamanhoBase > 0 ? `${results.crescimento.toFixed(1)}%` : "-"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ICP");
    XLSX.writeFile(wb, "analise-icp.xlsx");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <FieldSection title={t("icp.influencer_data")}>
          <NumberField label={t("icp.total_followers")} value={seguidores} onChange={setSeguidores} step={1000} />
        </FieldSection>
        <FieldSection title={t("icp.filters")}>
          <NumberField label={t("icp.age_pct")} value={percIdade} onChange={setPercIdade} step={1} max={100} suffix="%" />
          <NumberField label={t("icp.country_pct")} value={percPais} onChange={setPercPais} step={1} max={100} suffix="%" />
          <NumberField label={t("icp.gender_pct")} value={percGenero} onChange={setPercGenero} step={1} max={100} suffix="%" />
        </FieldSection>
        <FieldSection title={t("icp.engagement")}>
          <NumberField label={t("icp.realistic_engagement")} value={taxaEng} onChange={setTaxaEng} step={0.1} max={100} suffix="%" />
        </FieldSection>
        <FieldSection title={t("icp.comparison")}>
          <NumberField label={t("icp.current_base")} value={tamanhoBase} onChange={setTamanhoBase} step={500} />
        </FieldSection>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t("icp.real_reach")}</h2>
          <Button variant="outline" size="sm" onClick={downloadExcel}>{t("app.export_excel")}</Button>
        </div>

        {seguidores > 0 && (percIdade > 0 || percPais > 0 || percGenero > 0) ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label={t("icp.real_buyers_pct")} value={fmtPercent(results.percIcp, 2)} status={results.qualidade} />
              <MetricCard label={t("icp.people_in_icp")} value={fmtInt(results.potenciais)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label={t("icp.realistic_leads")} value={fmtInt(results.leads)} />
              {tamanhoBase > 0 && results.leads > 0 && (
                <MetricCard label={t("icp.base_growth")} value={`+${fmtPercent(results.crescimento)}`} status="go" />
              )}
            </div>
            <div className="card-surface p-4 space-y-3 mt-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground">{t("icp.funnel")}</h3>
              {funnel.map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-mono text-foreground">{fmtInt(item.value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max((item.value / maxFunnel) * 100, 0.5)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {results.qualidade === "go" && (
              <p className="text-sm text-accent">{t("icp.aligned")} ({fmtPercent(results.percIcp)} {t("icp.within_icp")})</p>
            )}
            {results.qualidade === "warning" && (
              <p className="text-sm text-warning">{t("icp.reasonably_qualified")} ({fmtPercent(results.percIcp)} {t("icp.in_icp")})</p>
            )}
            {results.qualidade === "nogo" && (
              <p className="text-sm text-destructive">{t("icp.only")} {fmtPercent(results.percIcp)} {t("icp.challenging")}</p>
            )}
          </>
        ) : (
          <div className="card-surface p-8 text-center text-muted-foreground text-sm">{t("icp.empty")}</div>
        )}
      </div>
    </div>
  );
}
