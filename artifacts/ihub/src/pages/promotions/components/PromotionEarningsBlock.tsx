import { cn, formatCurrency } from "@/lib/utils";

type PromotionEarningsBlockProps = {
  netProceedsAmount?: number | null;
  feeSubsidyAmount?: number | null;
  taxPercent?: number | null;
  purchasePrice?: number | null;
  /** Larger amount style for activate dialog */
  prominent?: boolean;
  /** When false, omit "Você Recebe:" (e.g. dialog already has a Label) */
  showReceiveLabel?: boolean;
  className?: string;
};

function formatTaxPercent(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

export function PromotionEarningsBlock({
  netProceedsAmount,
  feeSubsidyAmount,
  taxPercent,
  purchasePrice,
  prominent = false,
  showReceiveLabel = true,
  className,
}: PromotionEarningsBlockProps) {
  const hasNet = netProceedsAmount != null;
  const hasSubsidy = feeSubsidyAmount != null && feeSubsidyAmount > 0;
  const hasTax = taxPercent != null;
  const hasPurchase = purchasePrice != null;
  if (!hasNet && !hasSubsidy && !hasTax && !hasPurchase) return null;

  const amountClass = prominent
    ? "text-lg font-semibold text-foreground tabular-nums"
    : "text-sm font-semibold text-foreground tabular-nums";

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
    </div>
  );
}
