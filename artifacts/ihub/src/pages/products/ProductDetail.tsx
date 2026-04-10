import { useParams, useLocation } from "wouter";
import {
  useGetProduct,
  useUpdateStockBySku,
  getGetProductQueryKey,
} from "@workspace/api-client-react";
import { formatCurrency, formatDateTime, stockBgColor } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Package, RefreshCw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProductVariation {
  id: number;
  sku?: string | null;
  price: number;
  available_quantity: number;
  sold_quantity: number;
  attributes: Array<{ name: string; value: string }>;
}

interface Product {
  id: string;
  title?: string | null;
  sku?: string | null;
  availableQuantity?: number | null;
  soldQuantity?: number | null;
  price?: number | null;
  originalPrice?: number | null;
  status?: string | null;
  isFull?: boolean | null;
  thumbnail?: string | null;
  mlItemId?: string | null;
  permalink?: string | null;
  listingType?: string | null;
  logisticType?: string | null;
  accountId?: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  variationsJson?: ProductVariation[] | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
  under_review: "Em revisao",
};

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [newQty, setNewQty] = useState("");
  const [saved, setSaved] = useState(false);

  const { data: product, isLoading } = useGetProduct(id, {
    query: { queryKey: getGetProductQueryKey(id) },
  });
  const p = product as Product | null;

  const { mutate: updateStock, isPending } = useUpdateStockBySku({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(id) });
        setNewQty("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="h-6 w-32 bg-slate-800 rounded animate-pulse mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="p-6 text-center">
        <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">Produto nao encontrado</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/products")}
          className="mt-4 border-slate-700 text-slate-400"
        >
          Voltar
        </Button>
      </div>
    );
  }

  const hasPromo = p.originalPrice != null && p.originalPrice > (p.price ?? 0);
  const variations: ProductVariation[] = Array.isArray(p.variationsJson) ? p.variationsJson : [];

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <button
        onClick={() => navigate("/products")}
        className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Produtos
      </button>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex items-start gap-4">
        {p.thumbnail ? (
          <img src={p.thumbnail} alt="" className="w-20 h-20 rounded-lg object-cover bg-slate-800 flex-shrink-0" />
        ) : (
          <div className="w-20 h-20 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
            <Package className="w-8 h-8 text-slate-600" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-lg font-semibold text-white leading-tight">{p.title}</h1>
            {p.permalink && (
              <a
                href={p.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-slate-500 hover:text-blue-400 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
          <p className="text-slate-500 text-xs mt-1 font-mono">{p.mlItemId}</p>
          {p.isFull && (
            <span className="inline-block mt-2 text-xs bg-blue-900/40 text-blue-400 border border-blue-800/50 rounded px-1.5 py-0.5">
              FULL — estoque gerenciado pelo ML
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <p className="text-slate-500 text-xs mb-1">SKU</p>
          <p className="text-white text-sm font-mono">{p.sku ?? "—"}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <p className="text-slate-500 text-xs mb-1">Preco</p>
          {hasPromo ? (
            <div className="space-y-0.5">
              <p className="text-slate-500 text-xs line-through">
                De: {formatCurrency(p.originalPrice)}
              </p>
              <p className="text-emerald-400 text-sm font-semibold">
                Por: {formatCurrency(p.price)}
              </p>
            </div>
          ) : (
            <p className="text-white text-sm font-medium">{formatCurrency(p.price)}</p>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <p className="text-slate-500 text-xs mb-1">Status</p>
          <p className="text-white text-sm font-medium">{STATUS_LABELS[p.status ?? ""] ?? p.status ?? "—"}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <p className="text-slate-500 text-xs mb-1">Atualizado</p>
          <p className="text-white text-sm font-medium">{formatDateTime(p.updatedAt)}</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Estoque disponivel</h2>
          <span className={`text-lg font-bold px-3 py-1 rounded-lg ${stockBgColor(p.availableQuantity)}`}>
            {p.availableQuantity ?? 0}
          </span>
        </div>

        {!p.isFull && p.sku && (
          <div className="border-t border-slate-800 pt-4">
            <p className="text-slate-400 text-xs mb-3">
              Atualizar estoque de todos os anuncios com SKU{" "}
              <span className="font-mono text-white">{p.sku}</span>:
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 max-w-32">
                <Label className="sr-only">Nova quantidade</Label>
                <Input
                  type="number"
                  min={0}
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  placeholder="0"
                  className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                />
              </div>
              <Button
                onClick={() => updateStock({ sku: p.sku!, data: { quantity: Number(newQty) } })}
                disabled={!newQty || isPending}
                size="sm"
                className="bg-blue-600 hover:bg-blue-500 text-white h-8"
              >
                {isPending ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
                {saved ? "Atualizado!" : "Atualizar"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {variations.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
            <Tag className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">
              Variacoes <span className="text-slate-500 font-normal">({variations.length})</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Atributos</th>
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">SKU</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Preco</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Estoque</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Vendidos</th>
                </tr>
              </thead>
              <tbody>
                {variations.map((v) => (
                  <tr key={v.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {v.attributes.map((a) => (
                          <span
                            key={a.name}
                            className="inline-flex items-center gap-1 text-[10px] bg-slate-800 text-slate-300 rounded px-1.5 py-0.5"
                          >
                            <span className="text-slate-500">{a.name}:</span> {a.value}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-slate-400">{v.sku ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-200">
                      {formatCurrency(v.price)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-bold px-1.5 py-0.5 rounded ${stockBgColor(v.available_quantity)}`}>
                        {v.available_quantity}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-400">
                      {v.sold_quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
