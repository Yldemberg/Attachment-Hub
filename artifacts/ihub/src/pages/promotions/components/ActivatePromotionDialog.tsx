import { useState } from "react";
import {
  useActivatePromotionItem,
  getListPromotionInboxQueryKey,
  getListPromotionItemsQueryKey,
  getGetPromotionsSummaryQueryKey,
  getListPromotionsQueryKey,
} from "@workspace/api-client-react";
import type { PromotionItem, PromotionInboxEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type ItemLike = PromotionItem | PromotionInboxEntry;

const NO_PRICE_TYPES = [
  "VOLUME",
  "MARKETPLACE_CAMPAIGN",
  "SMART",
  "PRICE_MATCHING",
  "PRE_NEGOTIATED",
];

export function ActivatePromotionDialog({
  open,
  onOpenChange,
  promotionId,
  promotionType,
  accountId,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promotionId: string;
  promotionType: string;
  accountId: string;
  item: ItemLike | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const suggested =
    "suggestedDiscountedPrice" in (item ?? {})
      ? item?.suggestedDiscountedPrice
      : (item as PromotionItem | null)?.suggestedDiscountedPrice;
  const minPrice =
    "minDiscountedPrice" in (item ?? {})
      ? item?.minDiscountedPrice
      : (item as PromotionItem | null)?.minDiscountedPrice;
  const maxPrice =
    "maxDiscountedPrice" in (item ?? {})
      ? item?.maxDiscountedPrice
      : (item as PromotionItem | null)?.maxDiscountedPrice;
  const original =
    "originalPrice" in (item ?? {})
      ? item?.originalPrice
      : (item as PromotionItem | null)?.originalPrice;

  const [dealPrice, setDealPrice] = useState("");
  const needsPrice = item ? !NO_PRICE_TYPES.includes(promotionType) : true;

  const { mutate: activate, isPending } = useActivatePromotionItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Promoção ativada", description: "Item incluído na campanha com sucesso." });
        queryClient.invalidateQueries({ queryKey: getListPromotionInboxQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPromotionsSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPromotionItemsQueryKey() });
        onOpenChange(false);
        setDealPrice("");
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : "Não foi possível ativar a promoção.";
        toast({ title: "Erro ao ativar", description: msg, variant: "destructive" });
      },
    },
  });

  if (!item) return null;

  const itemId = "itemId" in item ? item.itemId : (item as PromotionItem).itemId;
  const title = item.title ?? itemId;

  function handleActivate() {
    const parsed = dealPrice.trim() ? parseFloat(dealPrice.replace(",", ".")) : undefined;
    if (needsPrice && (parsed == null || Number.isNaN(parsed))) {
      toast({
        title: "Preço obrigatório",
        description: "Informe o preço promocional para este tipo de campanha.",
        variant: "destructive",
      });
      return;
    }
    if (parsed != null && minPrice != null && parsed < minPrice) {
      toast({
        title: "Preço abaixo do mínimo",
        description: `O preço mínimo permitido é ${formatCurrency(minPrice)}.`,
        variant: "destructive",
      });
      return;
    }
    if (parsed != null && maxPrice != null && parsed > maxPrice) {
      toast({
        title: "Preço acima do máximo",
        description: `O preço máximo permitido é ${formatCurrency(maxPrice)}.`,
        variant: "destructive",
      });
      return;
    }

    activate({
      promotionId,
      itemId,
      data: {
        accountId,
        promotionType,
        dealPrice: parsed,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ativar promoção</DialogTitle>
          <DialogDescription className="line-clamp-2">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {original != null && (
            <p className="text-sm text-muted-foreground">
              Preço original: <span className="font-medium text-foreground">{formatCurrency(original)}</span>
            </p>
          )}
          {suggested != null && (
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => setDealPrice(String(suggested))}
            >
              Usar preço sugerido: {formatCurrency(suggested)}
            </button>
          )}
          {(minPrice != null || maxPrice != null) && (
            <p className="text-xs text-muted-foreground">
              Faixa permitida:{" "}
              {minPrice != null ? formatCurrency(minPrice) : "—"} —{" "}
              {maxPrice != null ? formatCurrency(maxPrice) : "—"}
            </p>
          )}
          {needsPrice && (
            <div>
              <Label htmlFor="deal-price">Preço promocional</Label>
              <Input
                id="deal-price"
                type="number"
                min={0}
                step="0.01"
                value={dealPrice}
                onChange={(e) => setDealPrice(e.target.value)}
                placeholder={suggested != null ? String(suggested) : "0,00"}
                className="mt-1"
              />
            </div>
          )}
          {!needsPrice && (
            <p className="text-sm text-muted-foreground">
              Este tipo de campanha não exige definição de preço — confirme para participar.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleActivate} disabled={isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
