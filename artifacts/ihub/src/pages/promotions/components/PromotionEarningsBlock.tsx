import { cn, formatCurrency } from "@/lib/utils";

type PromotionEarningsBlockProps = {
  netProceedsAmount?: number | null;
  feeSubsidyAmount?: number | null;
  taxPercent?: number | null;
  purchasePrice?: number | null;
  /** Preço promocional do anúncio (base do imposto) */
  promoPrice?: number | null;
  /** Larger amount style for activate dialog */
  prominent?: boolean;
  /** When false, omit "Você Recebe:" (e.g. dialog already has a Label) */
  showReceiveLabel?: boolean;
  className?: string;
};

export function calcNetProfit(params: {
  netProceeds: number | null | undefined;
  promoPrice: number | null | undefined;
  taxPercent?: number | null;
  purchasePrice?: number | null;
}): { amount: number; percent: number } | null {
  const { netProceeds, promoPrice } = params;
  if (netProceeds == null || !(promoPrice != null && promoPrice > 0) || !(netProceeds > 0)) {
    return null;
  }
  const taxPct = params.taxPercent != null && Number.isFinite(params.taxPercent) ? params.taxPercent : 0;
  const purchase =
    params.purchasePrice != null && Number.isFinite(params.purchasePrice) ? params.purchasePrice : 0;
  const taxAmount = Math.round(promoPrice * (taxPct / 100) * 100) / 100;
  const amount = Math.round((netProceeds - taxAmount - purchase) * 100) / 100;
  const percent = Math.round((amount / netProceeds) * 10000) / 100;
  return { amount, percent };
}

function formatTaxPercent(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

function formatProfitPercent(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PromotionEarningsBlock({
  netProceedsAmount,
  feeSubsidyAmount,
  taxPercent,
  purchasePrice,
  promoPrice,
  prominent = false,
  showReceiveLabel = true,
  className,
}: PromotionEarningsBlockProps) {
  const hasNet = netProceedsAmount != null;
  const hasSubsidy = feeSubsidyAmount != null && feeSubsidyAmount > 0;
  const hasTax = taxPercent != null;
  const hasPurchase = purchasePrice != null;
  const profit = calcNetProfit({
    netProceeds: netProceedsAmount,
    promoPrice,
    taxPercent,
    purchasePrice,
  });
  if (!hasNet && !hasSubsidy && !hasTax && !hasPurchase && !profit) return null;

  const amountClass = prominent
    ? "text-lg font-semibold text-foreground tabular-nums"
    : "text-sm font-semibold text-foreground tabular-nums";

  const profitTone =
    profit == null
      ? null
      : profit.amount >= 0
        ? "text-emerald-600"
        : "text-red-600";

  return (
    <div className={cn(className)}>
      {hasNet && (
        <p className={cn(amountClass, "leading-snug")}>
          {showReceiveLabel && (
            <span className="font-medium text-muted-foreground">Você Recebe: </span>
          )}
          <span className="text-foreground">{formatCurrency(netProceedsAmount)}</span>
        </p>
      )}
      {hasSubsidy && (
        <p className={cn("text-xs text-emerald-600 leading-snug", hasNet && "mt-0.5")}>
          Reduzimos {formatCurrency(feeSubsidyAmount)} das suas tarifas por cada venda
        </p>
      )}
      {(hasTax || hasPurchase) && (
        <p
          className={cn(
            "text-xs text-muted-foreground leading-snug tabular-nums",
            (hasNet || hasSubsidy) && "mt-0.5",
          )}
        >
          {hasTax && <span>Imposto: {formatTaxPercent(taxPercent)}%</span>}
          {hasTax && hasPurchase && <span className="mx-1.5 text-border">·</span>}
          {hasPurchase && <span>Preço de compra: {formatCurrency(purchasePrice)}</span>}
        </p>
      )}
      {profit && profitTone && (
        <div
          className={cn(
            "text-xs font-medium leading-snug tabular-nums",
            profitTone,
            (hasNet || hasSubsidy || hasTax || hasPurchase) && "mt-0.5",
          )}
        >
          <p>% Lucro Líquido: {formatProfitPercent(profit.percent)}%</p>
          <p>$ Lucro Líquido: {formatCurrency(profit.amount)}</p>
        </div>
      )}
    </div>
  );
}
