import { NumberField, FieldSection } from "@/components/FieldGroup";
import type { FieldDef } from "@/lib/instagram/campaignTypes";

interface Props {
  fields: FieldDef[];
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
  title: string;
}

export function DynamicCampaignFields({ fields, values, onChange, title }: Props) {
  return (
    <FieldSection title={title}>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <NumberField
            key={field.key}
            label={field.label}
            value={values[field.key] ?? field.defaultValue ?? 0}
            onChange={(v) => onChange(field.key, v)}
            step={field.step ?? 1}
            suffix={field.type === "percent" ? "%" : field.type === "currency" ? "R$" : undefined}
          />
        ))}
      </div>
    </FieldSection>
  );
}
