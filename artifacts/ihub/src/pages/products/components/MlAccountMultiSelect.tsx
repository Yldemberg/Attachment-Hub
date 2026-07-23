import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export type MlAccountOption = {
  id: string;
  platform?: string | null;
  mlNickname?: string | null;
  mlUserId?: string | null;
  amazonStoreName?: string | null;
  amazonSellerId?: string | null;
};

type MlAccountMultiSelectProps = {
  accounts: MlAccountOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** Texto auxiliar abaixo do label */
  hint?: string;
};

function accountLabel(account: MlAccountOption): string {
  if (account.platform === "amazon") {
    const name = account.amazonStoreName ?? account.amazonSellerId ?? account.id;
    return `Amazon · ${name}`;
  }
  const name = account.mlNickname ?? account.mlUserId ?? account.id;
  return account.platform === "mercadolivre" ? `ML · ${name}` : name;
}

export function MlAccountMultiSelect({
  accounts,
  selectedIds,
  onChange,
  disabled = false,
  hint = "Selecione uma ou mais contas para publicar o anúncio.",
}: MlAccountMultiSelectProps) {
  const selected = new Set(selectedIds);

  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...selectedIds, id]);
      return;
    }
    onChange(selectedIds.filter((x) => x !== id));
  };

  const selectAll = () => {
    onChange(accounts.map((a) => a.id));
  };

  const clearAll = () => {
    onChange([]);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>Contas</Label>
        {accounts.length > 1 ? (
          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              className="text-primary hover:underline disabled:opacity-50"
              onClick={selectAll}
              disabled={disabled || selectedIds.length === accounts.length}
            >
              Todas
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              className="text-muted-foreground hover:underline disabled:opacity-50"
              onClick={clearAll}
              disabled={disabled || selectedIds.length === 0}
            >
              Limpar
            </button>
          </div>
        ) : null}
      </div>

      {accounts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma conta conectada.</p>
      ) : (
        <div className="rounded-lg border border-border bg-input/40 divide-y divide-border max-h-48 overflow-y-auto">
          {accounts.map((account) => {
            const checked = selected.has(account.id);
            return (
              <label
                key={account.id}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40 ${
                  disabled ? "opacity-60 cursor-not-allowed" : ""
                }`}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(value) => toggle(account.id, value === true)}
                />
                <span className="truncate text-foreground">{accountLabel(account)}</span>
              </label>
            );
          })}
        </div>
      )}

      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      {selectedIds.length > 1 ? (
        <p className="text-[11px] text-muted-foreground">
          {selectedIds.length} contas selecionadas — o anúncio será criado em cada uma.
        </p>
      ) : null}
    </div>
  );
}
