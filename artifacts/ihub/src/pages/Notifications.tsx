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
import { ChevronLeft, ChevronRight } from "lucide-react";

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
  item_update: <Package className="w-4 h-4 text-blue-300" />,
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
  const totalPages = pagination?.totalPages ?? 1;

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
    <div className="h-full flex flex-col overflow-hidden bg-[#080f1e]">
      <div className="sticky top-0 z-10 bg-[#080f1e] border-b border-[#1a3055]/60 flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-white">Notificações</h1>
            <p className="text-blue-400/70 text-xs">{pagination?.total ?? 0} notificações</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAll()}
            disabled={markingAll}
            className="border-[#1a3055]/70 text-blue-300 hover:text-white hover:bg-[#122040] h-7 text-xs gap-1.5"
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
                "px-3 py-1.5 text-xs rounded-lg transition-colors",
                filter === f
                  ? "bg-blue-600/20 text-blue-400 font-medium"
                  : "text-blue-300 hover:text-white hover:bg-[#122040]",
              )}
            >
              {f === "all" ? "Todas" : "Não lidas"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-[#0d1b2e] border border-[#1a3055]/60 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <BellOff className="w-10 h-10 text-blue-400/30 mb-3" />
            <p className="text-blue-400/60 text-sm">Nenhuma notificação</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => {
              const typeLabel = TYPE_LABELS[n.type ?? ""] ?? n.type ?? "Notificação";
              const icon = TYPE_ICONS[n.type ?? ""] ?? <Bell className="w-4 h-4 text-blue-300" />;

              return (
                <div
                  key={n.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border rounded-xl transition-colors",
                    n.isRead
                      ? "bg-[#0d1b2e] border-[#1a3055]/60"
                      : "bg-blue-950/30 border-blue-700/40",
                  )}
                >
                  <div className={cn(
                    "w-9 h-9 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5",
                    n.isRead ? "bg-[#122040] border-[#1a3055]/60" : "bg-blue-900/40 border-blue-700/40",
                  )}>
                    {icon}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wide">
                        {typeLabel}
                      </span>
                      {n.accountNickname && (
                        <>
                          <span className="text-blue-500/40 text-[10px]">·</span>
                          <span className="text-[10px] text-blue-400 font-medium">{n.accountNickname}</span>
                        </>
                      )}
                      {!n.isRead && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      )}
                    </div>
                    <p className={cn("text-sm font-medium", n.isRead ? "text-blue-200" : "text-white")}>
                      {n.title ?? "Notificação"}
                    </p>
                    {n.message && (
                      <p className="text-blue-300/70 text-xs mt-0.5 leading-relaxed">{n.message}</p>
                    )}
                    <p className="text-blue-400/50 text-xs mt-1">{formatDateTime(n.createdAt)}</p>
                  </div>

                  {!n.isRead && (
                    <button
                      onClick={() => markRead({ id: n.id })}
                      className="flex-shrink-0 text-xs text-blue-400/60 hover:text-blue-400 transition-colors mt-0.5 whitespace-nowrap"
                    >
                      Marcar como lida
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 py-2">
            <p className="text-blue-400/60 text-xs">Página {page} de {totalPages}</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 rounded-lg border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040] disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
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
