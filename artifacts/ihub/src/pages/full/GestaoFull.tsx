import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useListAccounts,
  useGetFullOverview,
  useGetFullSettings,
  useUpdateFullSettings,
  useSyncFullStock,
  useRunFullAlerts,
  useListFullInbounds,
  useCreateFullInbound,
  useReceiveFullInbound,
  useCancelFullInbound,
  getGetFullOverviewQueryKey,
  getGetFullSettingsQueryKey,
  getListFullInboundsQueryKey,
  GetFullOverviewStatus,
  GetFullOverviewPeriodDays,
  type FullOverviewItem,
  type FullSkuStatus,
  type GetFullOverviewParams,
  type FullInboundShipment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Package,
  PackageX,
  PauseCircle,
  RefreshCw,
  Search,
  Settings2,
  MessageCircle,
  Truck,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | FullSkuStatus;

type InboundDraftLine = {
  key: string;
  sku: string;
  title: string;
  productId: string | null;
  mlItemId: string | null;
  quantity: number;
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Critérios recomendados (lead ~9d + folga, promo A/B). */
const FULL_RECOMMENDED = {
  coverageTargetDays: 25,
  leadTimeDays: 12,
  salesPeriodDays: 15,
  alertRuptura: true,
  alertCritico: true,
  alertParado: false,
  alertQuestions: true,
} as const;

const STATUS_LABEL: Record<FullSkuStatus, string> = {
  ruptura: "Ruptura",
  critico: "Crítico",
  saudavel: "Saudável",
  parado: "Parado",
};

function toOverviewStatus(
  status: StatusFilter,
): (typeof GetFullOverviewStatus)[keyof typeof GetFullOverviewStatus] {
  if (status === "ruptura") return GetFullOverviewStatus.ruptura;
  if (status === "critico") return GetFullOverviewStatus.critico;
  if (status === "saudavel") return GetFullOverviewStatus.saudavel;
  if (status === "parado") return GetFullOverviewStatus.parado;
  return GetFullOverviewStatus.all;
}

function toPeriodDays(
  n: number,
): (typeof GetFullOverviewPeriodDays)[keyof typeof GetFullOverviewPeriodDays] {
  if (n === 7) return GetFullOverviewPeriodDays.NUMBER_7;
  if (n === 15) return GetFullOverviewPeriodDays.NUMBER_15;
  if (n === 60) return GetFullOverviewPeriodDays.NUMBER_60;
  return GetFullOverviewPeriodDays.NUMBER_30;
}

function statusBadgeClass(status: FullSkuStatus): string {
  switch (status) {
    case "ruptura":
      return "bg-red-50 text-red-700 border-red-200";
    case "critico":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "parado":
      return "bg-slate-100 text-slate-600 border-slate-200";
    default:
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
}

function stockColorClass(qty: number): string {
  if (qty === 0) return "text-amber-700";
  if (qty < 3) return "text-red-600";
  if (qty <= 7) return "text-amber-600";
  return "text-emerald-600";
}

function formatCoverage(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days >= 100) return `${Math.round(days)}d`;
  return `${days.toFixed(1)}d`;
}

/** Lookback de lastSaleAt no backend é max(periodo, 90). */
const DAYS_WITHOUT_SALES_LOOKBACK = 90;

function formatDaysWithoutSales(days: number | null | undefined): string {
  if (days == null) return `≥${DAYS_WITHOUT_SALES_LOOKBACK}d sem vendas`;
  if (days === 0) return "0 dias sem vendas";
  if (days === 1) return "1 dia sem vendas";
  return `${days} dias sem vendas`;
}

function formatSendBy(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function rowKey(item: FullOverviewItem): string {
  // Agrupamento por SKU no backend: chave estável para seleção/envio.
  const sku = item.sku?.trim();
  if (sku) return `sku:${sku}`;
  return item.productId ?? item.mlItemId ?? item.sku;
}

export default function GestaoFull() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: accountsData, isLoading: accountsLoading } = useListAccounts();

  const mlAccounts = useMemo(
    () =>
      (accountsData?.data ?? []).filter(
        (a) => (a.platform ?? "mercadolivre") === "mercadolivre" && a.isActive !== false,
      ),
    [accountsData],
  );

  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [registerOpen, setRegisterOpen] = useState(false);
  const [inboundsOpen, setInboundsOpen] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(todayYmd);
  const [inboundNotes, setInboundNotes] = useState("");
  const [draftLines, setDraftLines] = useState<InboundDraftLine[]>([]);

  useEffect(() => {
    if (!accountId && mlAccounts.length > 0) {
      setAccountId(mlAccounts[0]!.id);
    }
  }, [accountId, mlAccounts]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const overviewParams: GetFullOverviewParams = {
    account_id: accountId,
    status: toOverviewStatus(status),
    search: searchDebounced || undefined,
    period_days: toPeriodDays(periodDays),
  };

  const {
    data: overview,
    isLoading: overviewLoading,
    isFetching,
    isError: overviewError,
    error: overviewErrorDetail,
    refetch: refetchOverview,
  } = useGetFullOverview(overviewParams, {
    query: {
      queryKey: getGetFullOverviewQueryKey(overviewParams),
      enabled: Boolean(accountId),
      refetchInterval: 60_000,
    },
  });

  const settingsParams = { account_id: accountId };
  const { data: settings } = useGetFullSettings(settingsParams, {
    query: {
      queryKey: getGetFullSettingsQueryKey(settingsParams),
      enabled: Boolean(accountId) && settingsOpen,
    },
  });

  const syncMutation = useSyncFullStock();
  const updateSettings = useUpdateFullSettings();
  const runAlerts = useRunFullAlerts();
  const createInbound = useCreateFullInbound();
  const receiveInbound = useReceiveFullInbound();
  const cancelInbound = useCancelFullInbound();

  const inboundsParams = { account_id: accountId };
  const { data: inboundsData, isLoading: inboundsLoading } = useListFullInbounds(
    inboundsParams,
    {
      query: {
        queryKey: getListFullInboundsQueryKey(inboundsParams),
        enabled: Boolean(accountId) && inboundsOpen,
      },
    },
  );

  const [draftCoverage, setDraftCoverage] = useState(FULL_RECOMMENDED.coverageTargetDays);
  const [draftLead, setDraftLead] = useState(FULL_RECOMMENDED.leadTimeDays);
  const [draftPeriod, setDraftPeriod] = useState(FULL_RECOMMENDED.salesPeriodDays);
  const [draftPhone, setDraftPhone] = useState("");
  const [draftAlertsEnabled, setDraftAlertsEnabled] = useState(false);
  const [draftAlertRuptura, setDraftAlertRuptura] = useState(FULL_RECOMMENDED.alertRuptura);
  const [draftAlertCritico, setDraftAlertCritico] = useState(FULL_RECOMMENDED.alertCritico);
  const [draftAlertParado, setDraftAlertParado] = useState(FULL_RECOMMENDED.alertParado);
  const [draftAlertQuestions, setDraftAlertQuestions] = useState(FULL_RECOMMENDED.alertQuestions);

  useEffect(() => {
    if (!settings) return;
    setDraftCoverage(settings.coverageTargetDays);
    setDraftLead(settings.leadTimeDays);
    setDraftPeriod(settings.salesPeriodDays);
    setDraftPhone(settings.whatsappPhone ?? "");
    setDraftAlertsEnabled(settings.alertsEnabled);
    setDraftAlertRuptura(settings.alertRuptura);
    setDraftAlertCritico(settings.alertCritico);
    setDraftAlertParado(settings.alertParado);
    setDraftAlertQuestions(settings.alertQuestions ?? true);
    setPeriodDays(settings.salesPeriodDays);
  }, [settings]);

  useEffect(() => {
    if (overview?.settings && !settingsOpen) {
      setPeriodDays(overview.settings.salesPeriodDays);
    }
  }, [overview?.settings, settingsOpen]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetFullOverviewQueryKey(overviewParams) });
    void queryClient.invalidateQueries({
      queryKey: getGetFullSettingsQueryKey({ account_id: accountId }),
    });
    void queryClient.invalidateQueries({
      queryKey: getListFullInboundsQueryKey({ account_id: accountId }),
    });
  }, [queryClient, overviewParams, accountId]);

  const onSync = async () => {
    if (!accountId) return;
    try {
      const result = await syncMutation.mutateAsync({ data: { accountId } });
      toast({
        title: "Estoque Full sincronizado",
        description: `${result.synced} ok · ${result.failed} falha(s) · ${result.skipped} ignorado(s)`,
      });
      invalidate();
    } catch {
      toast({
        variant: "destructive",
        title: "Falha ao sincronizar",
        description: "Não foi possível atualizar o estoque Full no ML.",
      });
    }
  };

  const onSaveSettings = async () => {
    if (!accountId) return;
    try {
      await updateSettings.mutateAsync({
        data: {
          accountId,
          coverageTargetDays: draftCoverage,
          leadTimeDays: draftLead,
          salesPeriodDays: toPeriodDays(draftPeriod),
          whatsappPhone: draftPhone.trim() || null,
          alertsEnabled: draftAlertsEnabled,
          alertRuptura: draftAlertRuptura,
          alertCritico: draftAlertCritico,
          alertParado: draftAlertParado,
          alertQuestions: draftAlertQuestions,
        },
      });
      setPeriodDays(draftPeriod);
      toast({ title: "Configurações salvas" });
      setSettingsOpen(false);
      invalidate();
    } catch {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: "Verifique os valores e tente novamente.",
      });
    }
  };

  const onRunAlerts = async () => {
    try {
      const result = await runAlerts.mutateAsync();
      if (result.accounts === 0) {
        toast({
          variant: "destructive",
          title: "Nenhuma conta elegível",
          description:
            "Ative Alertas WhatsApp, salve um telefone (DDI+DDD+número) e confira N8N_FULL_ALERTS_WEBHOOK_URL.",
        });
        return;
      }
      if (result.alertsSent === 0) {
        toast({
          title: "Nenhum alerta enviado",
          description: `${result.accounts} conta(s) ok, mas sem SKU ruptura/crítico/parado elegível (ou em cooldown 24h). O N8N não foi chamado.`,
        });
        return;
      }
      toast({
        title: "Alertas disparados",
        description: `${result.alertsSent} alerta(s) em ${result.accounts} conta(s) → webhook N8N`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Falha nos alertas",
        description: "Confira N8N_FULL_ALERTS_WEBHOOK_URL e o telefone nas configurações.",
      });
    }
  };

  const applyRecommendedSettings = () => {
    setDraftCoverage(FULL_RECOMMENDED.coverageTargetDays);
    setDraftLead(FULL_RECOMMENDED.leadTimeDays);
    setDraftPeriod(FULL_RECOMMENDED.salesPeriodDays);
    setDraftAlertRuptura(FULL_RECOMMENDED.alertRuptura);
    setDraftAlertCritico(FULL_RECOMMENDED.alertCritico);
    setDraftAlertParado(FULL_RECOMMENDED.alertParado);
    setDraftAlertQuestions(FULL_RECOMMENDED.alertQuestions);
    toast({
      title: "Critérios recomendados aplicados",
      description: "Meta 25d · Lead 12d · Período 15d · Zap: ruptura+crítico+perguntas. Salve para gravar.",
    });
  };

  const items = overview?.items ?? [];
  const kpis = overview?.kpis;
  const totalFull = overview?.totalFullListings ?? items.length;

  const toggleRow = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedSuggested = useMemo(() => {
    let qty = 0;
    for (const it of items) {
      if (selectedKeys.has(rowKey(it))) qty += it.suggestedQty;
    }
    return qty;
  }, [items, selectedKeys]);

  const openRegisterDialog = () => {
    const lines: InboundDraftLine[] = [];
    for (const it of items) {
      const key = rowKey(it);
      if (!selectedKeys.has(key)) continue;
      lines.push({
        key,
        sku: it.sku,
        title: it.title,
        productId: it.productId ?? null,
        mlItemId: it.mlItemId ?? null,
        quantity: Math.max(1, it.suggestedQty || 1),
      });
    }
    if (lines.length === 0) {
      toast({
        variant: "destructive",
        title: "Nada selecionado",
        description: "Selecione anúncios na lista para registrar o envio.",
      });
      return;
    }
    setDraftLines(lines);
    setScheduledDate(todayYmd());
    setInboundNotes("");
    setRegisterOpen(true);
  };

  const onCreateInbound = async () => {
    if (!accountId) return;
    try {
      await createInbound.mutateAsync({
        data: {
          accountId,
          scheduledDate,
          notes: inboundNotes.trim() || null,
          items: draftLines.map((l) => ({
            sku: l.sku,
            quantity: Math.max(1, Math.round(l.quantity)),
            productId: l.productId,
            mlItemId: l.mlItemId,
          })),
        },
      });
      toast({
        title: "Envio Full registrado",
        description: `${draftLines.length} SKU(s) · WhatsApp silenciado enquanto o inbound estiver aberto.`,
      });
      setRegisterOpen(false);
      setSelectedKeys(new Set());
      invalidate();
    } catch {
      toast({
        variant: "destructive",
        title: "Falha ao registrar",
        description: "Não foi possível salvar o envio Full no iHub.",
      });
    }
  };

  const onReceiveInbound = async (id: string) => {
    try {
      await receiveInbound.mutateAsync({ id });
      toast({ title: "Marcado como recebido", description: "SKU volta a poder alertar no WhatsApp." });
      invalidate();
    } catch {
      toast({
        variant: "destructive",
        title: "Falha",
        description: "Não foi possível marcar como recebido.",
      });
    }
  };

  const onCancelInbound = async (id: string) => {
    try {
      await cancelInbound.mutateAsync({ id });
      toast({ title: "Envio cancelado", description: "SKU volta a poder alertar no WhatsApp." });
      invalidate();
    } catch {
      toast({
        variant: "destructive",
        title: "Falha",
        description: "Não foi possível cancelar o envio.",
      });
    }
  };

  const openInbounds = inboundsData?.data?.filter(
    (s) => s.status === "planned" || s.status === "in_transit",
  ) ?? [];
  const recentInbounds = inboundsData?.data ?? [];

  if (accountsLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Carregando contas…
      </div>
    );
  }

  if (mlAccounts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Boxes className="w-10 h-10 text-muted-foreground" />
        <h1 className="text-base font-bold text-foreground">Gestão Full</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Conecte uma conta Mercado Livre em Integrações para gerenciar estoque Full.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border flex-shrink-0 px-3 py-3 sm:px-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-base font-bold text-foreground">Gestão Full</h1>
            <p className="text-muted-foreground text-xs leading-snug">
              Evite ruptura e estoque parado: cobertura em dias, quanto enviar e alertas no WhatsApp.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="w-3.5 h-3.5 mr-1.5" />
              Configurar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setInboundsOpen(true)}
              disabled={!accountId}
            >
              <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
              Envios
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => void onRunAlerts()}
              disabled={runAlerts.isPending}
            >
              {runAlerts.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
              )}
              Testar alertas
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={() => void onSync()}
              disabled={!accountId || syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              )}
              Sync estoque
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Conta ML</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Selecione a conta" />
              </SelectTrigger>
              <SelectContent>
                {mlAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.mlNickname ?? a.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Período de vendas</Label>
            <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[7, 15, 30, 60].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} dias
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ruptura">Ruptura</SelectItem>
                <SelectItem value="critico">Crítico</SelectItem>
                <SelectItem value="parado">Parado</SelectItem>
                <SelectItem value="saudavel">Saudável</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-9 w-full text-sm"
                placeholder="SKU, título ou MLB…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <KpiCard label="Ruptura" value={kpis?.rupturaCount ?? 0} icon={PackageX} tone="red" />
          <KpiCard label="Crítico" value={kpis?.criticoCount ?? 0} icon={AlertTriangle} tone="amber" />
          <KpiCard label="Parado" value={kpis?.paradoCount ?? 0} icon={PauseCircle} tone="slate" />
          <KpiCard
            label="Cobertura média"
            value={kpis?.avgCoverageDays != null ? `${kpis.avgCoverageDays.toFixed(1)}d` : "—"}
            icon={CheckCircle2}
            tone="emerald"
          />
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            {overviewLoading ? (
              "Carregando…"
            ) : (
              <>
                <span className="font-medium text-foreground">{items.length}</span>{" "}
                item(ns) de estoque
                {totalFull > 0 && items.length !== totalFull ? (
                  <span> de {totalFull}</span>
                ) : null}
                {overview?.settings ? (
                  <span>
                    {" "}
                    · Meta {overview.settings.coverageTargetDays}d · Lead{" "}
                    {overview.settings.leadTimeDays}d
                  </span>
                ) : null}
                {isFetching && !overviewLoading ? (
                  <Loader2 className="inline w-3 h-3 ml-1.5 animate-spin" />
                ) : null}
              </>
            )}
          </p>
          {selectedKeys.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={openRegisterDialog}>
                <Truck className="w-3.5 h-3.5 mr-1" />
                Registrar envio Full
              </Button>
              <button
                type="button"
                className="text-primary hover:underline text-xs"
                onClick={() => setSelectedKeys(new Set())}
              >
                Limpar seleção ({selectedKeys.size} · enviar {selectedSuggested} un.)
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:px-4">
        {overviewLoading || (isFetching && items.length === 0 && !overviewError) ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Calculando cobertura…
          </div>
        ) : overviewError ? (
          <div className="py-8 space-y-3 max-w-lg">
            <p className="text-sm text-destructive font-medium">
              Não foi possível carregar a Gestão Full.
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              O sync de estoque pode ter funcionado, mas o painel falhou ao montar a lista. Confira se
              as migrations Full (018 inbound) foram aplicadas no banco.
              {overviewErrorDetail instanceof Error && overviewErrorDetail.message
                ? ` Detalhe: ${overviewErrorDetail.message}`
                : null}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void refetchOverview()}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Tentar de novo
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8">
            Nenhum anúncio Full encontrado. Sincronize a conta em Integrações (não só “Sync estoque”)
            e confira se os anúncios estão com logística Full no Mercado Livre.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((it) => {
              const key = rowKey(it);
              const selected = selectedKeys.has(key);
              return (
                <FullListingCard
                  key={key}
                  item={it}
                  selected={selected}
                  onToggle={() => toggleRow(key)}
                />
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configuração Gestão Full</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 space-y-2">
              <p className="text-[11px] text-muted-foreground leading-snug">
                Recomendado para lead ~9d (compra+prep+agenda+trânsito) com folga: meta{" "}
                {FULL_RECOMMENDED.coverageTargetDays}d, lead {FULL_RECOMMENDED.leadTimeDays}d,
                vendas {FULL_RECOMMENDED.salesPeriodDays}d. Após 1–2 semanas: suba meta para 30 se
                ainda romper; baixe para 20–22 se sobrar estoque parado.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={applyRecommendedSettings}
              >
                Aplicar recomendado
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Meta de cobertura (dias)</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={draftCoverage}
                  onChange={(e) => setDraftCoverage(Number(e.target.value))}
                />
                <p className="text-[11px] text-muted-foreground">
                  Estoque alvo no CD. Qtd sugerida = meta × vendas/dia − estoque.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Lead time (dias)</Label>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={draftLead}
                  onChange={(e) => setDraftLead(Number(e.target.value))}
                />
                <p className="text-[11px] text-muted-foreground">
                  Até ficar vendável no Full (inclui agenda). Crítico se cobertura &lt; lead.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Período de vendas padrão</Label>
              <Select
                value={String(draftPeriod)}
                onValueChange={(v) => setDraftPeriod(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[7, 15, 30, 60].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} dias
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                15d equilibra promoção/sazonalidade; 7d é mais reativo, 30d mais lento.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp (DDI+DDD+número)</Label>
              <Input
                placeholder="5511999999999"
                value={draftPhone}
                onChange={(e) => setDraftPhone(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Alertas via N8N + Evolution API (Full e Perguntas). Credenciais ficam no N8N.
                Cooldown 24h por SKU+tipo (perguntas: até 6h).
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draftAlertsEnabled}
                onChange={(e) => setDraftAlertsEnabled(e.target.checked)}
              />
              Alertas WhatsApp ativos (Gestão Full)
            </label>
            <div className="flex flex-wrap gap-4 text-sm pl-1">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draftAlertRuptura}
                  onChange={(e) => setDraftAlertRuptura(e.target.checked)}
                />
                Ruptura
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draftAlertCritico}
                  onChange={(e) => setDraftAlertCritico(e.target.checked)}
                />
                Crítico
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draftAlertParado}
                  onChange={(e) => setDraftAlertParado(e.target.checked)}
                />
                Parado
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draftAlertQuestions}
                onChange={(e) => setDraftAlertQuestions(e.target.checked)}
              />
              Notificar novas perguntas no WhatsApp
            </label>
            <p className="text-[11px] text-muted-foreground leading-snug">
              No Zap, prefira só Ruptura + Crítico. Parado polui; revise-o na lista da Gestão Full.
              Perguntas usam o mesmo número e o mesmo workflow N8N.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void onSaveSettings()} disabled={updateSettings.isPending}>
              {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar envio Full</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground leading-snug">
            Espelha no iHub o envio que você criou no Seller Center (data + SKUs). Enquanto o
            inbound estiver aberto, esses SKUs não disparam alerta WhatsApp e entram como em
            trânsito na sugestão de envio.
          </p>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Data de agendamento</Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Input
                value={inboundNotes}
                onChange={(e) => setInboundNotes(e.target.value)}
                placeholder="Ex.: coleta ML, NF…"
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>Itens</Label>
              {draftLines.map((line) => (
                <div
                  key={line.key}
                  className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-mono text-muted-foreground truncate">{line.sku}</p>
                    <p className="text-xs text-foreground line-clamp-1">{line.title}</p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 w-20 text-sm"
                    value={line.quantity}
                    onChange={(e) => {
                      const n = Math.max(1, Number(e.target.value) || 1);
                      setDraftLines((prev) =>
                        prev.map((l) => (l.key === line.key ? { ...l, quantity: n } : l)),
                      );
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void onCreateInbound()}
              disabled={createInbound.isPending || draftLines.length === 0}
            >
              {createInbound.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inboundsOpen} onOpenChange={setInboundsOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Envios Full registrados</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {openInbounds.length} aberto(s). Marque recebido quando o CD disponibilizar o estoque.
          </p>
          {inboundsLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando…
            </div>
          ) : recentInbounds.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhum envio registrado. Selecione anúncios e use “Registrar envio Full”.
            </p>
          ) : (
            <div className="space-y-2 py-1">
              {recentInbounds.map((ship: FullInboundShipment) => {
                const open = ship.status === "planned" || ship.status === "in_transit";
                const totalQty = ship.items.reduce((s, it) => s + it.quantity, 0);
                return (
                  <div
                    key={ship.id}
                    className="rounded-lg border border-border px-3 py-2.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {formatSendBy(ship.scheduledDate)} · {ship.items.length} SKU · {totalQty}{" "}
                          un.
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {ship.status}
                          {ship.notes ? ` · ${ship.notes}` : ""}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                          {ship.items.map((it) => `${it.sku}×${it.quantityRemaining}`).join(" · ")}
                        </p>
                      </div>
                      {open ? (
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs"
                            disabled={receiveInbound.isPending}
                            onClick={() => void onReceiveInbound(ship.id)}
                          >
                            Recebido
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground"
                            disabled={cancelInbound.isPending}
                            onClick={() => void onCancelInbound(ship.id)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInboundsOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FullListingCard({
  item,
  selected,
  onToggle,
}: {
  item: FullOverviewItem;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "text-left rounded-xl border bg-card px-3 py-2.5 transition-colors",
        selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/40",
      )}
    >
      <div className="flex items-start gap-3 sm:items-center">
        <button
          type="button"
          onClick={onToggle}
          className="relative shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-pressed={selected}
          aria-label={selected ? `Remover ${item.sku} da lista` : `Incluir ${item.sku} na lista`}
        >
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt=""
              className="size-12 rounded-lg object-cover border border-border bg-muted sm:size-11"
            />
          ) : (
            <div className="size-12 rounded-lg border border-border bg-muted flex items-center justify-center sm:size-11">
              <Package className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
          <span
            className={cn(
              "absolute -top-1.5 -left-1.5 size-4 rounded border bg-background flex items-center justify-center",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
            )}
          >
            {selected ? (
              <span className="text-[9px] font-bold leading-none">✓</span>
            ) : null}
          </span>
        </button>

        <div className="min-w-0 flex-1 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-mono text-muted-foreground truncate">{item.sku}</p>
            <p className="text-sm font-medium text-foreground line-clamp-1 leading-tight">{item.title}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              {item.mlItemId && item.mlItemId !== item.sku ? (
                <p className="text-[10px] text-muted-foreground truncate">{item.mlItemId}</p>
              ) : null}
              {(item.listingCount ?? 1) > 1 ? (
                <span className="text-[10px] text-muted-foreground">
                  · {item.listingCount} anúncios (mesmo estoque)
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs sm:shrink-0">
            <span className={cn("font-bold tabular-nums", stockColorClass(item.stockFull))}>
              {item.stockFull} un.
            </span>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                statusBadgeClass(item.status),
              )}
            >
              {STATUS_LABEL[item.status]}
            </span>
            {item.inTransitQty > 0 ? (
              <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                Em envio · {item.inTransitQty} un.
                {item.inboundScheduledDate
                  ? ` · ${formatSendBy(item.inboundScheduledDate)}`
                  : ""}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
              Cobertura {formatCoverage(item.coverageDays)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground sm:shrink-0 sm:justify-end sm:min-w-[12rem]">
            <span className="tabular-nums">Média {item.salesPerDay.toFixed(2)}/dia</span>
            <span className="tabular-nums">{formatDaysWithoutSales(item.daysWithoutSales)}</span>
            {item.suggestedQty > 0 ? (
              <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
                <Truck className="w-3 h-3" />
                Enviar {item.suggestedQty}
                {item.sendBy ? ` até ${formatSendBy(item.sendBy)}` : ""}
              </span>
            ) : null}
            {item.permalink ? (
              <a
                href={item.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
                ML
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof PackageX;
  tone: "red" | "amber" | "slate" | "emerald";
}) {
  const tones = {
    red: "bg-red-50/80 border-red-100 text-red-700",
    amber: "bg-amber-50/80 border-amber-100 text-amber-800",
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    emerald: "bg-emerald-50/80 border-emerald-100 text-emerald-800",
  };
  return (
    <div className={cn("rounded-lg border px-2.5 py-2", tones[tone])}>
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-80">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className="text-lg font-semibold mt-0.5 tabular-nums leading-tight">{value}</p>
    </div>
  );
}
