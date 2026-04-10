import { useState } from "react";
import {
  useListProducts,
  useListAccounts,
  useUpdateProductStock,
  useUpdateStockBySku,
  getListProductsQueryKey,
  ListProductsStatus,
} from "@workspace/api-client-react";
import { formatCurrency, stockBgColor } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Package, RefreshCw, Warehouse, Truck, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface Product {
  id: string;
  title?: string | null;
  sku?: string | null;
  availableQuantity?: number | null;
  price?: number | null;
  originalPrice?: number | null;
  status?: string | null;
  isFull?: boolean | null;
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

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
  under_review: "Em revisão",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  paused: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  closed: "bg-slate-800 text-slate-500 border-slate-700",
  under_review: "bg-blue-900/40 text-blue-400 border-blue-800/50",
};

const LOGISTIC_MAP: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  fulfillment: {
    label: "Full",
    cls: "bg-blue-900/40 text-blue-400 border-blue-800/50",
    icon: <Warehouse className="w-2.5 h-2.5" />,
  },
  cross_docking: {
    label: "Cross-docking",
    cls: "bg-yellow-900/40 text-yellow-400 border-yellow-800/50",
    icon: <Truck className="w-2.5 h-2.5" />,
  },
  self_service: {
    label: "Flex",
    cls: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
    icon: <Zap className="w-2.5 h-2.5" />,
  },
};

function LogisticBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  const info = LOGISTIC_MAP[type];
  if (!info) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded border ${info.cls}`}>
      {info.icon}
      {info.label}
    </span>
  );
}

export default function Products() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [stockDialog, setStockDialog] = useState<StockUpdateDialog | null>(null);
  const [newQuantity, setNewQuantity] = useState("");
  const [stockScope, setStockScope] = useState<StockScope>("single");

  const params = {
    page,
    limit: 20,
    ...(search ? { search } : {}),
    ...(status !== "all" ? { status: status as (typeof ListProductsStatus)[keyof typeof ListProductsStatus] } : {}),
    ...(accountId !== "all" ? { account_id: accountId } : {}),
  };

  const { data, isLoading } = useListProducts(params, {
    query: { queryKey: getListProductsQueryKey(params) },
  });

  const products: Product[] = (data as { data?: Product[] } | null)?.data ?? [];
  const pagination = (data as { pagination?: { total: number; totalPages: number } } | null)?.pagination;

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  const { mutate: updateSingleStock, isPending: updatingSingle } = useUpdateProductStock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        setStockDialog(null);
        setNewQuantity("");
        toast({ title: "Estoque atualizado", description: "Estoque deste anúncio atualizado com sucesso." });
      },
      onError: (err) => {
        const msg = (err as { payload?: { error?: { message?: string } } })?.payload?.error?.message ?? "Não foi possível atualizar o estoque.";
        toast({ variant: "destructive", title: "Erro ao atualizar", description: msg });
      },
    },
  });

  const { mutate: updateSkuStock, isPending: updatingBySku } = useUpdateStockBySku({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        setStockDialog(null);
        setNewQuantity("");
        const r = result as { updated?: number; skipped?: number };
        toast({
          title: "Estoque atualizado",
          description: `${r.updated ?? 0} anúncio(s) atualizado(s)${r.skipped ? `, ${r.skipped} ignorado(s) (FULL)` : ""}.`,
        });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Erro ao atualizar", description: "Não foi possível atualizar o estoque." });
      },
    },
  });

  const isUpdating = updatingSingle || updatingBySku;

  const handleStockUpdate = () => {
    if (!stockDialog || !newQuantity) return;
    const qty = Number(newQuantity);

    if (stockScope === "single") {
      updateSingleStock({ id: stockDialog.productId, data: { quantity: qty } });
    } else if (!stockDialog.sku) {
      toast({ variant: "destructive", title: "Erro", description: "Produto sem SKU — use o escopo 'somente este anúncio'." });
    } else if (stockScope === "account") {
      updateSkuStock({ sku: stockDialog.sku, data: { quantity: qty }, params: { account_id: stockDialog.accountId } });
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Produtos</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {pagination?.total ?? 0} produtos encontrados
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Buscar por título ou SKU..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500 h-8 text-sm"
          />
        </div>

        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-slate-300 text-sm h-8">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-300">Todos</SelectItem>
            <SelectItem value="active" className="text-slate-300">Ativos</SelectItem>
            <SelectItem value="paused" className="text-slate-300">Pausados</SelectItem>
            <SelectItem value="closed" className="text-slate-300">Encerrados</SelectItem>
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
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium">Produto</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium">SKU</th>
                <th className="text-center px-4 py-3 text-slate-400 text-xs font-medium">Logística</th>
                <th className="text-right px-4 py-3 text-slate-400 text-xs font-medium">Estoque</th>
                <th className="text-right px-4 py-3 text-slate-400 text-xs font-medium">Preço</th>
                <th className="text-center px-4 py-3 text-slate-400 text-xs font-medium">Status</th>
                <th className="text-center px-4 py-3 text-slate-400 text-xs font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-800/50">
                    {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Package className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-slate-500 text-sm">Nenhum produto encontrado</p>
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/products/${p.id}`} className="flex items-center gap-2 group">
                        {p.thumbnail ? (
                          <img
                            src={p.thumbnail}
                            alt=""
                            className="w-8 h-8 rounded object-cover flex-shrink-0 bg-slate-800"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center flex-shrink-0">
                            <Package className="w-4 h-4 text-slate-600" />
                          </div>
                        )}
                        <span className="text-slate-200 group-hover:text-blue-400 transition-colors truncate max-w-xs">
                          {p.title}
                        </span>
                      </Link>
                    </td>

                    <td className="px-4 py-3">
                      <span className="text-slate-400 text-xs font-mono">{p.sku ?? "—"}</span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <LogisticBadge type={p.logisticType} />
                    </td>

                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-bold px-2 py-0.5 rounded ${stockBgColor(p.availableQuantity)}`}>
                        {p.availableQuantity ?? 0}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      {p.originalPrice != null && p.originalPrice > (p.price ?? 0) ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-slate-500 text-[10px] line-through">
                            De: {formatCurrency(p.originalPrice)}
                          </span>
                          <span className="text-emerald-400 text-xs font-semibold">
                            Por: {formatCurrency(p.price)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-200 text-xs">{formatCurrency(p.price)}</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${STATUS_COLORS[p.status ?? ""] ?? "bg-slate-800 text-slate-500 border-slate-700"}`}>
                        {STATUS_LABELS[p.status ?? ""] ?? p.status ?? "—"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      {p.isFull ? (
                        <span className="text-[10px] text-slate-500 italic">FULL</span>
                      ) : (
                        <button
                          onClick={() => openStockDialog(p)}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Editar estoque
                        </button>
                      )}
                    </td>
                  </tr>
                ))
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

      <Dialog open={!!stockDialog} onOpenChange={(o) => { if (!o) { setStockDialog(null); setNewQuantity(""); } }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white text-base">Editar Estoque</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-slate-400 text-xs truncate">{stockDialog?.title}</p>
              {stockDialog?.sku && (
                <p className="text-slate-500 text-[10px] font-mono">SKU: {stockDialog.sku}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Escopo da atualização</Label>
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="scope"
                    value="single"
                    checked={stockScope === "single"}
                    onChange={() => setStockScope("single")}
                    className="mt-0.5 accent-blue-500"
                  />
                  <div>
                    <p className="text-slate-200 text-xs font-medium">Somente este anúncio</p>
                    <p className="text-slate-500 text-[10px]">Atualiza apenas este item</p>
                  </div>
                </label>
                {stockDialog?.sku && (
                  <>
                    <label className="flex items-start gap-2 cursor-pointer group">
                      <input
                        type="radio"
                        name="scope"
                        value="account"
                        checked={stockScope === "account"}
                        onChange={() => setStockScope("account")}
                        className="mt-0.5 accent-blue-500"
                      />
                      <div>
                        <p className="text-slate-200 text-xs font-medium">Mesma conta — SKU {stockDialog.sku}</p>
                        <p className="text-slate-500 text-[10px]">Todos os anúncios desta conta com o mesmo SKU</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer group">
                      <input
                        type="radio"
                        name="scope"
                        value="all"
                        checked={stockScope === "all"}
                        onChange={() => setStockScope("all")}
                        className="mt-0.5 accent-blue-500"
                      />
                      <div>
                        <p className="text-slate-200 text-xs font-medium">Todas as contas — SKU {stockDialog.sku}</p>
                        <p className="text-slate-500 text-[10px]">Reflete em todos os anúncios de todas as contas com este SKU</p>
                      </div>
                    </label>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Nova quantidade</Label>
              <Input
                type="number"
                min={0}
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="0"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setStockDialog(null); setNewQuantity(""); }}
              className="border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
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
