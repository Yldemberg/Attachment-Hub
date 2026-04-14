import { useState, useEffect, useRef } from "react";
import {
  useListProducts,
  useListAccounts,
  useUpdateProductStock,
  useUpdateStockBySku,
  getListProductsQueryKey,
  getListNotificationsQueryKey,
  useListNotifications,
  ListProductsStatus,
  NotificationType,
} from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

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
}

type StockScope = "single" | "account" | "all";

interface StockUpdateDialog {
  productId: string;
  accountId: string;
  sku: string | null;
  title: string;
}

const ROWS_OPTIONS = [10, 20, 50] as const;
type RowsOption = typeof ROWS_OPTIONS[number];

function stockTextColor(qty: number | null | undefined): string {
  if (qty == null || qty === 0) return "text-muted-foreground/60";
  if (qty < 3) return "text-red-600";
  if (qty <= 7) return "text-amber-600";
  return "text-emerald-600";
}

/** Layout compacto (~metade da altura original h-[4.5rem]). */
const PRODUCT_CARD_H = "h-[2.25rem]";
const PRODUCT_THUMB_W = "w-20";

function ProductCard({
  p,
  onEdit,
  accountNickname,
}: {
  p: Product;
  onEdit: () => void;
  accountNickname?: string | null;
}) {
  const isPromo =
    p.regularAmount != null && p.amount != null && p.regularAmount > p.amount;

  const isFull = p.logisticType === "fulfillment" || !!p.isFull;
  const isFlex = p.logisticType === "self_service" || !!p.isFlex;
  const isCross = p.logisticType === "cross_docking";

  const qty = p.availableQuantity ?? 0;
  const stockColor = stockTextColor(p.availableQuantity);

  return (
    <div
      className={`relative bg-card border border-card-border rounded-md overflow-hidden group hover:border-primary/40 hover:shadow-md transition-all duration-200 flex ${PRODUCT_CARD_H}`}
    >
      <Link
        to={`/products/${p.id}`}
        className={`relative ${PRODUCT_THUMB_W} flex-shrink-0 h-full overflow-hidden bg-muted focus:outline-none`}
      >
        {p.thumbnail ? (
          <img
            src={p.thumbnail}
            alt={p.title ?? ""}
            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${qty === 0 ? "grayscale opacity-40" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-3 h-3 text-muted-foreground/30" />
          </div>
        )}
        {qty === 0 && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center">
            <span className="bg-red-600/90 text-white text-[6px] font-black uppercase tracking-wide px-0.5 py-px rounded rotate-[-8deg]">
              Esgot.
            </span>
          </div>
        )}
      </Link>

      {/* Escala 50%: mantém tipografia original legível; metade visual da altura original (4.5rem). */}
      <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden">
        <div className="absolute left-0 top-0 h-[200%] w-[200%] origin-top-left scale-[0.5]">
          <div className="flex h-[4.5rem] w-1/2 flex-col px-3 py-1 gap-0.5 min-w-0 min-h-0">
            <div className="min-w-0 min-h-0 shrink">
              <Link
                to={`/products/${p.id}`}
                className="text-xs font-bold text-foreground hover:text-primary transition-colors leading-tight line-clamp-1 block"
                title={p.title ?? ""}
              >
                {p.title ?? p.id}
              </Link>
              <div className="flex items-center gap-1.5 mt-px flex-wrap">
                <p className="text-[10px] font-mono text-muted-foreground truncate">
                  <span className="font-sans font-semibold not-italic">SKU:</span>{" "}
                  {p.sku ?? "—"}
                </p>
                {accountNickname && (
                  <span className="text-[9px] text-muted-foreground/70 truncate max-w-[100px]" title={accountNickname}>
                    {accountNickname}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-nowrap overflow-x-auto min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {p.status === "active" && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Ativo
                </span>
              )}
              {p.status === "paused" && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Pausado
                </span>
              )}
              {p.status === "closed" && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
                  Encerrado
                </span>
              )}
              {p.status === "under_review" && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Em revisão
                </span>
              )}
              {isPromo && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-pink-600 bg-pink-50 border border-pink-200 px-1.5 py-px rounded-full shrink-0">
                  <Tag className="w-2.5 h-2.5" />
                  Promo
                </span>
              )}
              {isFull && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-px rounded-full shrink-0">
                  <Warehouse className="w-2.5 h-2.5" />
                  Full
                </span>
              )}
              {isFlex && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-px rounded-full shrink-0">
                  <Zap className="w-2.5 h-2.5" />
                  Flex
                </span>
              )}
              {isCross && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-px rounded-full shrink-0">
                  <Truck className="w-2.5 h-2.5" />
                  Cross
                </span>
              )}
              {p.catalogListing && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-px rounded-full shrink-0">
                  <Library className="w-2.5 h-2.5" />
                  Catálogo
                </span>
              )}
            </div>

            <div className="flex items-end justify-between mt-auto gap-1.5 shrink-0">
              <div>
                <div className="flex items-baseline gap-1 mb-0.5">
                  <span className={`text-xl font-black leading-none ${stockColor}`}>
                    {qty}
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                    un
                  </span>
                  {qty > 0 && qty < 3 && (
                    <AlertTriangle className="w-3 h-3 text-red-500 ml-0.5" />
                  )}
                  {qty >= 3 && qty <= 7 && (
                    <AlertCircle className="w-3 h-3 text-amber-500 ml-0.5" />
                  )}
                </div>
                <div className="h-1 w-20 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      qty === 0 ? "bg-muted-foreground/20" : qty < 3 ? "bg-red-500" : qty <= 7 ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, Math.round((qty / 50) * 100))}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <div className="text-right">
                  <p className="text-sm font-black text-amber-600 leading-none">
                    {formatCurrency(p.amount ?? p.price)}
                  </p>
                  {isPromo && (
                    <p className="text-[10px] text-muted-foreground line-through leading-none mt-px">
                      {formatCurrency(p.regularAmount)}
                    </p>
                  )}
                </div>

                {p.permalink && (
                  <a
                    href={p.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-accent border border-border hover:border-primary/40 transition-colors flex-shrink-0"
                    title="Ver no Mercado Livre"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                {!isFull && (
                  <button
                    onClick={onEdit}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-accent border border-border hover:border-primary/40 transition-colors flex-shrink-0"
                    title="Editar estoque"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      className={`bg-card border border-card-border rounded-md overflow-hidden flex ${PRODUCT_CARD_H} animate-pulse`}
    >
      <div className={`${PRODUCT_THUMB_W} flex-shrink-0 bg-muted`} />
      <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden">
        <div className="absolute left-0 top-0 h-[200%] w-[200%] origin-top-left scale-[0.5]">
          <div className="flex h-[4.5rem] w-1/2 flex-col px-3 py-1 gap-1 justify-between min-h-0">
            <div className="h-3 bg-muted rounded w-3/4" />
            <div className="h-2.5 bg-muted rounded w-1/3" />
            <div className="h-2.5 bg-muted rounded w-1/4" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Products() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<RowsOption>(10);
  const [stockDialog, setStockDialog] = useState<StockUpdateDialog | null>(
    null
  );
  const [newQuantity, setNewQuantity] = useState("");
  const [stockScope, setStockScope] = useState<StockScope>("single");

  const params = {
    page,
    limit,
    ...(search ? { search } : {}),
    ...(status !== "all"
      ? {
          status: status as (typeof ListProductsStatus)[keyof typeof ListProductsStatus],
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

  const { mutate: updateSkuStock, isPending: updatingBySku } =
    useUpdateStockBySku({
      mutation: {
        onSuccess: (result) => {
          queryClient.invalidateQueries({
            queryKey: getListProductsQueryKey({}),
          });
          setStockDialog(null);
          setNewQuantity("");
          const r = result as { updated?: number; skipped?: number };
          toast({
            title: "Estoque atualizado",
            description: `${r.updated ?? 0} anúncio(s) atualizado(s)${r.skipped ? `, ${r.skipped} ignorado(s) (FULL)` : ""}.`,
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Erro ao atualizar",
            description: "Não foi possível atualizar o estoque.",
          });
        },
      },
    });

  const isUpdating = updatingSingle || updatingBySku;

  const handleStockUpdate = () => {
    if (!stockDialog || !newQuantity) return;
    const qty = Number(newQuantity);

    if (stockScope === "single") {
      updateSingleStock({
        id: stockDialog.productId,
        data: { quantity: qty },
      });
    } else if (!stockDialog.sku) {
      toast({
        variant: "destructive",
        title: "Erro",
        description:
          "Produto sem SKU — use o escopo 'somente este anúncio'.",
      });
    } else if (stockScope === "account") {
      updateSkuStock({
        sku: stockDialog.sku,
        data: { quantity: qty },
        params: { account_id: stockDialog.accountId },
      });
    } else {
      updateSkuStock({ sku: stockDialog.sku, data: { quantity: qty } });
    }
  };

  const openStockDialog = (p: Product) => {
    setStockDialog({
      productId: p.id,
      accountId: p.accountId ?? "",
      sku: p.sku ?? null,
      title: p.title ?? p.id,
    });
    setNewQuantity("");
    setStockScope("single");
  };

  const totalPages = pagination?.totalPages ?? 1;
  const total = pagination?.total ?? 0;
  const startItem = (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  const selectCls =
    "bg-input border border-border text-xs rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-2.5">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar título ou SKU..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-input border border-border text-xs rounded-lg pl-8 pr-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className={selectCls}
          >
            <option value="all">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="paused">Pausado</option>
            <option value="closed">Encerrado</option>
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

          <div className="flex items-center gap-2 ml-auto">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap font-medium hidden sm:block">
                Itens/pág.:
              </span>
              <div className="flex items-center bg-input border border-border rounded-lg overflow-hidden">
                {ROWS_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setLimit(opt);
                      setPage(1);
                    }}
                    className={`px-2.5 py-1.5 text-[10px] font-semibold transition-colors border-r border-border last:border-r-0 ${
                      limit === opt
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {total > 0 && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden sm:block">
                <span className="text-foreground font-semibold">{total}</span>{" "}
                anúncios
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-4">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-foreground text-sm font-medium">
              Nenhum produto encontrado
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              Tente ajustar os filtros ou a busca
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                p={p}
                onEdit={() => openStockDialog(p)}
                accountNickname={p.accountId ? accountNicknameMap[p.accountId] : null}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <p className="text-[10px] text-muted-foreground">
              Mostrando{" "}
              <span className="text-foreground font-medium">
                {startItem}–{endItem}
              </span>{" "}
              de{" "}
              <span className="text-foreground font-medium">{total}</span>{" "}
              anúncios
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        </div>
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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              Editar Estoque
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-foreground text-xs truncate">
                {stockDialog?.title}
              </p>
              {stockDialog?.sku && (
                <p className="text-muted-foreground text-[10px] font-mono">
                  SKU: {stockDialog.sku}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm">
                Escopo da atualização
              </Label>
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value="single"
                    checked={stockScope === "single"}
                    onChange={() => setStockScope("single")}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-foreground text-xs font-medium">
                      Somente este anúncio
                    </p>
                    <p className="text-muted-foreground text-[10px]">
                      Atualiza apenas este item
                    </p>
                  </div>
                </label>
                {stockDialog?.sku && (
                  <>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scope"
                        value="account"
                        checked={stockScope === "account"}
                        onChange={() => setStockScope("account")}
                        className="mt-0.5 accent-primary"
                      />
                      <div>
                        <p className="text-foreground text-xs font-medium">
                          Mesma conta — SKU {stockDialog.sku}
                        </p>
                        <p className="text-muted-foreground text-[10px]">
                          Todos os anúncios desta conta com o mesmo SKU
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scope"
                        value="all"
                        checked={stockScope === "all"}
                        onChange={() => setStockScope("all")}
                        className="mt-0.5 accent-primary"
                      />
                      <div>
                        <p className="text-foreground text-xs font-medium">
                          Todas as contas — SKU {stockDialog.sku}
                        </p>
                        <p className="text-muted-foreground text-[10px]">
                          Reflete em todos os anúncios de todas as contas com
                          este SKU
                        </p>
                      </div>
                    </label>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Nova quantidade</Label>
              <Input
                type="number"
                min={0}
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setStockDialog(null);
                setNewQuantity("");
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleStockUpdate}
              disabled={!newQuantity || isUpdating}
            >
              {isUpdating ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-1" />
              ) : null}
              Atualizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
