import type { MlCategoryAttribute } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ListingFormAttribute } from "./listing-constants";

type Props = {
  attributes: MlCategoryAttribute[];
  values: ListingFormAttribute[];
  onChange: (values: ListingFormAttribute[]) => void;
  disabled?: boolean;
};

function isAttributeRequired(attr: MlCategoryAttribute): boolean {
  return attr.tags?.required === true || attr.tags?.catalog_required === true;
}

function isAttributeEditable(attr: MlCategoryAttribute): boolean {
  if (attr.tags?.read_only || attr.tags?.fixed) return false;
  if (attr.id === "ITEM_CONDITION") return false;
  return true;
}

export function DynamicAttributesForm({ attributes, values, onChange, disabled }: Props) {
  const editable = attributes.filter(isAttributeEditable);

  const getValue = (id: string) => values.find((v) => v.id === id)?.value_name ?? "";

  const setValue = (id: string, value_name: string, value_id?: string) => {
    const next = values.filter((v) => v.id !== id);
    if (value_name.trim()) {
      next.push({ id, value_name: value_name.trim(), value_id });
    }
    onChange(next);
  };

  if (editable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum atributo adicional necessário para esta categoria.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {editable.map((attr) => {
        const required = isAttributeRequired(attr);
        const hasList = Array.isArray(attr.values) && attr.values.length > 0;
        const value = getValue(attr.id);

        return (
          <div key={attr.id} className="space-y-1.5">
            <Label className="text-sm">
              {attr.name}
              {required ? <span className="text-destructive ml-0.5">*</span> : null}
            </Label>
            {attr.hint ? (
              <p className="text-[11px] text-muted-foreground">{attr.hint}</p>
            ) : null}
            {hasList ? (
              <select
                value={value}
                disabled={disabled}
                onChange={(e) => {
                  const selected = attr.values!.find((v) => v.name === e.target.value);
                  setValue(attr.id, e.target.value, selected?.id);
                }}
                className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Selecione…</option>
                {attr.values!.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : attr.valueType === "boolean" ? (
              <select
                value={value}
                disabled={disabled}
                onChange={(e) => setValue(attr.id, e.target.value)}
                className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Selecione…</option>
                <option value="Sim">Sim</option>
                <option value="Não">Não</option>
              </select>
            ) : (
              <Input
                type={attr.valueType === "number" || attr.valueType === "number_unit" ? "number" : "text"}
                value={value}
                disabled={disabled}
                onChange={(e) => setValue(attr.id, e.target.value)}
                placeholder={attr.name}
                className="h-9 text-sm"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function validateRequiredAttributes(
  attributes: MlCategoryAttribute[],
  values: ListingFormAttribute[],
): string | null {
  const missing = attributes
    .filter(isAttributeEditable)
    .filter(isAttributeRequired)
    .filter((a) => !values.some((v) => v.id === a.id && v.value_name.trim()));

  if (missing.length > 0) {
    return `Preencha os atributos obrigatórios: ${missing.map((m) => m.name).join(", ")}`;
  }
  return null;
}
