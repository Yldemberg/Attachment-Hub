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
  templateName: string;
  sourceMlItemId?: string | null;
  sourceAccountId?: string | null;
  accounts: AccountOption[];
  targetAccountId: string;
  onTargetAccountChange: (accountId: string) => void;
  onConfirm: () => void;
  isPending?: boolean;
  blockedReason?: string | null;
};

export function PublishTemplateDialog({
  open,
  onOpenChange,
  templateName,
  sourceMlItemId,
  sourceAccountId,
  accounts,
  targetAccountId,
  onTargetAccountChange,
  onConfirm,
  isPending,
  blockedReason,
}: Props) {
  const sourceLabel =
    accounts.find((a) => a.id === sourceAccountId)?.mlNickname ??
    sourceAccountId?.slice(0, 8) ??
    "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publicar anúncio a partir do modelo</DialogTitle>
          <DialogDescription>
            Será criado um <strong>novo anúncio</strong> na conta escolhida usando o modelo{" "}
            <strong>{templateName}</strong>
            {sourceMlItemId ? <> ({sourceMlItemId})</> : null}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            Origem: <span className="text-foreground font-medium">{sourceLabel}</span>
          </p>

          {blockedReason ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
              {blockedReason}
            </div>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="publish-template-target-account"
                className="text-sm font-medium text-foreground"
              >
                Conta de destino
              </label>
              <select
                id="publish-template-target-account"
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
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending || !targetAccountId || !!blockedReason}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Publicar anúncio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
