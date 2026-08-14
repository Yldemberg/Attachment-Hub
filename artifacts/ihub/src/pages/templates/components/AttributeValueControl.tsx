import type { MlCategoryAttribute } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CUSTOM_VALUE = "__custom__";

const selectCls =
  "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60";

type Props = {
  meta?: MlCategoryAttribute | null;
  valueName: string;
  valueId?: string;
  onChange: (value_name: string, value_id?: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

function normalizeYesNo(value: string): "Sim" | "Não" | "" {
  const v = value.trim().toLowerCase();
  if (["sim", "yes", "true", "1"].includes(v)) return "Sim";
  if (["não", "nao", "no", "false", "0"].includes(v)) return "Não";
  return "";
}

function optionForYesNo(
  meta: MlCategoryAttribute | null | undefined,
  label: "Sim" | "Não",
) {
  const aliases = label === "Sim" ? ["sim", "yes"] : ["não", "nao", "no"];
  return meta?.values?.find((v) => aliases.includes(v.name.trim().toLowerCase()));
}

function isBooleanAttribute(meta?: MlCategoryAttribute | null): boolean {
  if (!meta) return false;
  if (meta.valueType === "boolean") return true;
  const names = (meta.values ?? []).map((v) => v.name.trim().toLowerCase());
  const hasPt = names.includes("sim") && names.includes("não");
  const hasEn = names.includes("yes") && names.includes("no");
  return hasPt || hasEn;
}

function allowsCustomValue(meta: MlCategoryAttribute): boolean {
  if (meta.valueType === "list" || meta.valueType === "boolean") return false;
  return Array.isArray(meta.values) && meta.values.length > 0;
}

export function AttributeValueControl({
  meta,
  valueName,
  valueId,
  onChange,
  disabled,
  placeholder,
}: Props) {
  if (isBooleanAttribute(meta)) {
    const current = normalizeYesNo(valueName);
    const pick = (label: "Sim" | "Não") => {
      if (current === label) {
        onChange("", undefined);
        return;
      }
      onChange(label, optionForYesNo(meta, label)?.id);
    };
    return (
      <div className="flex gap-2 flex-1">
        {(["Sim", "Não"] as const).map((label) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => pick(label)}
            className={cn(
              "h-9 px-4 rounded-lg border text-sm font-medium transition-colors disabled:opacity-60",
              current === label
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-input border-border text-foreground hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }

  const options = meta?.values ?? [];
  if (options.length > 0 && meta) {
    const match =
      options.find((o) => o.id && o.id === valueId) ??
      options.find((o) => o.name === valueName);
    const customAllowed = allowsCustomValue(meta);
    const isCustom = !match && valueName.trim().length > 0;
    const selectCurrent = match ? match.name : isCustom ? CUSTOM_VALUE : "";

    return (
      <div className="flex-1 min-w-0 space-y-2">
        <select
          value={selectCurrent}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CUSTOM_VALUE) {
              onChange(isCustom ? valueName : "", undefined);
              return;
            }
            if (!next) {
              onChange("", undefined);
              return;
            }
            const selected = options.find((o) => o.name === next);
            onChange(next, selected?.id);
          }}
          className={selectCls}
        >
          <option value="">Selecione…</option>
          {options.map((opt) => (
            <option key={opt.id || opt.name} value={opt.name}>
              {opt.name}
            </option>
          ))}
          {(customAllowed || isCustom) && <option value={CUSTOM_VALUE}>Outro (digitar)</option>}
        </select>
        {selectCurrent === CUSTOM_VALUE ? (
          <Input
            value={valueName}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value, undefined)}
            placeholder={placeholder ?? "Digite o valor"}
            className="h-9"
          />
        ) : null}
      </div>
    );
  }

  return (
    <Input
      value={valueName}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value, undefined)}
      placeholder={placeholder}
      className="h-9 flex-1"
    />
  );
}
