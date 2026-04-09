import { useState } from "react";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/utils";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  title?: string | null;
  body?: string | null;
  isRead?: boolean | null;
  type?: string | null;
  createdAt?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}

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
          <h1 className="text-xl font-bold text-white">Notificacoes</h1>
          <p className="text-slate-400 text-sm mt-0.5">{pagination?.total ?? 0} notificacoes</p>
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
            {f === "all" ? "Todas" : "Nao lidas"}
          </button>
        ))}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-4 py-3 border-b border-slate-800/50 animate-pulse flex gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-slate-800 rounded w-2/3" />
                <div className="h-3 bg-slate-800 rounded w-1/2" />
              </div>
            </div>
          ))
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center">
            <BellOff className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Nenhuma notificacao</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3 border-b border-slate-800/50 last:border-0 transition-colors",
                !n.isRead ? "bg-blue-950/20" : "hover:bg-slate-800/20",
              )}
            >
              <div className={cn(
                "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                !n.isRead ? "bg-blue-500" : "bg-transparent",
              )} />
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", n.isRead ? "text-slate-300" : "text-white")}>
                  {n.title ?? "Notificacao"}
                </p>
                {n.body && (
                  <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{n.body}</p>
                )}
                <p className="text-slate-600 text-xs mt-1">{formatDateTime(n.createdAt)}</p>
              </div>
              {!n.isRead && (
                <button
                  onClick={() => markRead({ id: n.id })}
                  className="flex-shrink-0 text-xs text-slate-500 hover:text-blue-400 transition-colors mt-0.5"
                >
                  Marcar como lida
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-xs">Pagina {page} de {pagination.totalPages}</p>
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
              Proxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
