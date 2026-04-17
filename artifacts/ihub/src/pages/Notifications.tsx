import { useState } from "react";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/utils";
import { Bell, BellOff, CheckCheck, ShoppingCart, MessageSquare, Package, RefreshCw, ExternalLink } from "lucide-react";
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
  listingThumbnailUrl?: string | null;
  listingPermalink?: string | null;
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
  new_order: <ShoppingCart className="w-4 h-4 text-emerald-600" />,
  order_update: <ShoppingCart className="w-4 h-4 text-primary" />,
  new_question: <MessageSquare className="w-4 h-4 text-red-500" />,
  low_stock: <Package className="w-4 h-4 text-amber-600" />,
  sync_complete: <RefreshCw className="w-4 h-4 text-primary" />,
  item_update: <Package className="w-4 h-4 text-primary" />,
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
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-foreground">Notificações</h1>
            <p className="text-muted-foreground text-xs">{pagination?.total ?? 0} notificações</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAll()}
            disabled={markingAll}
            className="h-7 text-xs gap-1.5"
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
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
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
              <div key={i} className="h-16 bg-card border border-card-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <BellOff className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm">Nenhuma notificação</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => {
              const typeLabel = TYPE_LABELS[n.type ?? ""] ?? n.type ?? "Notificação";
              const icon = TYPE_ICONS[n.type ?? ""] ?? <Bell className="w-4 h-4 text-primary" />;

              return (
                <div
                  key={n.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border rounded-xl transition-colors",
                    n.isRead
                      ? "bg-card border-card-border"
                      : "bg-primary/5 border-primary/30",
                    !n.isRead && n.type === "new_question" && "ring-2 ring-primary/20 shadow-sm",
                  )}
                >
                  {n.type === "new_question" && n.listingThumbnailUrl ? (
                    <img
                      src={n.listingThumbnailUrl}
                      alt=""
                      className="size-14 rounded-lg border border-border object-cover flex-shrink-0 bg-muted mt-0.5"
                    />
                  ) : (
                    <div className={cn(
                      "w-9 h-9 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5",
                      n.isRead ? "bg-muted border-border" : "bg-primary/10 border-primary/30",
                    )}>
                      {icon}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {typeLabel}
                      </span>
                      {n.accountNickname && (
                        <>
                          <span className="text-muted-foreground/40 text-[10px]">·</span>
                          <span className="text-[10px] text-primary font-medium">{n.accountNickname}</span>
                        </>
                      )}
                      {!n.isRead && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                      )}
                    </div>
                    <p className={cn("text-sm font-medium", n.isRead ? "text-foreground/80" : "text-foreground")}>
                      {n.title ?? "Notificação"}
                    </p>
                    {n.message && (
                      <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">{n.message}</p>
                    )}
                    {n.type === "new_question" && n.listingPermalink && (
                      <a
                        href={n.listingPermalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-1.5"
                      >
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        Ver anúncio no Mercado Livre
                      </a>
                    )}
                    <p className="text-muted-foreground/60 text-xs mt-1">{formatDateTime(n.createdAt)}</p>
                  </div>

                  {!n.isRead && (
                    <button
                      onClick={() => markRead({ id: n.id })}
                      className="flex-shrink-0 text-xs text-muted-foreground hover:text-primary transition-colors mt-0.5 whitespace-nowrap"
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
            <p className="text-muted-foreground text-xs">Página {page} de {totalPages}</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
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
