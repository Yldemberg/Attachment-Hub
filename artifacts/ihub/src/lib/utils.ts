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
  if (qty == null) return "text-slate-400";
  if (qty < 5) return "text-red-400";
  if (qty <= 20) return "text-amber-400";
  return "text-emerald-400";
}

export function stockBgColor(qty: number | null | undefined): string {
  if (qty == null) return "bg-slate-800 text-slate-400";
  if (qty < 5) return "bg-red-900/40 text-red-400 border border-red-800/50";
  if (qty <= 20) return "bg-amber-900/40 text-amber-400 border border-amber-800/50";
  return "bg-emerald-900/40 text-emerald-400 border border-emerald-800/50";
}
