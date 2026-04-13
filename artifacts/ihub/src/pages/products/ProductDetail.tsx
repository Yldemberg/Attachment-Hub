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
  under_review: "Em revisão",
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
      <div className="h-full overflow-y-auto bg-background p-6">
        <div className="h-6 w-32 bg-muted rounded animate-pulse mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 text-center">
        <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground">Produto não encontrado</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/products")}
          className="mt-4"
        >
          Voltar
        </Button>
      </div>
    );
  }

  const hasPromo = p.originalPrice != null && p.originalPrice > (p.price ?? 0);
  const variations: ProductVariation[] = Array.isArray(p.variationsJson) ? p.variationsJson : [];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-4 max-w-3xl">
        <button
          onClick={() => navigate("/products")}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Produtos
        </button>

        <div className="bg-card border border-card-border rounded-xl p-5 flex items-start gap-4">
          {p.thumbnail ? (
            <img src={p.thumbnail} alt="" className="w-20 h-20 rounded-xl object-cover bg-muted flex-shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
              <Package className="w-8 h-8 text-muted-foreground/30" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-lg font-semibold text-foreground leading-tight">{p.title}</h1>
              {p.permalink && (
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
            <p className="text-muted-foreground text-xs mt-1 font-mono">{p.mlItemId}</p>
            {p.isFull && (
              <span className="inline-block mt-2 text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-lg px-2 py-0.5">
                FULL — estoque gerenciado pelo ML
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-card border border-card-border rounded-xl p-3">
            <p className="text-muted-foreground text-xs mb-1">SKU</p>
            <p className="text-foreground text-sm font-mono">{p.sku ?? "—"}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-3">
            <p className="text-muted-foreground text-xs mb-1">Preço</p>
            {hasPromo ? (
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-xs line-through">
                  De: {formatCurrency(p.originalPrice)}
                </p>
                <p className="text-amber-600 text-sm font-semibold">
                  Por: {formatCurrency(p.price)}
                </p>
              </div>
            ) : (
              <p className="text-amber-600 text-sm font-medium">{formatCurrency(p.price)}</p>
            )}
          </div>
          <div className="bg-card border border-card-border rounded-xl p-3">
            <p className="text-muted-foreground text-xs mb-1">Status</p>
            <p className="text-foreground text-sm font-medium">{STATUS_LABELS[p.status ?? ""] ?? p.status ?? "—"}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-3">
            <p className="text-muted-foreground text-xs mb-1">Atualizado</p>
            <p className="text-foreground text-sm font-medium">{formatDateTime(p.updatedAt)}</p>
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Estoque disponível</h2>
            <span className={`text-lg font-bold px-3 py-1 rounded-lg ${stockBgColor(p.availableQuantity)}`}>
              {p.availableQuantity ?? 0}
            </span>
          </div>

          {!p.isFull && p.sku && (
            <div className="border-t border-border pt-4">
              <p className="text-muted-foreground text-xs mb-3">
                Atualizar estoque de todos os anúncios com SKU{" "}
                <span className="font-mono text-foreground">{p.sku}</span>:
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
                    className="h-8 text-sm"
                  />
                </div>
                <Button
                  onClick={() => updateStock({ sku: p.sku!, data: { quantity: Number(newQty) } })}
                  disabled={!newQty || isPending}
                  size="sm"
                  className="h-8"
                >
                  {isPending ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
                  {saved ? "Atualizado!" : "Atualizar"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {variations.length > 0 && (
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Variações{" "}
                <span className="text-muted-foreground font-normal">({variations.length})</span>
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Atributos</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">SKU</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Preço</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Estoque</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Vendidos</th>
                  </tr>
                </thead>
                <tbody>
                  {variations.map((v) => (
                    <tr key={v.id} className="border-b border-border/50 hover:bg-accent/50">
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {v.attributes.map((a) => (
                            <span
                              key={a.name}
                              className="inline-flex items-center gap-1 text-[10px] bg-muted text-foreground rounded-lg px-1.5 py-0.5"
                            >
                              <span className="text-muted-foreground">{a.name}:</span> {a.value}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-primary">{v.sku ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-amber-600 font-medium">
                        {formatCurrency(v.price)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`font-bold px-1.5 py-0.5 rounded ${stockBgColor(v.available_quantity)}`}>
                          {v.available_quantity}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
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
    </div>
  );
}
