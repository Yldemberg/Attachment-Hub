import { useState } from "react";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/utils";
import { Bell, BellOff, CheckCheck, ShoppingCart, MessageSquare, Package, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  title?: string | null;
  message?: string | null;
  isRead?: boolean | null;
  type?: string | null;
  createdAt?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  accountNickname?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  new_order: "Novo pedido",
  order_update: "Atualização de pedido",
  new_question: "Nova pergunta",
  low_stock: "Estoque crítico",
  sync_complete: "Sincronização concluída",
  item_update: "Anúncio atualizado",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  new_order: <ShoppingCart className="w-4 h-4 text-emerald-400" />,
  order_update: <ShoppingCart className="w-4 h-4 text-blue-400" />,
  new_question: <MessageSquare className="w-4 h-4 text-red-400" />,
  low_stock: <Package className="w-4 h-4 text-amber-400" />,
  sync_complete: <RefreshCw className="w-4 h-4 text-blue-400" />,
  item_update: <Package className="w-4 h-4 text-slate-400" />,
};

const TYPE_BG: Record<string, string> = {
  new_order: "bg-emerald-900/30 border-emerald-800/30",
  order_update: "bg-blue-900/30 border-blue-800/30",
  new_question: "bg-red-900/30 border-red-800/30",
  low_stock: "bg-amber-900/30 border-amber-800/30",
  sync_complete: "bg-slate-800/60 border-slate-700/30",
  item_update: "bg-slate-800/60 border-slate-700/30",
};

export default function Notifications() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);

  const params = {
    page,
    limit: 30,
    ...(filter === "unread" ? { is_read: false } : {}),
  };

  const { data, isLoading } = useListNotifications(params, {
    query: { queryKey: getListNotificationsQueryKey(params), refetchInterval: 30000 },
  });

  const notifications: Notification[] = (data as { data?: Notification[] } | null)?.data ?? [];
  const pagination = (data as { pagination?: { total: number; totalPages: number } } | null)?.pagination;

  const { mutate: markRead } = useMarkNotificationRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey({}) });
      },
    },
  });

  const { mutate: markAll, isPending: markingAll } = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      },
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Notificações</h1>
          <p className="text-slate-400 text-sm mt-0.5">{pagination?.total ?? 0} notificações</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAll()}
          disabled={markingAll}
          className="border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 h-8 text-xs gap-1.5"
        >
          <CheckCheck className="w-3.5 h-3.5" />
          Marcar todas como lidas
        </Button>
      </div>

      <div className="flex items-center gap-1">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1); }}
            className={cn(
              "px-3 py-1.5 text-xs rounded-md transition-colors",
              filter === f
                ? "bg-blue-600/20 text-blue-400 font-medium"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800",
            )}
          >
            {f === "all" ? "Todas" : "Não lidas"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 animate-pulse flex gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-slate-800 rounded w-2/3" />
                <div className="h-3 bg-slate-800 rounded w-1/2" />
              </div>
            </div>
          ))
        ) : notifications.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-lg py-16 text-center">
            <BellOff className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Nenhuma notificação</p>
          </div>
        ) : (
          notifications.map((n) => {
            const typeLabel = TYPE_LABELS[n.type ?? ""] ?? n.type ?? "Notificação";
            const icon = TYPE_ICONS[n.type ?? ""] ?? <Bell className="w-4 h-4 text-slate-400" />;
            const bgCls = TYPE_BG[n.type ?? ""] ?? "bg-slate-900 border-slate-800";

            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 border rounded-lg transition-colors",
                  n.isRead ? bgCls : "bg-blue-950/20 border-blue-800/30",
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5",
                  n.isRead ? "bg-slate-800 border-slate-700" : "bg-blue-900/40 border-blue-700/40",
                )}>
                  {icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                      {typeLabel}
                    </span>
                    {n.accountNickname && (
                      <>
                        <span className="text-slate-600 text-[10px]">·</span>
                        <span className="text-[10px] text-blue-400 font-medium">{n.accountNickname}</span>
                      </>
                    )}
                    {!n.isRead && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className={cn("text-sm font-medium", n.isRead ? "text-slate-300" : "text-white")}>
                    {n.title ?? "Notificação"}
                  </p>
                  {n.message && (
                    <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{n.message}</p>
                  )}
                  <p className="text-slate-600 text-xs mt-1">{formatDateTime(n.createdAt)}</p>
                </div>

                {!n.isRead && (
                  <button
                    onClick={() => markRead({ id: n.id })}
                    className="flex-shrink-0 text-xs text-slate-500 hover:text-blue-400 transition-colors mt-0.5 whitespace-nowrap"
                  >
                    Marcar como lida
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-xs">Página {page} de {pagination.totalPages}</p>
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
  );
}
