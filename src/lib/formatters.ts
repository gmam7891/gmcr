export function fmtMoney(v: number | null | undefined, prefix = "R$ "): string {
  if (v == null) return "-";
  return `${prefix}${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null) return "-";
  return Math.round(v).toLocaleString("pt-BR");
}

export function fmtPercent(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "-";
  return `${v.toFixed(decimals).replace(".", ",")}%`;
}
