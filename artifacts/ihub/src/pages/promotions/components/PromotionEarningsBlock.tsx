import { cn, formatCurrency } from "@/lib/utils";

type PromotionEarningsBlockProps = {
  netProceedsAmount?: number | null;
  feeSubsidyAmount?: number | null;
  /** Larger amount style for activate dialog */
  prominent?: boolean;
  className?: string;
};

export function PromotionEarningsBlock({
  netProceedsAmount,
  feeSubsidyAmount,
  prominent = false,
  className,
}: PromotionEarningsBlockProps) {
  const hasNet = netProceedsAmount != null;
  const hasSubsidy = feeSubsidyAmount != null && feeSubsidyAmount > 0;
  if (!hasNet && !hasSubsidy) return null;

  return (
    <div className={cn(className)}>
      {hasNet && (
        <p
          className={
            prominent
              ? "text-lg font-semibold text-foreground tabular-nums"
              : "text-sm font-semibold text-foreground tabular-nums"
          }
        >
          {formatCurrency(netProceedsAmount)}
        </p>
      )}
      {hasSubsidy && (
        <p className={cn("text-xs text-emerald-600 leading-snug", hasNet && "mt-0.5")}>
          Reduzimos {formatCurrency(feeSubsidyAmount)} das suas tarifas por cada venda
        </p>
      )}
    </div>
  );
}
