import { useEffect, useMemo, useRef, useState } from "react";
import {
  useActivatePromotionItem,
  useListPromotionItems,
  useGetPromotion,
  getListPromotionInboxQueryKey,
  getListPromotionItemsQueryKey,
  getGetPromotionQueryKey,
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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Package } from "lucide-react";
import { PromotionTypeBadge } from "./PromotionTypeBadge";
import { PromotionEarningsBlock } from "./PromotionEarningsBlock";
import {
  calcDiscountAmount,
  calcDiscountPercent,
  calcFinalFromDiscount,
  defaultStockValue,
  formatPriceInput,
  formatPromotionValidity,
  getPriceBounds,
  getPromotionActivationConfig,
  mergeItemFields,
  resolveSuggestedDealPrice,
  resolveSuggestedDiscountPercent,
} from "./promotionActivationConfig";

type ItemLike = PromotionItem | PromotionInboxEntry;

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

  const itemId = item
    ? "itemId" in item
      ? item.itemId
      : (item as PromotionItem).itemId
    : "";

  const promotionName =
    item && "promotionName" in item ? item.promotionName : null;
  const promotionTypeLabel =
    item && "promotionTypeLabel" in item ? item.promotionTypeLabel : null;

  const itemParams = useMemo(
    () => ({
      account_id: accountId,
      promotion_type: promotionType,
      item_id: itemId,
      status: "candidate" as const,
      limit: 1,
      refresh: open,
    }),
    [accountId, promotionType, itemId, open],
  );
  const promotionParams = { account_id: accountId, promotion_type: promotionType };

  const { data: itemsData, isLoading: itemLoading } = useListPromotionItems(
    promotionId,
    itemParams,
    {
      query: {
        queryKey: getListPromotionItemsQueryKey(promotionId, itemParams),
        enabled: open && !!itemId,
      },
    },
  );

  const { data: promotion } = useGetPromotion(promotionId, promotionParams, {
    query: {
      queryKey: getGetPromotionQueryKey(promotionId, promotionParams),
      enabled: open,
    },
  });

  const freshItem = itemsData?.data?.[0] ?? null;
  const merged = useMemo(
    () => mergeItemFields(item, freshItem),
    [item, freshItem],
  );

  const config = useMemo(
    () => getPromotionActivationConfig(promotionType),
    [promotionType],
  );
  const priceBounds = getPriceBounds(promotionType, merged);
  const original = merged.originalPrice;

  const [quantity, setQuantity] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [finalPrice, setFinalPrice] = useState("");
  const [topDealPrice, setTopDealPrice] = useState("");
  const [lastEdited, setLastEdited] = useState<"percent" | "price" | null>(null);
  const initializedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedForRef.current = null;
      return;
    }
    if (!item) return;
    // Aguarda dados do ML para pré-preencher sugestões (ex.: LIGHTNING usa campo `price`).
    if (config.hasPriceSuggestion && itemLoading) return;

    const initKey = `${itemId}:${freshItem?.itemId ?? "inbox"}`;
    if (initializedForRef.current === initKey) return;
    initializedForRef.current = initKey;

    const suggestedPrice = resolveSuggestedDealPrice(merged);
    const orig = merged.originalPrice;

    setQuantity(defaultStockValue(merged, config, promotionType));

    if (orig != null && suggestedPrice != null) {
      const pct = resolveSuggestedDiscountPercent(merged, suggestedPrice);
      setDiscountPercent(pct != null ? String(pct) : "");
      setFinalPrice(formatPriceInput(suggestedPrice));
      setLastEdited("percent");
    } else if (orig != null && !config.hasPriceSuggestion) {
      setDiscountPercent("10");
      setFinalPrice(formatPriceInput(calcFinalFromDiscount(orig, 10)));
      setLastEdited("percent");
    } else {
      setDiscountPercent("");
      setFinalPrice("");
      setLastEdited(null);
    }
    setTopDealPrice("");
  }, [open, item, itemId, freshItem, itemLoading, merged, config, promotionType]);

  const { mutate: activate, isPending } = useActivatePromotionItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Promoção ativada", description: "Item incluído na campanha com sucesso." });
        queryClient.invalidateQueries({ queryKey: getListPromotionInboxQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPromotionsSummaryQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getListPromotionItemsQueryKey(promotionId, itemParams),
        });
        onOpenChange(false);
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

  const discountAmount =
    original != null && discountPercent.trim()
      ? calcDiscountAmount(original, parseFloat(discountPercent.replace(",", ".")) || 0)
      : null;

  const validity = formatPromotionValidity(
    merged.startDate ?? promotion?.startDate,
    merged.endDate ?? promotion?.finishDate,
  );

  function handleDiscountChange(raw: string) {
    const normalized = raw.replace(",", ".");
    setDiscountPercent(normalized);
    setLastEdited("percent");
    const pct = parseFloat(normalized);
    if (original != null && normalized.trim() !== "" && !Number.isNaN(pct)) {
      setFinalPrice(formatPriceInput(calcFinalFromDiscount(original, pct)));
    }
  }

  function handleFinalPriceChange(raw: string) {
    const normalized = raw.replace(",", ".");
    setFinalPrice(normalized);
    setLastEdited("price");
    const price = parseFloat(normalized);
    if (original != null && normalized.trim() !== "" && !Number.isNaN(price)) {
      setDiscountPercent(String(calcDiscountPercent(original, price)));
    }
  }

  function handleActivate() {
    const parsedPrice = finalPrice.trim()
      ? parseFloat(finalPrice.replace(",", "."))
      : undefined;
    const parsedStock = quantity.trim() ? parseInt(quantity, 10) : undefined;
    const parsedTop = topDealPrice.trim()
      ? parseFloat(topDealPrice.replace(",", "."))
      : undefined;

    if (config.needsPrice && (parsedPrice == null || Number.isNaN(parsedPrice))) {
      toast({
        title: "Preço obrigatório",
        description: "Informe o preço final da promoção.",
        variant: "destructive",
      });
      return;
    }

    if (config.needsStock && !config.stockOptional) {
      if (parsedStock == null || Number.isNaN(parsedStock) || parsedStock < 1) {
        toast({
          title: "Quantidade obrigatória",
          description: "Informe quantas unidades reservar para esta promoção.",
          variant: "destructive",
        });
        return;
      }
      const total = merged.availableQuantity ?? 0;
      if (total > 0 && parsedStock > total) {
        toast({
          title: "Estoque insuficiente",
          description: `Você tem apenas ${total} unidade(s) disponíveis.`,
          variant: "destructive",
        });
        return;
      }
      if (merged.stockMin != null && parsedStock < merged.stockMin) {
        toast({
          title: "Quantidade abaixo do mínimo",
          description: `Mínimo de ${merged.stockMin} unidade(s) para esta promoção.`,
          variant: "destructive",
        });
        return;
      }
      if (merged.stockMax != null && parsedStock > merged.stockMax) {
        toast({
          title: "Quantidade acima do máximo",
          description: `Máximo de ${merged.stockMax} unidade(s) para esta promoção.`,
          variant: "destructive",
        });
        return;
      }
    }

    if (parsedPrice != null) {
      if (priceBounds.min != null && parsedPrice < priceBounds.min) {
        toast({
          title: "Preço abaixo do permitido",
          description: `O preço mínimo é ${formatCurrency(priceBounds.min)}.`,
          variant: "destructive",
        });
        return;
      }
      if (priceBounds.max != null && parsedPrice > priceBounds.max) {
        toast({
          title: "Preço acima do permitido",
          description: `O preço máximo é ${formatCurrency(priceBounds.max)}.`,
          variant: "destructive",
        });
        return;
      }
    }

    activate({
      promotionId,
      itemId,
      data: {
        accountId,
        promotionType,
        dealPrice: parsedPrice,
        topDealPrice: config.needsTopDealPrice ? parsedTop : undefined,
        stock: config.needsStock || (config.stockOptional && parsedStock != null)
          ? parsedStock
          : undefined,
        offerId: merged.offerId ?? undefined,
      },
    });
  }

  const showStock =
    config.needsStock || config.stockOptional || merged.stockMin != null || merged.stockMax != null;
  const showPrice = config.needsPrice;
  const showTopDeal = config.needsTopDealPrice;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="text-base font-semibold">
            Confirme os detalhes da promoção
          </DialogTitle>
        </DialogHeader>

        {itemLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Product card */}
            <div className="flex gap-3 p-3 bg-muted/40 rounded-xl border border-border">
              {merged.thumbnail ? (
                <img
                  src={merged.thumbnail}
                  alt=""
                  className="size-16 rounded-lg object-cover bg-muted flex-shrink-0"
                />
              ) : (
                <div className="size-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <Package className="w-7 h-7 text-muted-foreground/40" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
                  {merged.title ?? itemId}
                </p>
                {merged.availableQuantity != null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Estoque total:{" "}
                    <span className="font-semibold text-foreground">
                      {merged.availableQuantity} unidade{merged.availableQuantity !== 1 ? "s" : ""}
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* Promotion info */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Promoção:</span>
                <PromotionTypeBadge
                  type={promotionType}
                  label={promotionTypeLabel ?? promotion?.typeLabel ?? undefined}
                />
                {(promotionName ?? promotion?.name) && (
                  <span className="text-xs font-medium text-foreground truncate">
                    {promotionName ?? promotion?.name}
                  </span>
                )}
              </div>
              {validity && (
                <p className="text-xs text-muted-foreground">
                  Vigência: <span className="text-foreground">{validity}</span>
                </p>
              )}
              {config.hasPriceSuggestion && (
                <p className="text-xs text-amber-700 font-medium">
                  Confirme agora e garanta seu lugar!
                </p>
              )}
            </div>

            {/* Quantity */}
            {showStock && (
              <div>
                <Label htmlFor="promo-qty" className="text-sm font-medium">
                  Quantidade de unidades
                  {config.needsStock && !config.stockOptional && (
                    <span className="text-red-600 ml-1">*</span>
                  )}
                </Label>
                {(merged.stockMin != null || merged.stockMax != null) && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Permitido: {merged.stockMin ?? 1}
                    {merged.stockMax != null ? ` — ${merged.stockMax}` : ""} un.
                  </p>
                )}
                <Input
                  id="promo-qty"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))}
                  className="mt-1.5 h-10 text-base font-semibold bg-background"
                />
              </div>
            )}

            {/* Price section */}
            {showPrice && original != null && (
              <div className="space-y-3 pt-1 border-t border-border">
                <div>
                  <Label className="text-sm text-muted-foreground">Preço original</Label>
                  <p className="text-lg font-semibold text-foreground mt-0.5">
                    {formatCurrency(original)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="promo-discount" className="text-sm font-medium">
                      Desconto
                    </Label>
                    <div className="relative mt-1.5">
                      <Input
                        id="promo-discount"
                        type="text"
                        inputMode="decimal"
                        value={discountPercent}
                        onChange={(e) => handleDiscountChange(e.target.value)}
                        className="h-10 pr-8 text-base font-semibold bg-background"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                    {discountAmount != null && lastEdited === "percent" && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Equivale a {formatCurrency(discountAmount)}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="promo-final" className="text-sm font-medium">
                      Preço final
                    </Label>
                    <div className="relative mt-1.5">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        R$
                      </span>
                      <Input
                        id="promo-final"
                        type="text"
                        inputMode="decimal"
                        value={finalPrice}
                        onChange={(e) => handleFinalPriceChange(e.target.value)}
                        className="h-10 pl-9 text-base font-semibold bg-background"
                      />
                    </div>
                  </div>
                </div>

                {(priceBounds.min != null || priceBounds.max != null) && (
                  <p className="text-[11px] text-muted-foreground">
                    Faixa permitida:{" "}
                    {priceBounds.min != null ? formatCurrency(priceBounds.min) : "—"}
                    {" — "}
                    {priceBounds.max != null ? formatCurrency(priceBounds.max) : "—"}
                  </p>
                )}

                {config.hasPriceSuggestion && resolveSuggestedDealPrice(merged) != null && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => {
                      const s = resolveSuggestedDealPrice(merged)!;
                      setFinalPrice(formatPriceInput(s));
                      const pct = resolveSuggestedDiscountPercent(merged, s);
                      if (pct != null) setDiscountPercent(String(pct));
                      setLastEdited("percent");
                    }}
                  >
                    Usar preço sugerido:{" "}
                    {formatCurrency(resolveSuggestedDealPrice(merged) ?? 0)}
                  </button>
                )}

                {(merged.netProceeds?.amount != null ||
                  (merged.feeSubsidyAmount != null && merged.feeSubsidyAmount > 0)) && (
                  <div className="pt-1">
                    <Label className="text-sm text-muted-foreground">Você recebe</Label>
                    <div className="mt-0.5">
                      <PromotionEarningsBlock
                        netProceedsAmount={merged.netProceeds?.amount}
                        feeSubsidyAmount={merged.feeSubsidyAmount}
                        prominent
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {showTopDeal && (
              <div>
                <Label htmlFor="promo-top" className="text-sm font-medium">
                  Preço para compradores nível 3–6 (opcional)
                </Label>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    R$
                  </span>
                  <Input
                    id="promo-top"
                    type="text"
                    inputMode="decimal"
                    value={topDealPrice}
                    onChange={(e) => setTopDealPrice(e.target.value)}
                    className="h-10 pl-9 bg-background"
                  />
                </div>
              </div>
            )}

            {config.confirmOnly && (
              <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3 border border-border">
                Esta campanha não exige definição de preço ou quantidade — confirme para participar.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="px-5 py-4 border-t border-border flex-col sm:flex-col gap-2">
          <Button
            onClick={handleActivate}
            disabled={isPending || itemLoading}
            className="w-full h-11 text-sm font-semibold"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="w-full text-primary hover:text-primary"
          >
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
