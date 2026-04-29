import { useState, useEffect, useRef } from "react";
import {
  useListProducts,
  useListAccounts,
  useUpdateProductStock,
  useUpdateProductListingStatus,
  getListProductsQueryKey,
  getListNotificationsQueryKey,
  useListNotifications,
  ListProductsListingFilter,
  NotificationType,
} from "@workspace/api-client-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Package,
  RefreshCw,
  Warehouse,
  Truck,
  Zap,
  Tag,
  Library,
  AlertTriangle,
  AlertCircle,
  Pencil,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Clapperboard,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";

interface Product {
  id: string;
  title?: string | null;
  sku?: string | null;
  availableQuantity?: number | null;
  price?: number | null;
  originalPrice?: number | null;
  amount?: number | null;
  regularAmount?: number | null;
  status?: string | null;
  isFull?: boolean | null;
  isFlex?: boolean | null;
  catalogListing?: boolean | null;
  logisticType?: string | null;
  thumbnail?: string | null;
  mlItemId?: string | null;
  permalink?: string | null;
  accountId?: string;
  /** Clip de vídeo no anúncio (GET /items → video_id), só preenchido na listagem. */
  videoId?: string | null;
}

interface StockUpdateDialog {
  productId: string;
  sku: string | null;
  title: string;
  mlItemId?: string | null;
}

const ROWS_OPTIONS = [10, 20, 50] as const;
type RowsOption = typeof ROWS_OPTIONS[number];

function stockTextColor(qty: number | null | undefined): string {
  if (qty == null || qty === 0) return "text-muted-foreground/60";
  if (qty < 3) return "text-red-600";
  if (qty <= 7) return "text-amber-600";
  return "text-emerald-600";
}

function ProductCard({
  p,
  onEdit,
  onListingStatusChange,
  statusMutationPending,
  accountNickname,
}: {
  p: Product;
  onEdit: () => void;
  onListingStatusChange: (next: "active" | "paused") => void;
  statusMutationPending: boolean;
  accountNickname?: string | null;
}) {
  const isPromo =
    p.regularAmount != null && p.amount != null && p.regularAmount > p.amount;

  const isFull = p.logisticType === "fulfillment" || !!p.isFull;
  const isFlex = p.logisticType === "self_service" || !!p.isFlex;
  const isCross = p.logisticType === "cross_docking";

  const qty = p.availableQuantity ?? 0;
  const stockColor = stockTextColor(p.availableQuantity);

  const statusBadgeCls =
    p.status === "active"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : p.status === "paused"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : p.status === "closed"
          ? "bg-slate-100 text-slate-500 border-slate-200"
          : p.status === "under_review"
            ? "bg-sky-50 text-sky-700 border-sky-200"
            : "bg-slate-100 text-slate-600 border-slate-200";

  const statusLabel =
    p.status === "active"
      ? "Ativo"
      : p.status === "paused"
        ? "Pausado"
        : p.status === "closed"
          ? "Encerrado"
          : p.status === "under_review"
            ? "Em revisão"
            : (p.status ?? "—");

  const canToggleListingStatus = p.status === "active" || p.status === "paused";

  const thumbCls =
    "size-[4.5rem] rounded-lg flex-shrink-0 bg-muted object-cover";

  return (
    <div className="flex items-center gap-2 bg-card border border-card-border rounded-xl px-3 py-2 hover:border-primary/40 hover:shadow-sm transition-all">
      <Link
        to={`/products/${p.id}`}
        className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer"
      >
        {p.thumbnail ? (
          <img
            src={p.thumbnail}
            alt=""
            className={`${thumbCls} ${qty === 0 ? "grayscale opacity-50" : ""}`}
          />
        ) : (
          <div className={`${thumbCls} flex items-center justify-center`}>
            <Package className="w-6 h-6 text-muted-foreground/40" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-foreground text-sm truncate font-medium" title={p.title ?? ""}>
            {p.title ?? p.id}
          </p>
          {p.mlItemId ? (
            <p
              className="text-[11px] font-mono font-semibold text-foreground truncate mt-0.5 tabular-nums"
              title={`ID do anúncio no Mercado Livre: ${p.mlItemId}`}
            >
              {p.mlItemId}
            </p>
          ) : null}
          <div className="flex items-center gap-2 mt-0.5 min-w-0 overflow-hidden">
            <span className="text-[10px] text-muted-foreground font-mono truncate shrink min-w-0">
              <span className="font-sans font-semibold not-italic">SKU:</span> {p.sku ?? "—"}
            </span>
            {accountNickname && (
              <span className="text-[10px] text-muted-foreground truncate shrink-0 max-w-[140px]" title={accountNickname}>
                {accountNickname}
              </span>
            )}
          </div>
          <div className="sm:hidden flex items-center justify-between gap-2 mt-1">
            <span className={`text-sm font-bold tabular-nums ${stockColor}`}>
              {qty} <span className="text-[10px] text-muted-foreground font-medium">un.</span>
            </span>
            <span className="text-amber-600 text-sm font-semibold truncate">
              {formatCurrency(p.amount ?? p.price)}
            </span>
          </div>

          <div className="flex items-center gap-0.5 mt-1 min-w-0 flex-nowrap overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {isPromo && (
              <span
                className="inline-flex items-center justify-center size-5 rounded-md text-pink-600 bg-pink-50 border border-pink-200 shrink-0"
                title="Promoção"
                aria-label="Promoção"
              >
                <Tag className="w-3 h-3" aria-hidden />
              </span>
            )}
            {isFull && (
              <span
                className="inline-flex items-center justify-center size-5 rounded-md bg-sky-50 text-sky-700 border border-sky-200 shrink-0"
                title="Full (Fulfillment)"
                aria-label="Full, envio Fulfillment"
              >
                <Warehouse className="w-3 h-3" aria-hidden />
              </span>
            )}
            {isFlex && (
              <span
                className="inline-flex items-center justify-center size-5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 shrink-0"
                title="Flex"
                aria-label="Flex"
              >
                <Zap className="w-3 h-3" aria-hidden />
              </span>
            )}
            {isCross && (
              <span
                className="inline-flex items-center justify-center size-5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 shrink-0"
                title="Cross docking"
                aria-label="Cross docking"
              >
                <Truck className="w-3 h-3" aria-hidden />
              </span>
            )}
            {p.catalogListing && (
              <span
                className="inline-flex items-center justify-center size-5 rounded-md bg-violet-50 text-violet-700 border border-violet-200 shrink-0"
                title="Catálogo"
                aria-label="Anúncio de catálogo"
              >
                <Library className="w-3 h-3" aria-hidden />
              </span>
            )}
            {p.videoId && (
              <span
                className="inline-flex items-center justify-center size-5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 shrink-0"
                title="Anúncio com clip de vídeo"
                aria-label="Anúncio com clip de vídeo"
              >
                <Clapperboard className="w-3 h-3" aria-hidden />
              </span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0 min-w-[120px]">
          <div className="flex items-center gap-1 justify-end">
            <span className={`text-lg font-bold leading-none tabular-nums ${stockColor}`}>{qty}</span>
            <span className="text-[10px] text-muted-foreground font-medium">un.</span>
            {qty > 0 && qty < 3 && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
            {qty >= 3 && qty <= 7 && <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />}
          </div>
          <p className="text-amber-600 text-sm font-semibold">{formatCurrency(p.amount ?? p.price)}</p>
          {isPromo && (
            <p className="text-muted-foreground text-[10px] line-through">{formatCurrency(p.regularAmount)}</p>
          )}
        </div>
      </Link>

      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <div className="flex items-center gap-1">
          {p.permalink && (
            <button
              type="button"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-accent border border-border hover:border-primary/40 transition-colors"
              title="Ver no Mercado Livre"
              onClick={() => window.open(p.permalink!, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          {!isFull && (
            <button
              type="button"
              onClick={onEdit}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-accent border border-border hover:border-primary/40 transition-colors"
              title="Editar estoque"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {canToggleListingStatus ? (
          <div
            className="flex shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 p-1"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Switch
              checked={p.status === "active"}
              disabled={statusMutationPending}
              title={p.status === "active" ? "Pausar anúncio" : "Ativar anúncio"}
              aria-label={p.status === "active" ? "Pausar anúncio" : "Ativar anúncio"}
              onCheckedChange={(checked) => {
                onListingStatusChange(checked ? "active" : "paused");
              }}
            />
          </div>
        ) : (
          <span className={`text-[10px] font-medium px-2 py-1 rounded-lg border ${statusBadgeCls}`}>{statusLabel}</span>
        )}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="min-h-[4.5rem] bg-card border border-card-border rounded-xl animate-pulse flex items-center gap-2 px-3 py-2">
      <div className="size-[4.5rem] rounded-lg bg-muted flex-shrink-0" />
      <div className="flex-1 space-y-2 py-0.5 min-w-0">
        <div className="h-3.5 bg-muted rounded w-2/3" />
        <div className="h-2.5 bg-muted rounded w-2/5" />
        <div className="h-2.5 bg-muted rounded w-1/3" />
      </div>
      <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0 w-[120px]">
        <div className="h-4 w-12 bg-muted rounded ml-auto" />
        <div className="h-3.5 w-16 bg-muted rounded ml-auto" />
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <div className="h-8 w-[4.25rem] bg-muted rounded-lg" />
        <div className="h-7 w-11 bg-muted rounded-lg" />
      </div>
    </div>
  );
}

export default function Products() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [listingFilter, setListingFilter] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<RowsOption>(10);
  const [stockDialog, setStockDialog] = useState<StockUpdateDialog | null>(
    null
  );
  const [newQuantity, setNewQuantity] = useState("");

  const params = {
    page,
    limit,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(listingFilter !== "all"
      ? {
          listing_filter:
            listingFilter as (typeof ListProductsListingFilter)[keyof typeof ListProductsListingFilter],
        }
      : {}),
    ...(accountId !== "all" ? { account_id: accountId } : {}),
  };

  const { data, isLoading } = useListProducts(params, {
    query: { queryKey: getListProductsQueryKey(params), refetchInterval: 30000 },
  });

  const { data: notifData } = useListNotifications(
    { is_read: false, limit: 99 },
    { query: { queryKey: getListNotificationsQueryKey({ is_read: false, limit: 99 }), refetchInterval: 30000 } },
  );

  const stockNotifCount = notifData?.data?.filter(
    (n) => n.type === NotificationType.stock_update || n.type === NotificationType.low_stock,
  ).length ?? 0;

  const prevStockNotifCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevStockNotifCountRef.current === null) {
      prevStockNotifCountRef.current = stockNotifCount;
      return;
    }
    if (stockNotifCount > prevStockNotifCountRef.current) {
      toast({
        title: "Estoque atualizado pelo Mercado Livre",
        description: "Um ou mais produtos tiveram o estoque atualizado.",
      });
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey(params) });
    }
    prevStockNotifCountRef.current = stockNotifCount;
  }, [stockNotifCount]);

  const products: Product[] =
    (data as { data?: Product[] } | null)?.data ?? [];
  const pagination = (
    data as {
      pagination?: { total: number; totalPages: number };
    } | null
  )?.pagination;

  const { data: accountsData } = useListAccounts();
  const accounts = (
    accountsData as {
      data?: { id: string; mlNickname?: string | null }[];
    } | null
  )?.data ?? [];

  const accountNicknameMap = Object.fromEntries(
    accounts.map((a) => [a.id, a.mlNickname ?? null])
  );

  const { mutate: updateSingleStock, isPending: updatingSingle } =
    useUpdateProductStock({
      mutation: {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListProductsQueryKey({}),
          });
          setStockDialog(null);
          setNewQuantity("");
          toast({
            title: "Estoque atualizado",
            description: "Estoque deste anúncio atualizado com sucesso.",
          });
        },
        onError: (err) => {
          const msg =
            (
              err as {
                payload?: { error?: { message?: string } };
              }
            )?.payload?.error?.message ?? "Não foi possível atualizar o estoque.";
          toast({
            variant: "destructive",
            title: "Erro ao atualizar",
            description: msg,
          });
        },
      },
    });

  const {
    mutate: updateListingStatus,
    isPending: updatingListingStatus,
    variables: listingStatusVariables,
  } = useUpdateProductListingStatus({
    mutation: {
      onSuccess: (_, vars) => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        const next = vars.data.status;
        toast({
          title: next === "active" ? "Anúncio ativado" : "Anúncio pausado",
          description:
            next === "active"
              ? "O anúncio voltou ao ar no Mercado Livre."
              : "O anúncio foi pausado no Mercado Livre.",
        });
      },
      onError: (err) => {
        const msg =
          (err as { payload?: { error?: { message?: string } } })?.payload?.error?.message ??
          "Não foi possível alterar o status do anúncio.";
        toast({
          variant: "destructive",
          title: "Erro ao alterar status",
          description: msg,
        });
      },
    },
  });

  const handleStockUpdate = () => {
    if (!stockDialog || !newQuantity) return;
    const qty = Number(newQuantity);
    updateSingleStock({
      id: stockDialog.productId,
      data: { quantity: qty },
    });
  };

  const openStockDialog = (p: Product) => {
    setStockDialog({
      productId: p.id,
      sku: p.sku ?? null,
      title: p.title ?? p.id,
      mlItemId: p.mlItemId ?? null,
    });
    setNewQuantity("");
  };

  const totalPages = pagination?.totalPages ?? 1;
  const total = pagination?.total ?? 0;

  const selectCls =
    "bg-input border border-border text-xs rounded-lg px-2.5 h-7 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-foreground">Produtos</h1>
            <p className="text-muted-foreground text-xs">
              {total} anúncio{total === 1 ? "" : "s"} encontrado{total === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {ROWS_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setLimit(n);
                  setPage(1);
                }}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                  limit === n ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="MLB, SKU ou título — várias palavras em qualquer ordem"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className={`w-full bg-input border border-border text-xs rounded-lg pl-8 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary ${search ? "pr-9" : "pr-3"}`}
              aria-label="Buscar por MLB, SKU ou descrição"
            />
            {search ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                aria-label="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>

          <select
            value={listingFilter}
            onChange={(e) => {
              setListingFilter(e.target.value);
              setPage(1);
            }}
            className={`${selectCls} min-w-[11rem]`}
            aria-label="Filtro por status ou tipo de anúncio"
          >
            <option value="all">Todos os anúncios</option>
            <optgroup label="Status">
              <option value="active">Ativo</option>
              <option value="paused">Pausado</option>
              <option value="closed">Encerrado</option>
              <option value="under_review">Em revisão</option>
            </optgroup>
            <optgroup label="Tipo">
              <option value="flex">Flex</option>
              <option value="full">Full</option>
              <option value="promo">Promo</option>
              <option value="catalog">Catálogo</option>
            </optgroup>
          </select>

          {accounts.length > 0 && (
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setPage(1);
              }}
              className={selectCls}
            >
              <option value="all">Todas as contas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.mlNickname ?? a.id.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Package className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm">Nenhum produto encontrado</p>
            <p className="text-muted-foreground/80 text-xs mt-1 text-center max-w-xs">
              Tente ajustar os filtros ou a busca
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                p={p}
                onEdit={() => openStockDialog(p)}
                onListingStatusChange={(next) => {
                  if (p.status === next) return;
                  updateListingStatus({ id: p.id, data: { status: next } });
                }}
                statusMutationPending={
                  updatingListingStatus && listingStatusVariables?.id === p.id
                }
                accountNickname={p.accountId ? accountNicknameMap[p.accountId] : null}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 py-2">
            <p className="text-muted-foreground text-xs">
              Página {page} de {totalPages} · {total} registros
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
                  if (totalPages <= 7) {
                    return Array.from({ length: totalPages }, (_, i) => btn(i + 1));
                  }
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

      <Dialog
        open={!!stockDialog}
        onOpenChange={(o) => {
          if (!o) {
            setStockDialog(null);
            setNewQuantity("");
          }
        }}
      >
        <DialogContent
          className={cn(
            "flex w-[min(100%,24rem)] max-w-sm flex-col gap-0 overflow-hidden p-0 shadow-lg",
            "sm:rounded-lg",
          )}
        >
          <div className="flex max-h-[min(90vh,420px)] flex-col overflow-y-auto px-6 pb-4 pt-6 pr-12">
            <DialogHeader className="shrink-0 space-y-3 text-left">
              <DialogTitle className="text-base">Editar Estoque</DialogTitle>
              <DialogDescription>
                Atualiza somente este anúncio no Mercado Livre.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-foreground text-xs leading-snug">{stockDialog?.title}</p>
                {stockDialog?.sku && (
                  <p className="text-muted-foreground mt-1.5 font-mono text-[10px]">
                    SKU: {stockDialog.sku}
                  </p>
                )}
                {stockDialog?.mlItemId && (
                  <p
                    className="text-foreground mt-1 font-mono text-[10px] font-medium"
                    title="ID do anúncio no Mercado Livre"
                  >
                    {stockDialog.mlItemId}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock-qty-edit" className="text-sm">
                  Nova quantidade
                </Label>
                <Input
                  id="stock-qty-edit"
                  type="number"
                  min={0}
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                  placeholder="0"
                  className="w-full"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 border-t border-border bg-background px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setStockDialog(null);
                setNewQuantity("");
              }}
            >
              Cancelar
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={handleStockUpdate}
              disabled={!newQuantity || updatingSingle}
            >
              {updatingSingle ? (
                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Atualizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
