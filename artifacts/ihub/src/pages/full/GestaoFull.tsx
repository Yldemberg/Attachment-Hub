import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useListAccounts,
  useGetFullOverview,
  useGetFullSettings,
  useUpdateFullSettings,
  useSyncFullStock,
  useRunFullAlerts,
  getGetFullOverviewQueryKey,
  getGetFullSettingsQueryKey,
  GetFullOverviewStatus,
  GetFullOverviewPeriodDays,
  type FullOverviewItem,
  type FullSkuStatus,
  type GetFullOverviewParams,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Loader2,
  PackageX,
  PauseCircle,
  RefreshCw,
  Search,
  Settings2,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | FullSkuStatus;

const STATUS_LABEL: Record<FullSkuStatus, string> = {
  ruptura: "Ruptura",
  critico: "Crítico",
  saudavel: "Saudável",
  parado: "Parado",
};

function toOverviewStatus(status: StatusFilter): (typeof GetFullOverviewStatus)[keyof typeof GetFullOverviewStatus] {
  if (status === "ruptura") return GetFullOverviewStatus.ruptura;
  if (status === "critico") return GetFullOverviewStatus.critico;
  if (status === "saudavel") return GetFullOverviewStatus.saudavel;
  if (status === "parado") return GetFullOverviewStatus.parado;
  return GetFullOverviewStatus.all;
}

function toPeriodDays(n: number): (typeof GetFullOverviewPeriodDays)[keyof typeof GetFullOverviewPeriodDays] {
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

function formatCoverage(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days >= 100) return `${Math.round(days)}d`;
  return `${days.toFixed(1)}d`;
}

function formatSendBy(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
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
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

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
  } = useGetFullOverview(overviewParams, {
    query: {
      queryKey: getGetFullOverviewQueryKey(overviewParams),
      enabled: Boolean(accountId),
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

  const [draftCoverage, setDraftCoverage] = useState(30);
  const [draftLead, setDraftLead] = useState(5);
  const [draftPeriod, setDraftPeriod] = useState(30);
  const [draftPhone, setDraftPhone] = useState("");
  const [draftAlertsEnabled, setDraftAlertsEnabled] = useState(false);
  const [draftAlertRuptura, setDraftAlertRuptura] = useState(true);
  const [draftAlertCritico, setDraftAlertCritico] = useState(true);
  const [draftAlertParado, setDraftAlertParado] = useState(true);

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
      toast({
        title: "Alertas disparados",
        description: `${result.alertsSent} alerta(s) em ${result.accounts} conta(s)`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Falha nos alertas",
        description: "Confira N8N_FULL_ALERTS_WEBHOOK_URL e o telefone nas configurações.",
      });
    }
  };

  const items = overview?.items ?? [];
  const kpis = overview?.kpis;

  const toggleSku = (sku: string) => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const selectedSuggested = useMemo(() => {
    let qty = 0;
    for (const it of items) {
      if (selectedSkus.has(it.sku)) qty += it.suggestedQty;
    }
    return qty;
  }, [items, selectedSkus]);

  if (accountsLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Carregando contas…
      </div>
    );
  }

  if (mlAccounts.length === 0) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-3">
        <Boxes className="w-10 h-10 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">Gestão Full</h1>
        <p className="text-sm text-muted-foreground">
          Conecte uma conta Mercado Livre em Integrações para gerenciar estoque Full.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gestão Full</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Evite ruptura e estoque parado: cobertura em dias, quanto enviar e alertas no WhatsApp.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="w-4 h-4 mr-1.5" />
            Configurar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onRunAlerts()}
            disabled={runAlerts.isPending}
          >
            {runAlerts.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <MessageCircle className="w-4 h-4 mr-1.5" />
            )}
            Testar alertas
          </Button>
          <Button size="sm" onClick={() => void onSync()} disabled={!accountId || syncMutation.isPending}>
            {syncMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1.5" />
            )}
            Sync estoque Full
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:flex-wrap">
        <div className="space-y-1.5 min-w-[200px]">
          <Label className="text-xs text-muted-foreground">Conta ML</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
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
        <div className="space-y-1.5 min-w-[140px]">
          <Label className="text-xs text-muted-foreground">Período de vendas</Label>
          <Select
            value={String(periodDays)}
            onValueChange={(v) => setPeriodDays(Number(v))}
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
        </div>
        <div className="space-y-1.5 min-w-[160px]">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger>
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
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <Label className="text-xs text-muted-foreground">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="SKU, título ou MLB…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Ruptura"
          value={kpis?.rupturaCount ?? 0}
          icon={PackageX}
          tone="red"
        />
        <KpiCard
          label="Crítico"
          value={kpis?.criticoCount ?? 0}
          icon={AlertTriangle}
          tone="amber"
        />
        <KpiCard
          label="Parado"
          value={kpis?.paradoCount ?? 0}
          icon={PauseCircle}
          tone="slate"
        />
        <KpiCard
          label="Cobertura média"
          value={
            kpis?.avgCoverageDays != null ? `${kpis.avgCoverageDays.toFixed(1)}d` : "—"
          }
          icon={CheckCircle2}
          tone="emerald"
        />
      </div>

      {selectedSkus.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <span>
            <strong>{selectedSkus.size}</strong> SKU(s) na lista · sugerido enviar{" "}
            <strong>{selectedSuggested}</strong> un.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setSelectedSkus(new Set())}>
            Limpar
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>SKU / Anúncio</TableHead>
                <TableHead className="text-right">Estoque Full</TableHead>
                <TableHead className="text-right">Vendas/dia</TableHead>
                <TableHead className="text-right">Cobertura</TableHead>
                <TableHead className="text-right">Enviar</TableHead>
                <TableHead>Até</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overviewLoading || (isFetching && items.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Calculando cobertura…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    Nenhum anúncio Full com SKU encontrado. Sincronize a conta e o estoque Full.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((it) => (
                  <FullRow
                    key={it.sku}
                    item={it}
                    selected={selectedSkus.has(it.sku)}
                    onToggle={() => toggleSku(it.sku)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configuração Gestão Full</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp (DDI+DDD+número)</Label>
              <Input
                placeholder="5511999999999"
                value={draftPhone}
                onChange={(e) => setDraftPhone(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Alertas via N8N + Evolution API. Credenciais ficam no N8N.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draftAlertsEnabled}
                onChange={(e) => setDraftAlertsEnabled(e.target.checked)}
              />
              Alertas WhatsApp ativos
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
    <div className={cn("rounded-xl border px-3 py-3", tones[tone])}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide opacity-80">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function FullRow({
  item,
  selected,
  onToggle,
}: {
  item: FullOverviewItem;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <TableRow className={cn(selected && "bg-primary/5")}>
      <TableCell>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Selecionar ${item.sku}`} />
      </TableCell>
      <TableCell>
        <div className="flex items-start gap-2.5 min-w-0 max-w-[280px]">
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt=""
              className="size-9 rounded-md object-cover border border-border flex-shrink-0"
            />
          ) : (
            <div className="size-9 rounded-md bg-muted flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-mono text-muted-foreground truncate">{item.sku}</p>
            <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{item.title}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium">{item.stockFull}</TableCell>
      <TableCell className="text-right tabular-nums">{item.salesPerDay.toFixed(2)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCoverage(item.coverageDays)}</TableCell>
      <TableCell className="text-right tabular-nums font-semibold">
        {item.suggestedQty > 0 ? item.suggestedQty : "—"}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {formatSendBy(item.sendBy)}
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "inline-flex text-[11px] font-medium px-2 py-0.5 rounded-md border",
            statusBadgeClass(item.status),
          )}
        >
          {STATUS_LABEL[item.status]}
        </span>
      </TableCell>
    </TableRow>
  );
}
