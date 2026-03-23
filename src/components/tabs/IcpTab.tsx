import { useState, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { NumberField, FieldSection } from "@/components/FieldGroup";
import { fmtInt, fmtPercent } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import * as XLSX from "xlsx";

export function IcpTab() {
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
    { label: "Seguidores totais", value: seguidores },
    { label: "Após filtros ICP", value: Math.round(results.potenciais) },
    { label: "Leads estimados", value: Math.round(results.leads) },
  ];

  const maxFunnel = Math.max(...funnel.map(f => f.value), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <FieldSection title="Dados do influenciador">
          <NumberField label="Total de seguidores" value={seguidores} onChange={setSeguidores} step={1000} />
        </FieldSection>

        <FieldSection title="Filtros ICP">
          <NumberField label="% Idade que bate com ICP" value={percIdade} onChange={setPercIdade} step={1} max={100} suffix="%" />
          <NumberField label="% País-alvo" value={percPais} onChange={setPercPais} step={1} max={100} suffix="%" />
          <NumberField label="% Gênero que bate" value={percGenero} onChange={setPercGenero} step={1} max={100} suffix="%" />
        </FieldSection>

        <FieldSection title="Engajamento">
          <NumberField label="Taxa de engajamento realista" value={taxaEng} onChange={setTaxaEng} step={0.1} max={100} suffix="%" />
        </FieldSection>

        <FieldSection title="Comparação (opcional)">
          <NumberField label="Base atual de leads/clientes" value={tamanhoBase} onChange={setTamanhoBase} step={500} />
        </FieldSection>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Alcance real do ICP</h2>

        {seguidores > 0 && (percIdade > 0 || percPais > 0 || percGenero > 0) ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label="% real compradores (ICP)"
                value={fmtPercent(results.percIcp, 2)}
                status={results.qualidade}
              />
              <MetricCard label="Pessoas no ICP" value={fmtInt(results.potenciais)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Leads realistas" value={fmtInt(results.leads)} />
              {tamanhoBase > 0 && results.leads > 0 && (
                <MetricCard label="Crescimento da base" value={`+${fmtPercent(results.crescimento)}`} status="go" />
              )}
            </div>

            {/* Funnel */}
            <div className="card-surface p-4 space-y-3 mt-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Funil aproximado</h3>
              {funnel.map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-mono text-foreground">{fmtInt(item.value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.max((item.value / maxFunnel) * 100, 0.5)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {results.qualidade === "go" && (
              <p className="text-sm text-accent">Audiência muito alinhada ({fmtPercent(results.percIcp)} dentro do ICP)</p>
            )}
            {results.qualidade === "warning" && (
              <p className="text-sm text-warning">Audiência razoavelmente qualificada ({fmtPercent(results.percIcp)} no ICP)</p>
            )}
            {results.qualidade === "nogo" && (
              <p className="text-sm text-destructive">Apenas {fmtPercent(results.percIcp)} da base no ICP — desafiador</p>
            )}
          </>
        ) : (
          <div className="card-surface p-8 text-center text-muted-foreground text-sm">
            Informe seguidores e pelo menos um filtro de ICP para ver resultados.
          </div>
        )}
      </div>
    </div>
  );
}
