import { useParams, useLocation } from "wouter";
import { useGetOrder, getGetOrderQueryKey } from "@workspace/api-client-react";
import type { Order as ApiOrder } from "@workspace/api-client-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

type Order = ApiOrder;

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmado",
  payment_required: "Aguardando pagamento",
  payment_in_process: "Pagamento em andamento",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  payment_required: "bg-amber-50 text-amber-700 border-amber-200",
  payment_in_process: "bg-sky-50 text-sky-700 border-sky-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data: order, isLoading } = useGetOrder(id, {
    query: { queryKey: getGetOrderQueryKey(id) },
  });
  const o = order as Order | null;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 space-y-3">
        <div className="h-5 w-24 bg-muted rounded animate-pulse" />
        <div className="h-32 bg-card border border-card-border rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!o) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 text-center">
        <ShoppingCart className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground">Pedido não encontrado</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/orders")}
          className="mt-4"
        >
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-4 max-w-2xl">
        <button
          onClick={() => navigate("/orders")}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Pedidos
        </button>

        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Pedido ML</p>
              <h1 className="text-lg font-bold text-foreground font-mono">#{o.mlOrderId ?? o.id}</h1>
            </div>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${STATUS_COLORS[o.status ?? ""] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
              {STATUS_LABELS[o.status ?? ""] ?? o.status ?? "—"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-5">
            <div>
              <p className="text-muted-foreground text-xs">Comprador</p>
              <p className="text-foreground text-sm font-medium mt-0.5">{o.buyerNickname ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Total</p>
              <p className="text-amber-600 text-xl font-bold mt-0.5">
                {formatCurrency(o.totalAmount, o.currencyId ?? "BRL")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Criado em</p>
              <p className="text-foreground text-sm mt-0.5">{formatDateTime(o.createdAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Atualizado em</p>
              <p className="text-foreground text-sm mt-0.5">{formatDateTime(o.updatedAt)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
