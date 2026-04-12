import { useState } from "react";
import {
  useListProducts,
  useListAccounts,
  useUpdateProductStock,
  useUpdateStockBySku,
  getListProductsQueryKey,
  ListProductsStatus,
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
  if (qty == null || qty === 0) return "text-blue-400/60";
  if (qty < 3) return "text-red-400";
  if (qty <= 7) return "text-amber-400";
  return "text-emerald-400";
}

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
    <div className="relative bg-[#0d1b2e] border border-[#1a3055]/60 rounded-xl overflow-hidden group hover:border-blue-600/40 hover:shadow-lg hover:shadow-black/40 transition-all duration-200 flex">
      <Link
        to={`/products/${p.id}`}
        className="relative w-40 flex-shrink-0 overflow-hidden bg-[#122040] focus:outline-none"
      >
        {p.thumbnail ? (
          <img
            src={p.thumbnail}
            alt={p.title ?? ""}
            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${qty === 0 ? "grayscale opacity-40" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-10 h-10 text-blue-400/30" />
          </div>
        )}
        {qty === 0 && (
          <div className="absolute inset-x-0 top-[38%] flex justify-center">
            <span className="bg-red-600/90 text-white text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded rotate-[-8deg]">
              Esgot.
            </span>
          </div>
        )}
      </Link>

      <div className="flex-1 flex flex-col px-4 py-3 gap-2 min-w-0">
        <div className="min-w-0">
          <Link
            to={`/products/${p.id}`}
            className="text-sm font-bold text-white hover:text-blue-300 transition-colors leading-snug line-clamp-2 block"
            title={p.title ?? ""}
          >
            {p.title ?? p.id}
          </Link>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs font-mono text-blue-400/70 truncate">
              <span className="text-blue-400/50 font-sans font-semibold not-italic">SKU:</span>{" "}
              {p.sku ?? "—"}
            </p>
            {accountNickname && (
              <span className="text-[10px] text-blue-300/60 truncate max-w-[120px]" title={accountNickname}>
                {accountNickname}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {p.status === "active" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Ativo
            </span>
          )}
          {p.status === "paused" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Pausado
            </span>
          )}
          {p.status === "closed" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400/60">
              <span className="w-2 h-2 rounded-full bg-blue-400/60" />
              Encerrado
            </span>
          )}
          {p.status === "under_review" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              Em revisão
            </span>
          )}
          {isPromo && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-pink-400 bg-pink-400/10 border border-pink-400/20 px-2 py-0.5 rounded-full">
              <Tag className="w-3 h-3" />
              Promo
            </span>
          )}
          {isFull && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 bg-blue-600/20 border border-blue-600/30 px-2 py-0.5 rounded-full">
              <Warehouse className="w-3 h-3" />
              Full
            </span>
          )}
          {isFlex && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-300 bg-orange-500/20 border border-orange-500/30 px-2 py-0.5 rounded-full">
              <Zap className="w-3 h-3" />
              Flex
            </span>
          )}
          {isCross && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded-full">
              <Truck className="w-3 h-3" />
              Cross
            </span>
          )}
        </div>

        <div className="flex items-end justify-between mt-auto gap-2">
          <div>
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span className={`text-3xl font-black leading-none ${stockColor}`}>
                {qty}
              </span>
              <span className="text-xs text-blue-400/60 uppercase tracking-widest font-bold">
                un
              </span>
              {qty > 0 && qty < 3 && (
                <AlertTriangle className="w-4 h-4 text-red-400 ml-0.5" />
              )}
              {qty >= 3 && qty <= 7 && (
                <AlertCircle className="w-4 h-4 text-amber-400 ml-0.5" />
              )}
            </div>
            <div className="h-1.5 w-24 rounded-full bg-[#122040] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  qty === 0 ? "bg-blue-400/30" : qty < 3 ? "bg-red-500" : qty <= 7 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, Math.round((qty / 50) * 100))}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-base font-black text-white">
                {formatCurrency(p.amount ?? p.price)}
              </p>
              {isPromo && (
                <p className="text-xs text-blue-400/60 line-through leading-none">
                  {formatCurrency(p.regularAmount)}
                </p>
              )}
            </div>

            {p.permalink && (
              <a
                href={p.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 flex items-center justify-center rounded-xl text-blue-400/60 hover:text-blue-400 hover:bg-[#122040] border border-[#1a3055]/60 hover:border-blue-600/40 transition-colors flex-shrink-0"
                title="Ver no Mercado Livre"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}

            {!isFull && (
              <button
                onClick={onEdit}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-blue-400/60 hover:text-white hover:bg-[#122040] border border-[#1a3055]/60 hover:border-blue-600/40 transition-colors flex-shrink-0"
                title="Editar estoque"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-[#0d1b2e] border border-[#1a3055]/60 rounded-xl overflow-hidden flex h-36 animate-pulse">
      <div className="w-40 flex-shrink-0 bg-[#122040]" />
      <div className="flex-1 px-4 py-3 flex flex-col gap-2.5">
        <div className="h-4 bg-[#122040] rounded w-3/4" />
        <div className="h-3 bg-[#122040] rounded w-1/3" />
        <div className="h-3 bg-[#122040] rounded w-1/4 mt-auto" />
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
    query: { queryKey: getListProductsQueryKey(params) },
  });

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
    "bg-[#122040] border border-[#1a3055]/70 text-xs rounded-lg px-2.5 py-1.5 text-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#080f1e]">
      <div className="sticky top-0 z-10 bg-[#080f1e] border-b border-[#1a3055]/60 px-4 py-2.5">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-300" />
            <input
              type="text"
              placeholder="Buscar título ou SKU..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-[#122040] border border-[#1a3055]/70 text-xs rounded-lg pl-8 pr-3 py-1.5 text-blue-200 placeholder:text-blue-400/60 focus:outline-none focus:ring-1 focus:ring-blue-400"
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
              <span className="text-[10px] text-blue-200 whitespace-nowrap font-medium hidden sm:block">
                Itens/pág.:
              </span>
              <div className="flex items-center bg-[#122040] border border-[#1a3055]/70 rounded-lg overflow-hidden">
                {ROWS_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setLimit(opt);
                      setPage(1);
                    }}
                    className={`px-2.5 py-1.5 text-[10px] font-semibold transition-colors border-r border-[#1a3055]/70 last:border-r-0 ${
                      limit === opt
                        ? "bg-blue-600 text-white"
                        : "text-blue-300 hover:bg-[#122040] hover:text-white"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {total > 0 && (
              <span className="text-[10px] text-blue-200 whitespace-nowrap hidden sm:block">
                <span className="text-white font-semibold">{total}</span>{" "}
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
            <Package className="w-10 h-10 text-blue-400/30 mb-3" />
            <p className="text-blue-200 text-sm font-medium">
              Nenhum produto encontrado
            </p>
            <p className="text-blue-300/70 text-xs mt-1">
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
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#1a3055]/40">
            <p className="text-[10px] text-blue-200">
              Mostrando{" "}
              <span className="text-white font-medium">
                {startItem}–{endItem}
              </span>{" "}
              de{" "}
              <span className="text-white font-medium">{total}</span>{" "}
              anúncios
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-[#1a3055]/60 text-blue-300 hover:bg-[#122040] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
        <DialogContent className="bg-[#0d1b2e] border border-[#1a3055]/60 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white text-base">
              Editar Estoque
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-blue-300 text-xs truncate">
                {stockDialog?.title}
              </p>
              {stockDialog?.sku && (
                <p className="text-blue-400/60 text-[10px] font-mono">
                  SKU: {stockDialog.sku}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-blue-200 text-sm">
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
                    className="mt-0.5 accent-blue-500"
                  />
                  <div>
                    <p className="text-white text-xs font-medium">
                      Somente este anúncio
                    </p>
                    <p className="text-blue-400/60 text-[10px]">
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
                        className="mt-0.5 accent-blue-500"
                      />
                      <div>
                        <p className="text-white text-xs font-medium">
                          Mesma conta — SKU {stockDialog.sku}
                        </p>
                        <p className="text-blue-400/60 text-[10px]">
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
                        className="mt-0.5 accent-blue-500"
                      />
                      <div>
                        <p className="text-white text-xs font-medium">
                          Todas as contas — SKU {stockDialog.sku}
                        </p>
                        <p className="text-blue-400/60 text-[10px]">
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
              <Label className="text-blue-200 text-sm">Nova quantidade</Label>
              <Input
                type="number"
                min={0}
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="0"
                className="bg-[#122040] border-[#1a3055]/70 text-white"
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
              className="border-[#1a3055]/60 text-blue-400/70 hover:text-white hover:bg-[#122040]"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleStockUpdate}
              disabled={!newQuantity || isUpdating}
              className="bg-blue-600 hover:bg-blue-500 text-white"
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
