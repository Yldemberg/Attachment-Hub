import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | null | undefined, currency = "BRL"): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function stockColor(qty: number | null | undefined): string {
  if (qty == null) return "text-muted-foreground";
  if (qty < 5) return "text-red-600";
  if (qty <= 20) return "text-amber-600";
  return "text-emerald-600";
}

export function stockBgColor(qty: number | null | undefined): string {
  if (qty == null) return "bg-slate-100 text-slate-500";
  if (qty < 5) return "bg-red-50 text-red-600 border border-red-200";
  if (qty <= 20) return "bg-amber-50 text-amber-600 border border-amber-200";
  return "bg-emerald-50 text-emerald-600 border border-emerald-200";
}
