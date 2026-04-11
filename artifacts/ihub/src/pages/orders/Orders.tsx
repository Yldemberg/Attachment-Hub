import { useState } from "react";
import {
  useListOrders,
  useListAccounts,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import type { Order as ApiOrder } from "@workspace/api-client-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ShoppingCart, Package, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  payment_required: "Aguardando pagamento",
  payment_in_process: "Pagamento em andamento",
  partially_refunded: "Parcialmente reembolsado",
  pending_cancel: "Cancelamento pendente",
  cancelled: "Cancelado",
  invalid: "Inválido",
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  paid: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  payment_required: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  payment_in_process: "bg-blue-900/40 text-blue-400 border-blue-800/50",
  cancelled: "bg-slate-800 text-slate-500 border-slate-700",
  invalid: "bg-red-900/40 text-red-400 border-red-800/50",
};

const LOGISTIC_LABELS: Record<string, { label: string; cls: string }> = {
  fulfillment: { label: "Full", cls: "bg-blue-900/40 text-blue-400 border-blue-800/50" },
  cross_docking: { label: "Cross-docking", cls: "bg-yellow-900/40 text-yellow-400 border-yellow-800/50" },
  self_service: { label: "Flex", cls: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50" },
  self_service_in: { label: "Coleta", cls: "bg-orange-900/40 text-orange-400 border-orange-800/50" },
  default: { label: "Padrão", cls: "bg-slate-800 text-slate-400 border-slate-700" },
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

export default function Orders() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const params = {
    page,
    limit: 20,
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

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Pedidos</h1>
          <p className="text-slate-400 text-sm mt-0.5">{pagination?.total ?? 0} pedidos encontrados</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-slate-300 text-sm h-8">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-300">Todos os status</SelectItem>
            <SelectItem value="confirmed" className="text-slate-300">Confirmado</SelectItem>
            <SelectItem value="paid" className="text-slate-300">Pago</SelectItem>
            <SelectItem value="payment_required" className="text-slate-300">Aguardando pagamento</SelectItem>
            <SelectItem value="cancelled" className="text-slate-300">Cancelado</SelectItem>
          </SelectContent>
        </Select>

        {accounts.length > 0 && (
          <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
            <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-slate-300 text-sm h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              <SelectItem value="all" className="text-slate-300">Todas as contas</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-slate-300">
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
          className="w-36 bg-slate-800 border-slate-700 text-slate-300 h-8 text-xs"
          placeholder="De"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="w-36 bg-slate-800 border-slate-700 text-slate-300 h-8 text-xs"
          placeholder="Até"
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium">Pedido</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium">Produto</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium">Comprador / Loja</th>
                <th className="text-center px-4 py-3 text-slate-400 text-xs font-medium">Logística</th>
                <th className="text-center px-4 py-3 text-slate-400 text-xs font-medium">Status</th>
                <th className="text-right px-4 py-3 text-slate-400 text-xs font-medium">Total</th>
                <th className="text-right px-4 py-3 text-slate-400 text-xs font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-800/50">
                    {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <ShoppingCart className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-slate-500 text-sm">Nenhum pedido encontrado</p>
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const items = (o.itemsJson as unknown as OrderItem[]) ?? [];
                  const firstItem = items[0];
                  const totalQty = items.reduce((s, i) => s + (i.quantity ?? 0), 0);

                  return (
                    <tr key={o.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/orders/${o.id}`} className="text-blue-400 hover:text-blue-300 text-xs font-mono">
                          #{o.mlOrderId ?? o.id.slice(0, 8)}
                        </Link>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {firstItem?.thumbnail ? (
                            <img
                              src={firstItem.thumbnail}
                              alt=""
                              className="w-8 h-8 rounded object-cover flex-shrink-0 bg-slate-800"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center flex-shrink-0">
                              <Package className="w-4 h-4 text-slate-600" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-slate-200 text-xs truncate max-w-[160px]">
                              {firstItem?.title ?? "—"}
                              {items.length > 1 && (
                                <span className="text-slate-500 ml-1">+{items.length - 1}</span>
                              )}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {firstItem?.sku && (
                                <span className="text-[10px] text-slate-500 font-mono">SKU: {firstItem.sku}</span>
                              )}
                              {totalQty > 0 && (
                                <span className="text-[10px] text-slate-500">× {totalQty}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <p className="text-slate-200 text-sm">{o.buyerNickname ?? "—"}</p>
                        {o.account?.mlNickname && (
                          <p className="text-[10px] text-blue-400 mt-0.5 flex items-center gap-1">
                            <Truck className="w-2.5 h-2.5" />
                            {o.account.mlNickname}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {items.length > 0 ? (
                            [...new Set(items.map((i) => i.logistic_type).filter(Boolean))].map((lt) => (
                              <LogisticBadge key={lt} type={lt} />
                            ))
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${STATUS_COLORS[o.status ?? ""] ?? "bg-slate-800 text-slate-500 border-slate-700"}`}>
                          {STATUS_LABELS[o.status ?? ""] ?? o.status ?? "—"}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span className="text-slate-200 text-sm font-medium">
                          {formatCurrency(o.totalAmount, o.currencyId ?? "BRL")}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span className="text-slate-400 text-xs">{formatDateTime(o.createdAt)}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
            <p className="text-slate-500 text-xs">
              Página {page} de {pagination.totalPages}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-7 px-2 text-xs border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= pagination.totalPages}
                className="h-7 px-2 text-xs border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
