import { useMemo, useState } from "react";
import {
  useGetPromotionsSummary,
  useListPromotionInbox,
  useListPromotions,
  useListAccounts,
  useBulkActivatePromotionItems,
  getListPromotionInboxQueryKey,
  getListPromotionsQueryKey,
  getGetPromotionsSummaryQueryKey,
} from "@workspace/api-client-react";
import type { PromotionInboxEntry } from "@workspace/api-client-react";
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

const ALL_CAMPAIGNS = "all";

function parseCampaignValue(value: string): {
  accountId?: string;
  promotionId?: string;
  promotionType?: string;
} | null {
  if (value === ALL_CAMPAIGNS) return null;
  const [accountId, promotionId, promotionType] = value.split("::");
  if (!accountId || !promotionId || !promotionType) return null;
  return { accountId, promotionId, promotionType };
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-card border border-card-border rounded-xl px-4 py-3">
      <p className={cn("text-2xl font-bold tabular-nums", accent ?? "text-foreground")}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function SkuCampaignCard({
  entry,
  selected,
  onToggle,
  onActivate,
}: {
  entry: PromotionInboxEntry;
  selected: boolean;
  onToggle: () => void;
  onActivate: () => void;
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
        <p className="text-sm font-semibold text-foreground truncate">
          {entry.promotionName ?? entry.promotionTypeLabel ?? entry.promotionType}
        </p>
        <p className="text-sm font-medium text-foreground truncate mt-0.5">
          {entry.title ?? entry.itemId}
        </p>
        <p className="text-[11px] font-mono text-muted-foreground truncate">
          {entry.sku ? `SKU ${entry.sku}` : entry.itemId}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <PromotionTypeBadge type={entry.promotionType} label={entry.promotionTypeLabel ?? undefined} />
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
          {entry.accountNickname && (
            <span className="text-muted-foreground ml-auto truncate">{entry.accountNickname}</span>
          )}
        </div>
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
  const [selectedCampaign, setSelectedCampaign] = useState(ALL_CAMPAIGNS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activateTarget, setActivateTarget] = useState<PromotionInboxEntry | null>(null);

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

  const campaignsParams = {
    account_id: accountFilter,
    status: "active" as const,
    page: 1,
    limit: 100,
    refresh: refreshing,
  };

  const { data: campaignsData, isLoading: campaignsLoading } = useListPromotions(campaignsParams, {
    query: {
      queryKey: getListPromotionsQueryKey(campaignsParams),
    },
  });

  const campaignOptions = useMemo(() => {
    const campaigns = campaignsData?.data ?? [];
    return [
      { value: ALL_CAMPAIGNS, label: "Todos os tipos", hint: undefined as string | undefined },
      ...campaigns.map((p) => ({
        value: `${p.accountId}::${p.id}::${p.type}`,
        label: p.name ?? p.typeLabel ?? p.id,
        hint: p.accountNickname ?? undefined,
      })),
    ];
  }, [campaignsData?.data]);

  const inboxParams = {
    account_id: campaignFilter?.accountId ?? accountFilter,
    promotion_id: campaignFilter?.promotionId,
    promotion_type: campaignFilter?.promotionType,
    search: skuQuery || undefined,
    page,
    limit: 20,
    refresh: refreshing,
  };

  const { data: inboxData, isLoading: inboxLoading } = useListPromotionInbox(inboxParams, {
    query: {
      queryKey: getListPromotionInboxQueryKey(inboxParams),
      enabled: skuQuery.length > 0,
    },
  });

  const { mutate: bulkActivate, isPending: bulkPending } = useBulkActivatePromotionItems({
    mutation: {
      onSuccess: (data) => {
        const ok = data.results?.filter((r) => r.ok).length ?? 0;
        const fail = data.results?.filter((r) => !r.ok).length ?? 0;
        toast({
          title: "Ativação em massa concluída",
          description: `${ok} ativados${fail > 0 ? `, ${fail} com erro` : ""}.`,
          variant: fail > 0 ? "destructive" : "default",
        });
        setSelected(new Set());
        queryClient.invalidateQueries({ queryKey: getListPromotionInboxQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPromotionsSummaryQueryKey() });
      },
      onError: () => {
        toast({ title: "Erro na ativação em massa", variant: "destructive" });
      },
    },
  });

  const inbox = inboxData?.data ?? [];
  const pagination = inboxData?.pagination;
  const isLoading = skuQuery.length > 0 && inboxLoading;

  function handleRefresh() {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: getGetPromotionsSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPromotionInboxQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
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

  function handleBulkActivate() {
    const entries = inbox.filter((e) => selected.has(`${e.promotionId}:${e.itemId}`));
    if (entries.length === 0) return;

    const byPromo = new Map<string, PromotionInboxEntry[]>();
    for (const e of entries) {
      const key = `${e.promotionId}:${e.accountId}:${e.promotionType}`;
      const list = byPromo.get(key) ?? [];
      list.push(e);
      byPromo.set(key, list);
    }

    for (const [, group] of byPromo) {
      const first = group[0];
      bulkActivate({
        promotionId: first.promotionId,
        data: {
          accountId: first.accountId,
          promotionType: first.promotionType,
          items: group.map((e) => ({ itemId: e.itemId, useSuggested: true })),
        },
      });
    }
  }

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
              setSelectedCampaign(ALL_CAMPAIGNS);
              setPage(1);
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
            }}
            disabled={campaignsLoading}
          >
            <SelectTrigger className="w-[220px] h-8 text-xs">
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              {campaignOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="truncate">{o.label}</span>
                  {o.hint && (
                    <span className="text-muted-foreground ml-1">· {o.hint}</span>
                  )}
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
              }}
              placeholder="Buscar por SKU do produto..."
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        {skuQuery.length > 0 && selected.size > 0 && (
          <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
            <span className="text-xs text-foreground">{selected.size} selecionados</span>
            <Button size="sm" className="h-7 text-xs ml-auto" onClick={handleBulkActivate} disabled={bulkPending}>
              {bulkPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Ativar com preço sugerido"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
              Limpar
            </Button>
          </div>
        )}

        {skuQuery.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm space-y-2">
            <p>Digite o SKU de um produto para ver as campanhas disponíveis.</p>
            <p className="text-xs">
              {campaignOptions.length > 1
                ? `${campaignOptions.length - 1} campanha${campaignOptions.length - 1 !== 1 ? "s" : ""} ativa${campaignOptions.length - 1 !== 1 ? "s" : ""} no filtro acima.`
                : "Nenhuma campanha ativa no momento."}
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : inbox.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Nenhuma campanha disponível para o SKU &quot;{skuQuery}&quot;.
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {inbox.length} campanha(s) disponível(eis) para o SKU &quot;{skuQuery}&quot;
            </p>
            {inbox.map((entry) => (
              <SkuCampaignCard
                key={`${entry.promotionId}-${entry.itemId}`}
                entry={entry}
                selected={selected.has(`${entry.promotionId}:${entry.itemId}`)}
                onToggle={() => toggleSelect(entry.itemId, entry.promotionId)}
                onActivate={() => setActivateTarget(entry)}
              />
            ))}
          </div>
        )}

        {skuQuery.length > 0 && pagination && pagination.totalPages > 1 && (
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
