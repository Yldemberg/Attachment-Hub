import { useState } from "react";
import {
  useListProducts,
  useListAccounts,
  useUpdateStockBySku,
  getListProductsQueryKey,
  ListProductsStatus,
} from "@workspace/api-client-react";
import { formatCurrency, stockBgColor } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Package, RefreshCw } from "lucide-react";
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

interface Product {
  id: string;
  title?: string | null;
  sku?: string | null;
  availableQuantity?: number | null;
  price?: number | null;
  originalPrice?: number | null;
  status?: string | null;
  isFull?: boolean | null;
  thumbnail?: string | null;
  mlItemId?: string | null;
  permalink?: string | null;
  accountId?: string;
}

interface StockUpdateDialog {
  sku: string;
  title: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
  under_review: "Em revisao",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  paused: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  closed: "bg-slate-800 text-slate-500 border-slate-700",
  under_review: "bg-blue-900/40 text-blue-400 border-blue-800/50",
};

export default function Products() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [stockDialog, setStockDialog] = useState<StockUpdateDialog | null>(null);
  const [newQuantity, setNewQuantity] = useState("");

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

  const { mutate: updateStock, isPending: updatingStock } = useUpdateStockBySku({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        setStockDialog(null);
        setNewQuantity("");
      },
    },
  });

  const handleStockUpdate = () => {
    if (!stockDialog || !newQuantity) return;
    updateStock({
      sku: stockDialog.sku,
      data: { quantity: Number(newQuantity) },
    });
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
            placeholder="Buscar por titulo ou SKU..."
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
                <th className="text-right px-4 py-3 text-slate-400 text-xs font-medium">Estoque</th>
                <th className="text-right px-4 py-3 text-slate-400 text-xs font-medium">Preco</th>
                <th className="text-center px-4 py-3 text-slate-400 text-xs font-medium">Status</th>
                <th className="text-center px-4 py-3 text-slate-400 text-xs font-medium">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-800/50">
                    {[1, 2, 3, 4, 5, 6].map((j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
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
                        {p.isFull && (
                          <span className="text-[10px] bg-blue-900/40 text-blue-400 border border-blue-800/50 rounded px-1 py-0.5 flex-shrink-0">
                            FULL
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-400 text-xs font-mono">{p.sku ?? "—"}</span>
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
                            {formatCurrency(p.originalPrice)}
                          </span>
                          <span className="text-emerald-400 text-xs font-semibold">
                            {formatCurrency(p.price)}
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
                      {p.sku && !p.isFull && (
                        <button
                          onClick={() => setStockDialog({ sku: p.sku!, title: p.title ?? p.sku! })}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Atualizar estoque
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
              Pagina {page} de {pagination.totalPages}
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
                Proxima
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!stockDialog} onOpenChange={(o) => { if (!o) setStockDialog(null); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white text-base">Atualizar Estoque</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-slate-400 text-sm">
              Atualiza o estoque de todos os anuncios com o SKU{" "}
              <span className="text-white font-mono">{stockDialog?.sku}</span> em todas as suas contas
              (exceto produtos FULL).
            </p>
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
              onClick={() => setStockDialog(null)}
              className="border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleStockUpdate}
              disabled={!newQuantity || updatingStock}
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              {updatingStock ? (
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
