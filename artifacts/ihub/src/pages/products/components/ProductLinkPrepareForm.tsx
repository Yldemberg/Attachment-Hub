import { Loader2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupportedProductUrl } from "./n8n-listing-types";
import {
  MlAccountMultiSelect,
  type MlAccountOption,
} from "./MlAccountMultiSelect";

type ProductLinkPrepareFormProps = {
  accountIds: string[];
  productUrl: string;
  accounts: MlAccountOption[];
  preparing: boolean;
  statusMessage?: string;
  onAccountIdsChange: (ids: string[]) => void;
  onProductUrlChange: (value: string) => void;
  onPrepare: () => void;
  onCancel?: () => void;
};

export function ProductLinkPrepareForm({
  accountIds,
  productUrl,
  accounts,
  preparing,
  statusMessage,
  onAccountIdsChange,
  onProductUrlChange,
  onPrepare,
  onCancel,
}: ProductLinkPrepareFormProps) {
  const urlValid = productUrl.trim().length > 0 && isSupportedProductUrl(productUrl);
  const canPrepare = accountIds.length > 0 && urlValid && !preparing;

  return (
    <div className="space-y-4">
      <MlAccountMultiSelect
        accounts={accounts}
        selectedIds={accountIds}
        onChange={onAccountIdsChange}
        disabled={preparing}
      />

      <div className="space-y-1.5">
        <Label>Link do produto (Amazon ou Shopee)</Label>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={productUrl}
            onChange={(e) => onProductUrlChange(e.target.value)}
            placeholder="https://www.amazon.com.br/... ou https://shopee.com.br/..."
            className="h-9 pl-9"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Cole o link completo do produto. O iHub enviará ao N8N para extrair título, fotos, atributos e descrição.
        </p>
        {productUrl.trim() && !urlValid ? (
          <p className="text-[11px] text-destructive">Use um link válido da Amazon ou Shopee.</p>
        ) : null}
      </div>

      <Button onClick={onPrepare} disabled={!canPrepare} className="w-full sm:w-auto">
        {preparing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
        Preparar Anúncio
      </Button>
      {preparing && statusMessage ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            {statusMessage}
          </p>
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
              Cancelar preparação
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
