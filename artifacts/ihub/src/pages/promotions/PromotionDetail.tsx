import { useState } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import {
  useGetPromotion,
  useListPromotionItems,
  useBulkActivatePromotionItems,
  getListPromotionItemsQueryKey,
  getListPromotionInboxQueryKey,
  getGetPromotionQueryKey,
  getGetPromotionsSummaryQueryKey,
  getListPromotionsQueryKey,
} from "@workspace/api-client-react";
import type { PromotionItem } from "@workspace/api-client-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  ArrowLeft,
  Package,
  ExternalLink,
  Loader2,
  CheckSquare,
  Square,
  MinusSquare,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PromotionTypeBadge, formatDeadline } from "./components/PromotionTypeBadge";
import { ActivatePromotionDialog } from "./components/ActivatePromotionDialog";
import {
  bulkActivateToastContent,
  buildBulkActivateItemsFromPrices,
  bulkActivateErrorMessage,
} from "./components/bulkActivateFeedback";

const ITEM_STATUS_TABS = [
  { value: undefined, label: "Todos" },
  { value: "candidate", label: "Candidatos" },
  { value: "pending", label: "Pendentes" },
  { value: "started", label: "Ativos" },
  { value: "finished", label: "Encerrados" },
];

function parseSearchParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return Object.fromEntries(params.entries());
}

function ItemCard({
  item,
  selected,
  onToggle,
  onActivate,
  showActivate,
}: {
  item: PromotionItem;
  selected: boolean;
  onToggle: () => void;
  onActivate: () => void;
  showActivate: boolean;
}) {
  const statusLabel =
    item.status === "candidate"
      ? "Candidato"
      : item.status === "started"
        ? "Ativo"
        : item.status === "pending"
          ? "Pendente"
          : item.status === "finished"
            ? "Encerrado"
            : item.status;

  return (
    <div className="flex items-center gap-2 bg-card border border-card-border rounded-xl px-3 py-2">
      {showActivate && (
        <button
          type="button"
          onClick={onToggle}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground p-1"
        >
          {selected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
        </button>
      )}

      {item.thumbnail ? (
        <img src={item.thumbnail} alt="" className="size-12 rounded-lg object-cover bg-muted flex-shrink-0" />
      ) : (
        <div className="size-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Package className="w-5 h-5 text-muted-foreground/40" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.title ?? item.itemId}</p>
        <p className="text-[11px] font-mono text-muted-foreground">{item.itemId}</p>
        <div className="flex items-center gap-2 mt-1 text-xs flex-wrap">
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-md border",
              item.status === "candidate"
                ? "bg-red-50 text-red-700 border-red-200"
                : item.status === "started"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-100 text-slate-600 border-slate-200",
            )}
          >
            {statusLabel}
          </span>
          {item.originalPrice != null && (
            <span className="text-muted-foreground line-through">{formatCurrency(item.originalPrice)}</span>
          )}
          {item.suggestedDiscountedPrice != null && (
            <span className="font-semibold text-red-600">{formatCurrency(item.suggestedDiscountedPrice)}</span>
          )}
          {item.price != null && item.price > 0 && (
            <span className="font-semibold text-foreground">{formatCurrency(item.price)}</span>
          )}
          {item.availableQuantity != null && (
            <span className="text-muted-foreground">Estoque: {item.availableQuantity}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 flex-shrink-0">
        {showActivate && item.status === "candidate" && (
          <Button size="sm" className="h-7 text-xs" onClick={onActivate}>
            Ativar
          </Button>
        )}
        {item.permalink && (
          <a
            href={item.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary p-0.5 self-center"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function PromotionDetail() {
  const { promotionId: rawPromotionId } = useParams<{ promotionId: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { account_id: accountId, promotion_type: promotionType } = parseSearchParams(search);

  const [itemStatus, setItemStatus] = useState<string | undefined>("candidate");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activateTarget, setActivateTarget] = useState<PromotionItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const promoId = decodeURIComponent(rawPromotionId ?? "");

  const promotionParams = { account_id: accountId, promotion_type: promotionType };
  const itemsParams = {
    account_id: accountId,
    promotion_type: promotionType,
    status: itemStatus,
    search: searchText.trim() || undefined,
    page,
    limit: 50,
    refresh: refreshing,
  };

  const { data: promotionFromGet, isLoading: promotionLoading } = useGetPromotion(
    promoId,
    promotionParams,
    {
      query: {
        queryKey: getGetPromotionQueryKey(promoId, promotionParams),
        enabled: !!promoId && !!accountId && !!promotionType,
      },
    },
  );

  const {
    data: itemsData,
    isLoading: itemsLoading,
    isError: itemsError,
    refetch: refetchItems,
  } = useListPromotionItems(
    promoId,
    itemsParams,
    {
      query: {
        queryKey: getListPromotionItemsQueryKey(promoId, itemsParams),
        enabled: !!promoId && !!accountId && !!promotionType,
      },
    },
  );

  const promotion = promotionFromGet ?? itemsData?.promotion ?? null;
  const promoLoading = promotionLoading && itemsLoading && !promotion;

  const { mutate: bulkActivate, isPending: bulkPending } = useBulkActivatePromotionItems({
    mutation: {
      onSuccess: (data) => {
        const toastContent = bulkActivateToastContent(data.results);
        toast(toastContent);
        if ((data.results?.filter((r) => r.ok).length ?? 0) > 0) {
          setSelected(new Set());
        }
        queryClient.invalidateQueries({
          queryKey: getListPromotionItemsQueryKey(promoId, itemsParams),
        });
        queryClient.invalidateQueries({ queryKey: getListPromotionInboxQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPromotionsSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
      },
      onError: (err) => {
        toast({
          title: "Erro na ativação em massa",
          description: bulkActivateErrorMessage(err),
          variant: "destructive",
        });
      },
    },
  });

  if (!accountId || !promotionType) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        Parâmetros inválidos. Volte à lista de promoções.
        <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/promotions")}>
          Voltar
        </Button>
      </div>
    );
  }

  const items = itemsData?.data ?? [];
  const pagination = itemsData?.pagination;
  const deadline = promotion ? formatDeadline(promotion.deadlineDate) : null;
  const candidateItems = items.filter((item) => item.status === "candidate");
  const allPageSelected =
    candidateItems.length > 0 && candidateItems.every((item) => selected.has(item.itemId));
  const somePageSelected = candidateItems.some((item) => selected.has(item.itemId));

  function handleRefresh() {
    setRefreshing(true);
    queryClient.invalidateQueries({
      queryKey: getListPromotionItemsQueryKey(promoId, itemsParams),
    });
    setTimeout(() => setRefreshing(false), 500);
  }

  function handleBulkActivate() {
    if (!promoId || selected.size === 0) return;
    const selectedItems = items.filter((item) => selected.has(item.itemId));
    bulkActivate({
      promotionId: promoId,
      data: {
        accountId,
        promotionType,
        items: buildBulkActivateItemsFromPrices(selectedItems),
      },
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const item of candidateItems) next.delete(item.itemId);
      } else {
        for (const item of candidateItems) next.add(item.itemId);
      }
      return next;
    });
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <button
          type="button"
          onClick={() => navigate("/promotions")}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Promoções
        </button>

        {promoLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : promotion ? (
          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-foreground">{promotion.name ?? promotion.id}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <PromotionTypeBadge type={promotion.type} label={promotion.typeLabel ?? undefined} />
                  {deadline && (
                    <span className="text-xs text-red-600 font-medium">{deadline}</span>
                  )}
                </div>
                {promotion.benefits && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {promotion.benefits.meliPercent != null && `Mercado Livre: ${promotion.benefits.meliPercent}%`}
                    {promotion.benefits.sellerPercent != null && ` · Vendedor: ${promotion.benefits.sellerPercent}%`}
                    {promotion.benefits.buyQuantity != null &&
                      promotion.benefits.payQuantity != null &&
                      ` · ${promotion.benefits.buyQuantity}x${promotion.benefits.payQuantity}`}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 items-center">
          {ITEM_STATUS_TABS.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => { setItemStatus(t.value); setPage(1); }}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors",
                itemStatus === t.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-card-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
          <Input
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
            placeholder="Buscar item..."
            className="h-8 text-xs max-w-[200px] ml-auto"
          />
        </div>

        {itemStatus === "candidate" && candidateItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-muted/40 border border-border rounded-lg px-3 py-2">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
            >
              {allPageSelected ? (
                <CheckSquare className="w-4 h-4 text-primary" />
              ) : somePageSelected ? (
                <MinusSquare className="w-4 h-4 text-primary" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground" />
              )}
              {allPageSelected ? "Desmarcar todos" : "Selecionar todos"}
              {pagination && pagination.total > candidateItems.length
                ? ` (${candidateItems.length} nesta página)`
                : pagination
                  ? ` (${candidateItems.length})`
                  : ""}
            </button>

            {selected.size > 0 && (
              <>
                <span className="text-xs text-muted-foreground hidden sm:inline">·</span>
                <span className="text-xs">{selected.size} selecionado(s)</span>
                <Button
                  size="sm"
                  className="h-7 text-xs ml-auto"
                  onClick={handleBulkActivate}
                  disabled={bulkPending}
                >
                  {bulkPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Ativar com preço sugerido"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setSelected(new Set())}
                >
                  Limpar
                </Button>
              </>
            )}
          </div>
        )}

        {itemsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : itemsError ? (
          <div className="text-center py-8 space-y-3">
            <p className="text-muted-foreground text-sm">
              Não foi possível carregar os anúncios desta campanha.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetchItems()}>
              Tentar novamente
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-8">
            {itemStatus === "candidate"
              ? "Nenhum anúncio candidato nesta campanha."
              : "Nenhum item nesta campanha."}
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <ItemCard
                key={item.itemId}
                item={item}
                selected={selected.has(item.itemId)}
                onToggle={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.itemId)) next.delete(item.itemId);
                    else next.add(item.itemId);
                    return next;
                  });
                }}
                onActivate={() => setActivateTarget(item)}
                showActivate={itemStatus === "candidate" || itemStatus === undefined}
              />
            ))}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">{page} / {pagination.totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        )}
      </div>

      {activateTarget && promoId && (
        <ActivatePromotionDialog
          open={!!activateTarget}
          onOpenChange={(open) => !open && setActivateTarget(null)}
          promotionId={promoId}
          promotionType={promotionType}
          accountId={accountId}
          item={activateTarget}
        />
      )}
    </div>
  );
}
