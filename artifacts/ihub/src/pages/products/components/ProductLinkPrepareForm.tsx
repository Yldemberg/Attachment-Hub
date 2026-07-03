import { Loader2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupportedProductUrl } from "./n8n-listing-types";

type AccountOption = {
  id: string;
  mlNickname?: string | null;
  mlUserId?: string | null;
};

type ProductLinkPrepareFormProps = {
  accountId: string;
  productUrl: string;
  accounts: AccountOption[];
  preparing: boolean;
  onAccountIdChange: (value: string) => void;
  onProductUrlChange: (value: string) => void;
  onPrepare: () => void;
};

export function ProductLinkPrepareForm({
  accountId,
  productUrl,
  accounts,
  preparing,
  onAccountIdChange,
  onProductUrlChange,
  onPrepare,
}: ProductLinkPrepareFormProps) {
  const urlValid = productUrl.trim().length > 0 && isSupportedProductUrl(productUrl);
  const canPrepare = accountId.length > 0 && urlValid && !preparing;

  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Conta Mercado Livre</Label>
        <select value={accountId} onChange={(e) => onAccountIdChange(e.target.value)} className={selectCls}>
          <option value="">Selecione a conta…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.mlNickname ?? a.mlUserId ?? a.id}
            </option>
          ))}
        </select>
      </div>

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
    </div>
  );
}
