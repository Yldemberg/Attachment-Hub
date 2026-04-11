import { useState } from "react";
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
  logistic_type?: string | null;
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
  confirmed: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  paid: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  payment_required: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  payment_in_process: "bg-blue-900/40 text-blue-400 border-blue-800/50",
  cancelled: "bg-[#122040] text-blue-400/50 border-[#1a3055]/50",
  invalid: "bg-red-900/40 text-red-400 border-red-800/50",
};

const LOGISTIC_LABELS: Record<string, { label: string; cls: string }> = {
  fulfillment: { label: "Full", cls: "bg-blue-900/40 text-blue-400 border-blue-800/50" },
  cross_docking: { label: "Cross-docking", cls: "bg-yellow-900/40 text-yellow-400 border-yellow-800/50" },
  self_service: { label: "Flex", cls: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50" },
  self_service_in: { label: "Flex", cls: "bg-orange-900/40 text-orange-400 border-orange-800/50" },
  default: { label: "Padrão", cls: "bg-[#122040] text-blue-300 border-[#1a3055]/50" },
};

function LogisticBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  const types = type.split(",").map((t) => t.trim()).filter(Boolean);
  if (types.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
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
  const items = (o.itemsJson as unknown as OrderItem[]) ?? [];
  const firstItem = items[0];
  const totalQty = items.reduce((s, i) => s + (i.quantity ?? 0), 0);
  const logisticTypes = [...new Set(items.map((i) => i.logistic_type).filter(Boolean))];

  return (
    <Link to={`/orders/${o.id}`}>
      <div className="flex items-center gap-3 bg-[#0d1b2e] border border-[#1a3055]/60 rounded-xl px-4 py-3 hover:border-blue-600/40 transition-colors cursor-pointer">
        {firstItem?.thumbnail ? (
          <img
            src={firstItem.thumbnail}
            alt=""
            className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-[#122040]"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-[#122040] flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-blue-400/40" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-blue-400 text-xs font-mono font-medium">
              #{o.mlOrderId ?? o.id.slice(0, 8)}
            </span>
            {logisticTypes.map((lt) => (
              <LogisticBadge key={lt} type={lt} />
            ))}
          </div>
          <p className="text-white text-sm truncate font-medium">
            {firstItem?.title ?? "—"}
            {items.length > 1 && (
              <span className="text-blue-400/60 ml-1 font-normal text-xs">+{items.length - 1}</span>
            )}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {firstItem?.sku && (
              <span className="text-[10px] text-blue-400/70 font-mono">SKU: {firstItem.sku}</span>
            )}
            {totalQty > 0 && (
              <span className="text-[10px] text-blue-400/70">× {totalQty} un.</span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0 min-w-[120px]">
          <div className="flex items-center gap-1.5">
            {o.account?.mlNickname && (
              <span className="text-[10px] text-blue-400 flex items-center gap-1">
                <Truck className="w-2.5 h-2.5" />
                {o.account.mlNickname}
              </span>
            )}
          </div>
          <p className="text-blue-200 text-sm font-semibold">
            {formatCurrency(o.totalAmount, o.currencyId ?? "BRL")}
          </p>
          <p className="text-blue-400/60 text-[10px]">{formatDateTime(o.createdAt)}</p>
        </div>

        <div className="flex-shrink-0">
          <span className={`text-[10px] font-medium px-2 py-1 rounded-lg border ${STATUS_COLORS[o.status ?? ""] ?? "bg-[#122040] text-blue-300 border-[#1a3055]/50"}`}>
            {STATUS_LABELS[o.status ?? ""] ?? o.status ?? "—"}
          </span>
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const params = {
    page,
    limit: rowsPerPage,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(accountId !== "all" ? { account_id: accountId } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  };

  const { data, isLoading } = useListOrders(params, {
    query: { queryKey: getListOrdersQueryKey(params) },
  });
  const orders: Order[] = (data?.data ?? []) as Order[];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#080f1e]">
      <div className="sticky top-0 z-10 bg-[#080f1e] border-b border-[#1a3055]/60 flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-white">Pedidos</h1>
            <p className="text-blue-400/70 text-xs">{pagination?.total ?? 0} pedidos encontrados</p>
          </div>
          <div className="flex items-center gap-1">
            {([20, 50] as const).map((n) => (
              <button
                key={n}
                onClick={() => { setRowsPerPage(n); setPage(1); }}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${rowsPerPage === n ? "bg-blue-600 text-white" : "border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040]"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44 bg-[#122040] border-[#1a3055]/70 text-blue-200 text-xs h-7">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-[#0d1b2e] border-[#1a3055]/70">
              <SelectItem value="all" className="text-blue-200">Todos os status</SelectItem>
              <SelectItem value="confirmed" className="text-blue-200">Confirmado</SelectItem>
              <SelectItem value="paid" className="text-blue-200">Pago</SelectItem>
              <SelectItem value="payment_required" className="text-blue-200">Aguardando pagamento</SelectItem>
              <SelectItem value="cancelled" className="text-blue-200">Cancelado</SelectItem>
            </SelectContent>
          </Select>

          {accounts.length > 0 && (
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
              <SelectTrigger className="w-36 bg-[#122040] border-[#1a3055]/70 text-blue-200 text-xs h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1b2e] border-[#1a3055]/70">
                <SelectItem value="all" className="text-blue-200">Todas as contas</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-blue-200">
                    {a.mlNickname ?? a.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="w-32 bg-[#122040] border-[#1a3055]/70 text-blue-200 h-7 text-xs"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="w-32 bg-[#122040] border-[#1a3055]/70 text-blue-200 h-7 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-[#0d1b2e] border border-[#1a3055]/60 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <ShoppingCart className="w-10 h-10 text-blue-400/30 mb-3" />
            <p className="text-blue-400/60 text-sm">Nenhum pedido encontrado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => <OrderCard key={o.id} o={o} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 py-2">
            <p className="text-blue-400/60 text-xs">
              Página {page} de {totalPages} · {pagination?.total ?? 0} registros
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 rounded-lg border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040] disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1">
                {(() => {
                  const btnCls = (n: number) =>
                    `w-7 h-7 rounded-lg text-[10px] font-semibold transition-colors ${page === n ? "bg-blue-600 text-white" : "border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040]"}`;
                  const ellipsis = (key: string) => (
                    <span key={key} className="text-blue-400/60 text-xs px-0.5">…</span>
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
                className="w-7 h-7 rounded-lg border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040] disabled:opacity-30 flex items-center justify-center transition-colors"
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
