import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type AccountOption = {
  id: string;
  mlNickname?: string | null;
  mlUserId?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  mlItemId?: string | null;
  sourceAccountId?: string | null;
  accounts: AccountOption[];
  targetAccountId: string;
  onTargetAccountChange: (accountId: string) => void;
  onConfirm: () => void;
  isPending?: boolean;
};

export function DuplicateListingDialog({
  open,
  onOpenChange,
  title,
  mlItemId,
  sourceAccountId,
  accounts,
  targetAccountId,
  onTargetAccountChange,
  onConfirm,
  isPending,
}: Props) {
  const sourceLabel =
    accounts.find((a) => a.id === sourceAccountId)?.mlNickname ??
    sourceAccountId?.slice(0, 8) ??
    "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replicar anúncio</DialogTitle>
          <DialogDescription>
            Será criado um <strong>novo anúncio</strong> na conta escolhida, copiando fotos, descrição,
            atributos, preço, estoque e condições de venda de <strong>{title}</strong>
            {mlItemId ? <> ({mlItemId})</> : null}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            Origem: <span className="text-foreground font-medium">{sourceLabel}</span>
          </p>
          <div className="space-y-1.5">
            <label htmlFor="duplicate-target-account" className="text-sm font-medium text-foreground">
              Conta de destino
            </label>
            <select
              id="duplicate-target-account"
              value={targetAccountId}
              onChange={(e) => onTargetAccountChange(e.target.value)}
              disabled={isPending || accounts.length === 0}
              className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {accounts.length === 0 ? (
                <option value="">Nenhuma conta conectada</option>
              ) : (
                accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.mlNickname ?? a.mlUserId ?? a.id}
                    {a.id === sourceAccountId ? " (mesma conta)" : ""}
                  </option>
                ))
              )}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Anúncios Full, de catálogo ou com variações não podem ser replicados automaticamente.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={isPending || !targetAccountId}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Replicar anúncio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
