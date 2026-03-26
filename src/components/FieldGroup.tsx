import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  className?: string;
}

export function NumberField({ label, value, onChange, step = 1, min = 0, max, suffix, className }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[11px] leading-tight text-muted-foreground uppercase tracking-wider">
        {label}{suffix && <span className="text-muted-foreground/60 ml-1 normal-case">({suffix})</span>}
      </Label>
      <Input
        type="number"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        step={step}
        min={min}
        max={max}
        className="font-mono bg-secondary border-border"
      />
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function FieldSection({ title, children, className }: SectionProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}
