import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2 } from "lucide-react";
import { Link } from "wouter";

type AccountOption = {
  id: string;
  mlNickname?: string | null;
  mlUserId?: string | null;
};

export type PublishedListingRef = {
  productId: string;
  mlItemId: string;
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
  /** Mantém o diálogo aberto após publicar; lista anúncios criados nesta sessão. */
  publishedListings?: PublishedListingRef[];
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
  publishedListings = [],
}: Props) {
  const sourceLabel =
    accounts.find((a) => a.id === sourceAccountId)?.mlNickname ??
    sourceAccountId?.slice(0, 8) ??
    "—";

  const lastPublished = publishedListings[publishedListings.length - 1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publicar anúncio a partir do modelo</DialogTitle>
          <DialogDescription>
            Será criado um <strong>novo anúncio</strong> na conta escolhida usando o modelo{" "}
            <strong>{templateName}</strong>
            {sourceMlItemId ? <> ({sourceMlItemId})</> : null}. Você pode publicar várias vezes
            sem fechar esta janela.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            Origem: <span className="text-foreground font-medium">{sourceLabel}</span>
          </p>

          {lastPublished && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-800 space-y-1">
              <p className="font-medium">
                Anúncio publicado:{" "}
                <span className="font-mono">{lastPublished.mlItemId}</span>
              </p>
              <Link
                href={`/products/${lastPublished.productId}`}
                className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-medium"
              >
                <ExternalLink className="w-3 h-3" />
                Abrir anúncio no iHub
              </Link>
              {publishedListings.length > 1 && (
                <p className="text-emerald-700/80">
                  {publishedListings.length} anúncios publicados nesta sessão.
                </p>
              )}
            </div>
          )}

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

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Fechar
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending || !targetAccountId || !!blockedReason}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {lastPublished ? "Publicar outro" : "Publicar anúncio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
