import { useMemo, useState } from "react";
import {
  useGetPromotionsSummary,
  useListPromotionInbox,
  useListPromotions,
  useListPromotionItems,
  useListAccounts,
  getListPromotionInboxQueryKey,
  getListPromotionsQueryKey,
  getListPromotionItemsQueryKey,
  getGetPromotionsSummaryQueryKey,
} from "@workspace/api-client-react";
import type { PromotionInboxEntry, PromotionItem } from "@workspace/api-client-react";
import { Link } from "wouter";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Tag,
  Search,
  RefreshCw,
  Package,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Clock,
  CheckSquare,
  Square,
  MinusSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PromotionTypeBadge, formatDeadline } from "./components/PromotionTypeBadge";
import { ActivatePromotionDialog } from "./components/ActivatePromotionDialog";
import { PromotionEarningsBlock } from "./components/PromotionEarningsBlock";
import {
  bulkActivateToastContent,
  buildBulkActivatePayloadItems,
  bulkActivateErrorMessage,
  activatePromotionItemsSequentially,
} from "./components/bulkActivateFeedback";

const ALL_CANDIDATES = "all-candidates";

function entrySelectionKey(entry: PromotionInboxEntry): string {
  return `${entry.promotionId}:${entry.itemId}`;
}

function isNonActivatedItem(entry: PromotionInboxEntry): boolean {
  return entry.itemStatus === "candidate";
}

function parseCampaignValue(value: string): {
  accountId: string;
  promotionId: string;
  promotionType: string;
} | null {
  if (value === ALL_CANDIDATES) return null;
  const [accountId, promotionId, promotionType] = value.split("::");
  if (!accountId || !promotionId || !promotionType) return null;
  return { accountId, promotionId, promotionType };
}

function promotionItemToInboxEntry(
  item: PromotionItem,
  campaign: {
    promotionId: string;
    promotionType: string;
    promotionTypeLabel?: string | null;
    promotionName?: string | null;
    accountId: string;
    accountNickname?: string | null;
    deadlineDate?: string | null;
  },
): PromotionInboxEntry {
  const discountPercent =
    item.originalPrice != null &&
    item.suggestedDiscountedPrice != null &&
    item.originalPrice > 0 &&
    item.suggestedDiscountedPrice < item.originalPrice
      ? Math.round(
          ((item.originalPrice - item.suggestedDiscountedPrice) / item.originalPrice) * 100,
        )
      : null;

  return {
    itemId: item.itemId,
    promotionId: campaign.promotionId,
    promotionType: campaign.promotionType,
    promotionTypeLabel: campaign.promotionTypeLabel,
    promotionName: campaign.promotionName,
    itemStatus: item.status,
    accountId: campaign.accountId,
    accountNickname: campaign.accountNickname,
    originalPrice: item.originalPrice,
    suggestedDiscountedPrice: item.suggestedDiscountedPrice,
    minDiscountedPrice: item.minDiscountedPrice,
    maxDiscountedPrice: item.maxDiscountedPrice,
    maxOriginalPrice: item.maxOriginalPrice,
    stockMin: item.stockMin,
    stockMax: item.stockMax,
    startDate: item.startDate,
    endDate: item.endDate,
    title: item.title,
    sku: item.sku,
    thumbnail: item.thumbnail,
    permalink: item.permalink,
    discountPercent,
    deadlineDate: campaign.deadlineDate,
    availableQuantity: item.availableQuantity,
    offerId: item.offerId,
    netProceeds: item.netProceeds,
    feeSubsidyAmount: item.feeSubsidyAmount,
    taxPercent: item.taxPercent,
    purchasePrice: item.purchasePrice,
  };
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-card border border-card-border rounded-xl px-4 py-3">
      <p className={cn("text-2xl font-bold tabular-nums", accent ?? "text-foreground")}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function CandidateCard({
  entry,
  selected,
  onToggle,
  onActivate,
  showCampaignName,
}: {
  entry: PromotionInboxEntry;
  selected: boolean;
  onToggle: () => void;
  onActivate: () => void;
  showCampaignName: boolean;
}) {
  const deadline = formatDeadline(entry.deadlineDate);
  const isUrgent = deadline === "Vence hoje" || deadline === "Vence amanhã";

  return (
    <div className="flex items-center gap-2 bg-card border border-card-border rounded-xl px-3 py-2 hover:border-primary/40 transition-all">
      <button
        type="button"
        onClick={onToggle}
        className="flex-shrink-0 text-muted-foreground hover:text-foreground p-1"
        aria-label={selected ? "Desmarcar" : "Selecionar"}
      >
        {selected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
      </button>

      {entry.thumbnail ? (
        <img src={entry.thumbnail} alt="" className="size-14 rounded-lg object-cover bg-muted flex-shrink-0" />
      ) : (
        <div className="size-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Package className="w-6 h-6 text-muted-foreground/40" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        {showCampaignName && (
          <p className="text-sm font-semibold text-foreground truncate">
            {entry.promotionName ?? entry.promotionTypeLabel ?? entry.promotionType}
          </p>
        )}
        <p className={cn("text-sm font-medium text-foreground truncate", showCampaignName && "mt-0.5")}>
          {entry.title ?? entry.itemId}
        </p>
        <p className="text-[11px] font-mono text-muted-foreground truncate">
          {entry.sku ? `SKU ${entry.sku}` : entry.itemId}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {showCampaignName && (
            <PromotionTypeBadge type={entry.promotionType} label={entry.promotionTypeLabel ?? undefined} />
          )}
          {deadline && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md border",
                isUrgent
                  ? "bg-red-50 text-red-700 border-red-200"
                  : "bg-amber-50 text-amber-700 border-amber-200",
              )}
            >
              <Clock className="w-3 h-3" />
              {deadline}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs">
          {entry.originalPrice != null && (
            <span className="text-muted-foreground line-through">{formatCurrency(entry.originalPrice)}</span>
          )}
          {entry.suggestedDiscountedPrice != null && (
            <span className="font-semibold text-red-600">{formatCurrency(entry.suggestedDiscountedPrice)}</span>
          )}
          {entry.discountPercent != null && (
            <span className="text-red-600 font-medium">-{entry.discountPercent}%</span>
          )}
          {(entry.stockMin != null || entry.stockMax != null) && (
            <span className="text-muted-foreground">
              Estoque permitido: {entry.stockMin ?? 1}
              {entry.stockMax != null ? `–${entry.stockMax}` : ""} un.
            </span>
          )}
          {entry.accountNickname && (
            <span className="text-muted-foreground ml-auto truncate">{entry.accountNickname}</span>
          )}
        </div>
        <PromotionEarningsBlock
          className="mt-1.5"
          netProceedsAmount={entry.netProceeds?.amount}
          feeSubsidyAmount={entry.feeSubsidyAmount}
          taxPercent={entry.taxPercent}
          purchasePrice={entry.purchasePrice}
          promoPrice={entry.suggestedDiscountedPrice}
        />
      </div>

      <div className="flex flex-col gap-1 flex-shrink-0">
        <Button size="sm" variant="default" className="h-7 text-xs" onClick={onActivate}>
          Ativar
        </Button>
        <Link
          href={`/promotions/${encodeURIComponent(entry.promotionId)}?account_id=${entry.accountId}&promotion_type=${entry.promotionType}`}
          className="text-[10px] text-primary hover:underline text-center"
        >
          Ver campanha
        </Link>
        {entry.permalink && (
          <a
            href={entry.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary p-0.5 self-center"
            title="Abrir no ML"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function Promotions() {
  const [accountId, setAccountId] = useState<string>("all");
  const [selectedCampaign, setSelectedCampaign] = useState(ALL_CANDIDATES);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activateTarget, setActivateTarget] = useState<PromotionInboxEntry | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: accountsData } = useListAccounts();
  const accounts = accountsData?.data ?? [];

  const accountFilter = accountId === "all" ? undefined : accountId;
  const campaignFilter = parseCampaignValue(selectedCampaign);
  const skuQuery = search.trim();

  const { data: summary, isLoading: summaryLoading } = useGetPromotionsSummary({
    account_id: accountFilter,
    refresh: refreshing,
  });

  const campaignsDropdownParams = {
    account_id: accountFilter,
    status: "active" as const,
    page: 1,
    limit: 100,
    refresh: refreshing,
  };

  const { data: campaignsDropdownData, isLoading: campaignsDropdownLoading } = useListPromotions(
    campaignsDropdownParams,
    {
      query: {
        queryKey: getListPromotionsQueryKey(campaignsDropdownParams),
      },
    },
  );

  const campaignOptions = useMemo(() => {
    const campaigns = campaignsDropdownData?.data ?? [];
    return [
      {
        value: ALL_CANDIDATES,
        label: "Todos os anúncios candidatos",
        hint: summary?.candidateItems ? `${summary.candidateItems} itens` : undefined,
      },
      ...campaigns.map((p) => ({
        value: `${p.accountId}::${p.id}::${p.type}`,
        label: p.name ?? p.typeLabel ?? p.id,
        hint: p.accountNickname ?? undefined,
      })),
    ];
  }, [campaignsDropdownData?.data, summary?.candidateItems]);

  const selectedCampaignMeta = useMemo(() => {
    if (!campaignFilter) return null;
    const promo = campaignsDropdownData?.data?.find(
      (p) =>
        p.accountId === campaignFilter.accountId &&
        p.id === campaignFilter.promotionId &&
        p.type === campaignFilter.promotionType,
    );
    return {
      ...campaignFilter,
      promotionName: promo?.name,
      promotionTypeLabel: promo?.typeLabel,
      accountNickname: promo?.accountNickname,
      deadlineDate: promo?.deadlineDate,
    };
  }, [campaignFilter, campaignsDropdownData?.data]);

  const inboxParams = {
    account_id: accountFilter,
    search: skuQuery || undefined,
    page,
    limit: 20,
    refresh: refreshing,
  };

  const inboxEnabled = !campaignFilter;

  const { data: inboxData, isLoading: inboxLoading } = useListPromotionInbox(inboxParams, {
    query: {
      queryKey: getListPromotionInboxQueryKey(inboxParams),
      enabled: inboxEnabled,
    },
  });

  const itemsParams = campaignFilter
    ? {
        account_id: campaignFilter.accountId,
        promotion_type: campaignFilter.promotionType,
        status: "candidate" as const,
        search: skuQuery || undefined,
        page,
        limit: 20,
        refresh: refreshing,
      }
    : null;

  const { data: itemsData, isLoading: itemsLoading } = useListPromotionItems(
    campaignFilter?.promotionId ?? "",
    itemsParams ?? {
      account_id: "",
      promotion_type: "",
      status: "candidate",
      page: 1,
      limit: 20,
    },
    {
      query: {
        queryKey: getListPromotionItemsQueryKey(
          campaignFilter?.promotionId ?? "",
          itemsParams ?? { account_id: "", promotion_type: "", page: 1, limit: 20 },
        ),
        enabled: !!campaignFilter && !!itemsParams,
      },
    },
  );

  const candidateEntries: PromotionInboxEntry[] = useMemo(() => {
    const entries =
      campaignFilter && selectedCampaignMeta
        ? (itemsData?.data ?? []).map((item) =>
            promotionItemToInboxEntry(item, selectedCampaignMeta),
          )
        : (inboxData?.data ?? []);
    return entries.filter(isNonActivatedItem);
  }, [campaignFilter, selectedCampaignMeta, itemsData?.data, inboxData?.data]);

  const pagination = campaignFilter ? itemsData?.pagination : inboxData?.pagination;

  const isLoading = campaignFilter ? itemsLoading : inboxLoading;

  async function invalidateAfterBulkActivate() {
    await queryClient.invalidateQueries({ queryKey: getListPromotionInboxQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
    await queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).includes("/api/promotions/") &&
        (q.queryKey[0] as string).endsWith("/items"),
    });
    await queryClient.invalidateQueries({ queryKey: getGetPromotionsSummaryQueryKey() });
  }

  function handleRefresh() {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: getGetPromotionsSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPromotionInboxQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
    queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).includes("/api/promotions/") &&
        (q.queryKey[0] as string).endsWith("/items"),
    });
    setTimeout(() => setRefreshing(false), 500);
  }

  function toggleSelect(itemId: string, promotionId: string) {
    const key = `${promotionId}:${itemId}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const currentPageKeys = useMemo(
    () => candidateEntries.map(entrySelectionKey),
    [candidateEntries],
  );

  const allPageSelected =
    currentPageKeys.length > 0 && currentPageKeys.every((key) => selected.has(key));
  const somePageSelected = currentPageKeys.some((key) => selected.has(key));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const key of currentPageKeys) next.delete(key);
      } else {
        for (const key of currentPageKeys) next.add(key);
      }
      return next;
    });
  }

  async function handleBulkActivate() {
    const entries = candidateEntries.filter((e) => selected.has(entrySelectionKey(e)));
    if (entries.length === 0 || bulkPending) return;

    const byPromo = new Map<string, PromotionInboxEntry[]>();
    for (const e of entries) {
      const key = `${e.promotionId}:${e.accountId}:${e.promotionType}`;
      const list = byPromo.get(key) ?? [];
      list.push(e);
      byPromo.set(key, list);
    }

    setBulkPending(true);
    setBulkProgress({ done: 0, total: entries.length });

    try {
      const allResults: Awaited<ReturnType<typeof activatePromotionItemsSequentially>> = [];
      let processed = 0;

      for (const [, group] of byPromo) {
        const first = group[0];
        const payloadItems = buildBulkActivatePayloadItems(group, first.promotionType);
        const results = await activatePromotionItemsSequentially({
          promotionId: first.promotionId,
          accountId: first.accountId,
          promotionType: first.promotionType,
          items: payloadItems,
          onProgress: (done) => {
            setBulkProgress({ done: processed + done, total: entries.length });
          },
        });
        allResults.push(...results);
        processed += group.length;
        setBulkProgress({ done: processed, total: entries.length });
      }

      toast(bulkActivateToastContent(allResults));
      if (allResults.some((r) => r.ok)) {
        setSelected(new Set());
        await invalidateAfterBulkActivate();
      }
    } catch (err) {
      toast({
        title: "Erro na ativação em massa",
        description: bulkActivateErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setBulkPending(false);
      setBulkProgress(null);
    }
  }

  const showCampaignNameInCards = !campaignFilter;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-red-600" />
            <h1 className="text-lg font-bold text-foreground">Promoções</h1>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn("w-4 h-4 mr-1.5", refreshing && "animate-spin")} />
            Atualizar
          </Button>
        </div>

        {!summaryLoading && summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KpiCard label="Campanhas ativas" value={summary.activeCampaigns} accent="text-emerald-600" />
            <KpiCard label="Candidatos" value={summary.candidateItems} accent="text-red-600" />
            <KpiCard label="Vence hoje" value={summary.expiringToday} accent="text-amber-600" />
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <Select
            value={accountId}
            onValueChange={(v) => {
              setAccountId(v);
              setSelectedCampaign(ALL_CANDIDATES);
              setPage(1);
              setSelected(new Set());
            }}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Conta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id!}>
                  {a.mlNickname ?? a.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedCampaign}
            onValueChange={(v) => {
              setSelectedCampaign(v);
              setPage(1);
              setSelected(new Set());
            }}
            disabled={campaignsDropdownLoading}
          >
            <SelectTrigger className="w-[220px] h-8 text-xs">
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              {campaignOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="text-muted-foreground ml-1">· {o.hint}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                setSelected(new Set());
              }}
              placeholder="Buscar por SKU, MLB ou título..."
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        {candidateEntries.length > 0 && (
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
              {pagination && pagination.total > candidateEntries.length
                ? ` (${candidateEntries.length} nesta página)`
                : pagination
                  ? ` (${pagination.total})`
                  : ""}
            </button>

            {selected.size > 0 && (
              <>
                <span className="text-xs text-muted-foreground hidden sm:inline">·</span>
                <span className="text-xs text-foreground">{selected.size} selecionado(s)</span>
                <Button
                  size="sm"
                  className="h-7 text-xs ml-auto"
                  onClick={handleBulkActivate}
                  disabled={bulkPending}
                >
                  {bulkPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                      {bulkProgress
                        ? `Ativando ${bulkProgress.done}/${bulkProgress.total}…`
                        : "Ativando…"}
                    </>
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

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : candidateEntries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {!campaignFilter
              ? skuQuery
                ? `Nenhum anúncio candidato para "${skuQuery}".`
                : "Nenhum anúncio candidato no momento."
              : skuQuery
                ? `Nenhum anúncio candidato para "${skuQuery}" nesta campanha.`
                : "Nenhum anúncio candidato nesta campanha."}
          </div>
        ) : (
          <div className="space-y-2">
            {skuQuery && (
              <p className="text-xs text-muted-foreground">
                {candidateEntries.length} resultado(s)
                {campaignFilter ? " nesta campanha" : ""} para &quot;{skuQuery}&quot;
              </p>
            )}
            {!campaignFilter && pagination && (
              <p className="text-xs text-muted-foreground">
                {pagination.total} anúncio(s) não ativado(s) em todas as campanhas
              </p>
            )}
            {!skuQuery && campaignFilter && selectedCampaignMeta && (
              <p className="text-xs text-muted-foreground">
                {candidateEntries.length} anúncio(s) candidato(s) em{" "}
                {selectedCampaignMeta.promotionName ?? selectedCampaignMeta.promotionTypeLabel}
              </p>
            )}
            {candidateEntries.map((entry) => (
              <CandidateCard
                key={`${entry.promotionId}-${entry.itemId}`}
                entry={entry}
                selected={selected.has(entrySelectionKey(entry))}
                onToggle={() => toggleSelect(entry.itemId, entry.promotionId)}
                onActivate={() => setActivateTarget(entry)}
                showCampaignName={showCampaignNameInCards}
              />
            ))}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {activateTarget && (
        <ActivatePromotionDialog
          open={!!activateTarget}
          onOpenChange={(open) => !open && setActivateTarget(null)}
          promotionId={activateTarget.promotionId}
          promotionType={activateTarget.promotionType}
          accountId={activateTarget.accountId}
          item={activateTarget}
        />
      )}
    </div>
  );
}
