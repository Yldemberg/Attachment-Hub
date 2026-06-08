import { cn } from "@/lib/utils";
import {
  Tag,
  Percent,
  Zap,
  Gift,
  Sparkles,
  Ticket,
  TrendingDown,
  Package,
} from "lucide-react";

const TYPE_CONFIG: Record<
  string,
  { label: string; className: string; Icon: typeof Tag }
> = {
  DEAL: {
    label: "DEAL",
    className: "bg-red-50 text-red-700 border-red-200",
    Icon: Tag,
  },
  MARKETPLACE_CAMPAIGN: {
    label: "Co-fondeada",
    className: "bg-violet-50 text-violet-700 border-violet-200",
    Icon: Gift,
  },
  VOLUME: {
    label: "Volume",
    className: "bg-sky-50 text-sky-700 border-sky-200",
    Icon: Package,
  },
  LIGHTNING: {
    label: "Relâmpago",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    Icon: Zap,
  },
  DOD: {
    label: "Oferta do dia",
    className: "bg-orange-50 text-orange-700 border-orange-200",
    Icon: Sparkles,
  },
  SELLER_CAMPAIGN: {
    label: "Própria",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Icon: Percent,
  },
  PRICE_DISCOUNT: {
    label: "Desconto",
    className: "bg-rose-50 text-rose-700 border-rose-200",
    Icon: Percent,
  },
  PRE_NEGOTIATED: {
    label: "Pré-acordado",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200",
    Icon: Tag,
  },
  SMART: {
    label: "Automática",
    className: "bg-teal-50 text-teal-700 border-teal-200",
    Icon: Sparkles,
  },
  PRICE_MATCHING: {
    label: "Competitivo",
    className: "bg-cyan-50 text-cyan-700 border-cyan-200",
    Icon: TrendingDown,
  },
  UNHEALTHY_STOCK: {
    label: "Liquidação",
    className: "bg-slate-100 text-slate-700 border-slate-200",
    Icon: Package,
  },
  SELLER_COUPON_CAMPAIGN: {
    label: "Cupom",
    className: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
    Icon: Ticket,
  },
};

export function PromotionTypeBadge({
  type,
  label,
  className,
}: {
  type: string;
  label?: string | null;
  className?: string;
}) {
  const cfg = TYPE_CONFIG[type] ?? {
    label: type,
    className: "bg-slate-100 text-slate-600 border-slate-200",
    Icon: Tag,
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border uppercase tracking-wide",
        cfg.className,
        className,
      )}
    >
      <cfg.Icon className="w-3 h-3" aria-hidden />
      {label ?? cfg.label}
    </span>
  );
}

export function formatDeadline(deadline?: string | null): string | null {
  if (!deadline) return null;
  const dl = new Date(deadline);
  const now = new Date();
  const diffMs = dl.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Encerrado";
  if (diffDays === 0) return "Vence hoje";
  if (diffDays === 1) return "Vence amanhã";
  return `${diffDays} dias`;
}
