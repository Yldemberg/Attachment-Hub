import { useMemo, useState } from "react";
import {
  useListOrders,
  useListAccounts,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import type { Order as ApiOrder } from "@workspace/api-client-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ShoppingCart, Package, Truck, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";

type Order = ApiOrder & {
  account?: { id: string; mlNickname?: string | null; mlUserId?: string | null } | null;
};

interface OrderItem {
  item_id: string;
  title: string;
  quantity: number;
  price: number;
  thumbnail?: string | null;
  sku?: string | null;
  /** Modalidades do anúncio (pode listar mais de uma, ex. Full e Flex). */
  logistic_type?: string | null;
  /** Envio concretizado na venda (shipment), ex. Flex no checkout. */
  sale_logistic_type?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmado",
  paid: "Pago",
  payment_required: "Ag. pagamento",
  payment_in_process: "Pag. em andamento",
  partially_refunded: "Parcialm. reembolsado",
  pending_cancel: "Cancel. pendente",
  cancelled: "Cancelado",
  invalid: "Inválido",
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  payment_required: "bg-amber-50 text-amber-700 border-amber-200",
  payment_in_process: "bg-sky-50 text-sky-700 border-sky-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
  invalid: "bg-red-50 text-red-600 border-red-200",
};

/** Calendário no fuso do Mercado Livre Brasil (pedidos / pagamento). */
const REPORT_TZ = "America/Sao_Paulo";

function formatYmdSp(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDaysSp(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const anchorUtc = Date.UTC(y, m - 1, d, 15, 0, 0);
  return formatYmdSp(new Date(anchorUtc + deltaDays * 86400000));
}

function calendarPartsSp(): { y: number; m: number; d: number } {
  const ymd = formatYmdSp(new Date());
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function ymdParts(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

type PeriodPreset =
  | "all"
  | "yesterday"
  | "today"
  | "last7"
  | "last15"
  | "month_current"
  | "month_previous"
  | "custom";

function dateRangeForPreset(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
): { date_from?: string; date_to?: string } {
  const today = formatYmdSp(new Date());
  switch (preset) {
    case "all":
      return {};
    case "today":
      return { date_from: today, date_to: today };
    case "yesterday": {
      const y = addCalendarDaysSp(today, -1);
      return { date_from: y, date_to: y };
    }
    case "last7":
      return { date_from: addCalendarDaysSp(today, -6), date_to: today };
    case "last15":
      return { date_from: addCalendarDaysSp(today, -14), date_to: today };
    case "month_current": {
      const { y, m } = calendarPartsSp();
      return { date_from: ymdParts(y, m, 1), date_to: today };
    }
    case "month_previous": {
      const { y, m } = calendarPartsSp();
      const firstCurrent = ymdParts(y, m, 1);
      const lastPrev = addCalendarDaysSp(firstCurrent, -1);
      let pm = m - 1,
        py = y;
      if (pm < 1) {
        pm = 12;
        py--;
      }
      const firstPrev = ymdParts(py, pm, 1);
      return { date_from: firstPrev, date_to: lastPrev };
    }
    case "custom":
      if (!customFrom?.trim() || !customTo?.trim()) return {};
      return customFrom <= customTo
        ? { date_from: customFrom, date_to: customTo }
        : { date_from: customTo, date_to: customFrom };
    default:
      return {};
  }
}

function formatIsoDatePtBr(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

function periodSummaryLabel(preset: PeriodPreset, customFrom: string, customTo: string): string {
  switch (preset) {
    case "all":
      return "Todos os períodos";
    case "today":
      return "Hoje";
    case "yesterday":
      return "Ontem";
    case "last7":
      return "Últimos 7 dias";
    case "last15":
      return "Últimos 15 dias";
    case "month_current":
      return "Mês atual";
    case "month_previous":
      return "Mês passado";
    case "custom":
      if (customFrom && customTo) {
        return `${formatIsoDatePtBr(customFrom)} — ${formatIsoDatePtBr(customTo)}`;
      }
      return "Por período (defina as datas)";
    default:
      return "";
  }
}

const LOGISTIC_LABELS: Record<string, { label: string; cls: string }> = {
  fulfillment: { label: "Full", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  cross_docking: { label: "Cross-docking", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  self_service: { label: "Flex", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  self_service_in: { label: "Flex", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  /** Mercado Envíos padrão (ex. `logistic.type` no shipment). */
  drop_off: { label: "Padrão", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  default: { label: "Padrão", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

/**
 * Status de envio persistido após `GET /shipments/:id` na sync/webhook
 * (`shipping_status` + `shipping_substatus`). O objeto `shipping` em `GET /orders` costuma vir incompleto.
 */
function shipmentFulfillmentBadges(
  shippingStatus: string | null | undefined,
  shippingSubstatus: string | null | undefined,
): { key: string; label: string; cls: string }[] {
  const st = shippingStatus?.trim().toLowerCase() ?? "";
  const ss = shippingSubstatus?.trim().toLowerCase() ?? "";
  if (st === "shipped") {
    return [{ key: "in_transit", label: "Em trânsito", cls: "bg-sky-50 text-sky-800 border-sky-200" }];
  }
  if (ss === "ready_to_print") {
    return [];
  }
  if (ss === "printed" || st === "ready_to_ship") {
    return [{ key: "label_done", label: "Etiqueta emitida", cls: "bg-violet-50 text-violet-800 border-violet-200" }];
  }
  return [];
}

function LogisticBadge({ type, prefix }: { type?: string | null; prefix?: string }) {
  if (!type) return null;
  const types = type.split(",").map((t) => t.trim()).filter(Boolean);
  if (types.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {prefix && <span className="text-[9px] text-muted-foreground font-medium shrink-0">{prefix}</span>}
      {types.map((t) => {
        const { label, cls } = LOGISTIC_LABELS[t] ?? LOGISTIC_LABELS.default;
        return (
          <span key={t} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>
            {label}
          </span>
        );
      })}
    </span>
  );
}

function OrderCard({ o }: { o: Order }) {
  const shipBadges = shipmentFulfillmentBadges(o.shippingStatus, o.shippingSubstatus);
  const items = (o.itemsJson as unknown as OrderItem[]) ?? [];
  const firstItem = items[0];
  const totalQty = items.reduce((s, i) => s + (i.quantity ?? 0), 0);
  const listingLogisticKeys = [
    ...new Set(
      items.flatMap((i) =>
        (i.logistic_type ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ),
  ];
  const saleLogistic = items.find((i) => i.sale_logistic_type)?.sale_logistic_type ?? null;

  return (
    <Link to={`/orders/${o.id}`}>
      <div className="flex items-center gap-3 bg-card border border-card-border rounded-xl px-4 py-3 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer">
        {firstItem?.thumbnail ? (
          <img
            src={firstItem.thumbnail}
            alt=""
            className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-muted"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-muted-foreground/40" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-primary text-xs font-mono font-medium">
              #{o.mlOrderId ?? o.id.slice(0, 8)}
            </span>
            {listingLogisticKeys.map((lt) => (
              <LogisticBadge key={`a-${lt}`} type={lt} />
            ))}
            {saleLogistic && (
              <span className="inline-flex items-center ml-0.5 pl-1.5 border-l border-border">
                <LogisticBadge type={saleLogistic} prefix="Venda:" />
              </span>
            )}
          </div>
          <p className="text-foreground text-sm truncate font-medium">
            {firstItem?.title ?? "—"}
            {items.length > 1 && (
              <span className="text-muted-foreground ml-1 font-normal text-xs">+{items.length - 1}</span>
            )}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {firstItem?.sku && (
              <span className="text-[10px] text-muted-foreground font-mono">SKU: {firstItem.sku}</span>
            )}
            {totalQty > 0 && (
              <span className="text-[10px] text-muted-foreground">× {totalQty} un.</span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0 min-w-[120px]">
          <div className="flex items-center gap-1.5">
            {o.account?.mlNickname && (
              <span className="text-[10px] text-primary flex items-center gap-1">
                <Truck className="w-2.5 h-2.5" />
                {o.account.mlNickname}
              </span>
            )}
          </div>
          <p className="text-amber-600 text-sm font-semibold">
            {formatCurrency(o.totalAmount, o.currencyId ?? "BRL")}
          </p>
          <p className="text-muted-foreground text-[10px]">
            {formatDateTime(o.dateClosed ?? o.dateCreated ?? o.createdAt)}
          </p>
        </div>

        <div className="flex-shrink-0 flex flex-col gap-1 items-end">
          <span className={`text-[10px] font-medium px-2 py-1 rounded-lg border ${STATUS_COLORS[o.status ?? ""] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
            {STATUS_LABELS[o.status ?? ""] ?? o.status ?? "—"}
          </span>
          {shipBadges.map((b) => (
            <span
              key={b.key}
              className={`text-[10px] font-medium px-2 py-1 rounded-lg border ${b.cls}`}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

export default function Orders() {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [statusFilter, setStatusFilter] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("all");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");

  const dateRange = useMemo(
    () => dateRangeForPreset(periodPreset, customDateFrom, customDateTo),
    [periodPreset, customDateFrom, customDateTo],
  );

  const params = {
    page,
    limit: rowsPerPage,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(accountId !== "all" ? { account_id: accountId } : {}),
    ...(dateRange.date_from ? { date_from: dateRange.date_from } : {}),
    ...(dateRange.date_to ? { date_to: dateRange.date_to } : {}),
  };

  const periodHasFilter =
    periodPreset !== "all" &&
    (periodPreset !== "custom" || !!(customDateFrom && customDateTo));

  const customPeriodIncomplete =
    periodPreset === "custom" && (!customDateFrom || !customDateTo);

  const { data, isLoading } = useListOrders(params, {
    query: { queryKey: getListOrdersQueryKey(params) },
  });
  const orders: Order[] = (data?.data ?? []) as Order[];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-foreground">Pedidos</h1>
            <p className="text-muted-foreground text-xs">
              <span className={`font-semibold tabular-nums ${periodHasFilter ? "text-foreground" : ""}`}>
                {pagination?.total ?? 0}
              </span>
              {" "}
              {periodHasFilter ? (
                <>
                  pedidos no período
                  <span className="font-normal">
                    {" "}
                    · {periodSummaryLabel(periodPreset, customDateFrom, customDateTo)}
                  </span>
                </>
              ) : customPeriodIncomplete ? (
                <>
                  pedidos encontrados
                  <span className="font-normal"> · informe “Do dia” e “ao dia” para filtrar</span>
                </>
              ) : (
                <>pedidos encontrados</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {([20, 50] as const).map((n) => (
              <button
                key={n}
                onClick={() => { setRowsPerPage(n); setPage(1); }}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${rowsPerPage === n ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-accent"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={periodPreset}
            onValueChange={(v) => {
              setPeriodPreset(v as PeriodPreset);
              setPage(1);
            }}
          >
            <SelectTrigger className="min-w-[220px] max-w-[min(100%,280px)] text-xs h-7">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os períodos</SelectItem>
              <SelectItem value="yesterday">Ontem</SelectItem>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="last7">Últimos 7 dias</SelectItem>
              <SelectItem value="last15">Últimos 15 dias</SelectItem>
              <SelectItem value="month_current">Mês atual</SelectItem>
              <SelectItem value="month_previous">Mês passado</SelectItem>
              <SelectItem value="custom">Por período</SelectItem>
            </SelectContent>
          </Select>

          {periodPreset === "custom" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Do dia:</span>
              <Input
                type="date"
                value={customDateFrom}
                onChange={(e) => {
                  setCustomDateFrom(e.target.value);
                  setPage(1);
                }}
                className="w-[132px] h-7 text-xs"
              />
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">ao dia:</span>
              <Input
                type="date"
                value={customDateTo}
                onChange={(e) => {
                  setCustomDateTo(e.target.value);
                  setPage(1);
                }}
                className="w-[132px] h-7 text-xs"
              />
            </div>
          )}

          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44 text-xs h-7">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="confirmed">Confirmado</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
              <SelectItem value="payment_required">Aguardando pagamento</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>

          {accounts.length > 0 && (
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
              <SelectTrigger className="w-36 text-xs h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.mlNickname ?? a.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-card border border-card-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <ShoppingCart className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm">Nenhum pedido encontrado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => <OrderCard key={o.id} o={o} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 py-2">
            <p className="text-muted-foreground text-xs">
              Página {page} de {totalPages} · {pagination?.total ?? 0} registros
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1">
                {(() => {
                  const btnCls = (n: number) =>
                    `w-7 h-7 rounded-lg text-[10px] font-semibold transition-colors ${page === n ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-accent"}`;
                  const ellipsis = (key: string) => (
                    <span key={key} className="text-muted-foreground text-xs px-0.5">…</span>
                  );
                  const btn = (n: number) => (
                    <button key={n} onClick={() => setPage(n)} className={btnCls(n)}>{n}</button>
                  );
                  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => btn(i + 1));
                  const delta = 1;
                  const left = Math.max(2, page - delta);
                  const right = Math.min(totalPages - 1, page + delta);
                  const pages: React.ReactNode[] = [btn(1)];
                  if (left > 2) pages.push(ellipsis("l"));
                  for (let n = left; n <= right; n++) pages.push(btn(n));
                  if (right < totalPages - 1) pages.push(ellipsis("r"));
                  pages.push(btn(totalPages));
                  return pages;
                })()}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
