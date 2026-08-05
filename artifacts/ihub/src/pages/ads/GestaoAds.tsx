import { useMemo, useState } from "react";
import {
  useGetAdsOverview,
  useListAccounts,
  getGetAdsOverviewQueryKey,
  type AdsOverview,
  type AdsCampaignRow,
  type AdsAlertRow,
} from "@workspace/api-client-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Megaphone,
  ExternalLink,
  Eye,
  MousePointerClick,
  Wallet,
  TrendingUp,
  CircleDollarSign,
  Target,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

const ML_TZ = "America/Sao_Paulo";

function todayYmdSp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ML_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentMonthFrom(): string {
  const today = todayYmdSp();
  return `${today.slice(0, 7)}-01`;
}

function formatIsoDatePtBr(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

function formatRoas(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
}

function formatDelta(delta: number | null | undefined): { text: string; className: string } {
  if (delta == null || !Number.isFinite(delta)) {
    return { text: "Sem base ant.", className: "text-muted-foreground" };
  }
  const sign = delta > 0 ? "+" : "";
  const text = `${sign}${delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs ant.`;
  if (delta > 0) return { text, className: "text-emerald-600" };
  if (delta < 0) return { text, className: "text-red-600" };
  return { text: "0% vs ant.", className: "text-muted-foreground" };
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  const map: Record<string, string> = {
    active: "Ativa",
    paused: "Pausada",
    inactive: "Inativa",
  };
  return map[status.toLowerCase()] ?? status;
}

const ALERT_STYLES: Record<string, { card: string; dot: string; label: string }> = {
  spent_no_sales: {
    card: "border-red-200 bg-red-50/80",
    dot: "bg-red-500",
    label: "text-red-800",
  },
  below_target: {
    card: "border-amber-200 bg-amber-50/80",
    dot: "bg-amber-500",
    label: "text-amber-900",
  },
  on_track: {
    card: "border-emerald-200 bg-emerald-50/80",
    dot: "bg-emerald-500",
    label: "text-emerald-900",
  },
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
  inactive: "bg-slate-100 text-slate-600 border-slate-200",
};

function statusBadgeClass(status: string | null | undefined): string {
  if (!status) return "bg-slate-100 text-slate-600 border-slate-200";
  return STATUS_COLORS[status.toLowerCase()] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

function monthOptions(): Array<{ key: string; label: string; from: string; to: string }> {
  const today = todayYmdSp();
  const [cy, cm] = today.split("-").map(Number);
  const options: Array<{ key: string; label: string; from: string; to: string }> = [];
  for (let i = 0; i < 6; i++) {
    let m = cm - i;
    let y = cy;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const endOfMonth =
      i === 0
        ? today
        : `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
      new Date(y, m - 1, 1),
    );
    const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
    options.push({
      key: from,
      label: i === 0 ? `${capitalized} (atual)` : capitalized,
      from,
      to: endOfMonth,
    });
  }
  return options;
}

function AlertCards({ alerts, loading }: { alerts: AdsAlertRow[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-muted/30 h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {alerts.map((alert) => {
        const style = ALERT_STYLES[alert.id] ?? ALERT_STYLES.on_track;
        return (
          <div key={alert.id} className={`rounded-xl border p-3.5 ${style.card}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`size-2.5 rounded-full shrink-0 ${style.dot}`} />
              <p className={`text-sm font-semibold leading-tight ${style.label}`}>{alert.label}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <p className="text-muted-foreground">Qtd</p>
                <p className="font-semibold text-foreground tabular-nums text-sm">{alert.quantity}</p>
              </div>
              <div>
                <p className="text-muted-foreground">% do custo</p>
                <p className="font-semibold text-foreground tabular-nums text-sm">
                  {alert.costSharePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Custo</p>
                <p className="font-semibold text-foreground tabular-nums text-sm">
                  {formatCurrency(alert.cost)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Faturamento</p>
                <p className="font-semibold text-foreground tabular-nums text-sm">
                  {formatCurrency(alert.revenue)}
                </p>
              </div>
              <div className="col-span-2 pt-1 border-t border-black/5">
                <p className="text-muted-foreground">ROAS</p>
                <p className="font-bold text-foreground tabular-nums text-base">
                  {formatRoas(alert.roas)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function GestaoAds() {
  const months = useMemo(() => monthOptions(), []);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [periodKey, setPeriodKey] = useState(months[0]?.key ?? currentMonthFrom());

  const selectedPeriod = months.find((m) => m.key === periodKey) ?? months[0];
  const dateFrom = selectedPeriod?.from ?? currentMonthFrom();
  const dateTo = selectedPeriod?.to ?? todayYmdSp();

  const { data: accountsData } = useListAccounts();
  const accounts =
    (accountsData as { data?: Array<{ id: string; mlNickname?: string | null; platform?: string | null }> } | null)
      ?.data ?? [];
  const mlAccounts = accounts.filter((a) => a.platform !== "amazon");

  const params = {
    date_from: dateFrom,
    date_to: dateTo,
    ...(accountId ? { account_id: accountId } : {}),
  };

  const { data: overviewRaw, isLoading, isFetching, error } = useGetAdsOverview(params, {
    query: {
      queryKey: getGetAdsOverviewQueryKey(params),
      refetchOnWindowFocus: false,
    },
  });

  const overview = overviewRaw as AdsOverview | undefined;

  const kpiCards = [
    {
      label: "Impressões",
      value: formatNumber(overview?.kpis?.impressions),
      delta: overview?.kpiDeltas?.impressions,
      icon: Eye,
    },
    {
      label: "Cliques",
      value: formatNumber(overview?.kpis?.clicks),
      delta: overview?.kpiDeltas?.clicks,
      icon: MousePointerClick,
    },
    {
      label: "Gasto",
      value: formatCurrency(overview?.kpis?.cost ?? 0),
      delta: overview?.kpiDeltas?.cost,
      icon: Wallet,
    },
    {
      label: "Faturamento Ads",
      value: formatCurrency(overview?.kpis?.revenue ?? 0),
      delta: overview?.kpiDeltas?.revenue,
      icon: TrendingUp,
    },
    {
      label: "CPC",
      value: formatCurrency(overview?.kpis?.cpc ?? 0),
      delta: overview?.kpiDeltas?.cpc,
      icon: CircleDollarSign,
    },
    {
      label: "ROAS",
      value: formatRoas(overview?.kpis?.roas),
      delta: overview?.kpiDeltas?.roas,
      icon: Target,
    },
  ];

  const chartData = useMemo(() => {
    const daily = overview?.daily ?? [];
    const mapped = daily.map((d) => ({
      date: d.date,
      label: formatIsoDatePtBr(d.date).slice(0, 5),
      gasto: d.cost ?? 0,
      faturamento: d.revenue ?? 0,
    }));
    const hasSignal = mapped.some((d) => d.gasto > 0 || d.faturamento > 0);
    return { points: mapped, hasSignal };
  }, [overview?.daily]);

  const campaigns: AdsCampaignRow[] = overview?.campaigns ?? [];
  const alerts: AdsAlertRow[] = overview?.alerts ?? [];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 sm:p-6 space-y-5 max-w-[1400px]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground">Gestão Ads</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Product Ads · {formatIsoDatePtBr(overview?.dateFrom ?? dateFrom)} –{" "}
              {formatIsoDatePtBr(overview?.dateTo ?? dateTo)}
              {isFetching && !isLoading ? " · atualizando…" : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {mlAccounts.length > 0 && (
              <Select
                value={accountId ?? "all"}
                onValueChange={(v) => setAccountId(v === "all" ? undefined : v)}
              >
                <SelectTrigger className="w-[160px] text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as contas</SelectItem>
                  {mlAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.mlNickname ?? a.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={periodKey} onValueChange={setPeriodKey}>
              <SelectTrigger className="w-[180px] text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {overview?.manageUrl && (
              <Button asChild size="sm" className="h-9 gap-1.5">
                <a href={overview.manageUrl} target="_blank" rel="noopener noreferrer">
                  Gerenciar no ML
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Não foi possível carregar o overview de Ads. Tente novamente em instantes.
          </div>
        )}

        {!isLoading && overview && !overview.available && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {overview.message ?? "Conecte uma conta com Product Ads ativo para ver o dashboard."}
          </div>
        )}

        <section>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {kpiCards.map((kpi) => {
              const Icon = kpi.icon;
              const delta = formatDelta(kpi.delta);
              return (
                <div
                  key={kpi.label}
                  className="rounded-xl border border-card-border bg-card px-3.5 py-3 min-w-0"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs text-muted-foreground font-medium truncate">{kpi.label}</p>
                    <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </div>
                  <p className="text-xl font-bold text-foreground tabular-nums leading-none truncate">
                    {isLoading ? "—" : kpi.value}
                  </p>
                  <p className={`text-xs mt-2 font-medium leading-snug ${delta.className}`}>
                    {isLoading ? "—" : delta.text}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Alertas de Performance</h2>
          </div>
          <AlertCards alerts={alerts} loading={isLoading} />
        </section>

        <section className="bg-card border border-card-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Tendência Diária</h2>
          {isLoading ? (
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
              Carregando gráfico…
            </div>
          ) : !chartData.hasSignal ? (
            <div className="h-40 flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground text-center px-4">
              <p>Sem série diária disponível para este período.</p>
              <p className="text-xs">
                Os totais acima vêm das campanhas; a tendência diária depende da API de agregação do ML.
              </p>
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData.points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adsSpend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="adsRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    minTickGap={28}
                  />
                  <YAxis
                    width={48}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) =>
                      Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(1)}k` : String(v)
                    }
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      formatCurrency(value),
                      name === "gasto" ? "Gasto" : "Faturamento",
                    ]}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as { date?: string } | undefined;
                      return formatIsoDatePtBr(row?.date);
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    height={28}
                    formatter={(value) => (value === "gasto" ? "Gasto" : "Faturamento")}
                  />
                  <Area
                    type="monotone"
                    dataKey="gasto"
                    stroke="hsl(var(--primary))"
                    fill="url(#adsSpend)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="faturamento"
                    stroke="#10b981"
                    fill="url(#adsRevenue)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Campanhas</h2>
            <p className="text-xs text-muted-foreground shrink-0">
              {campaigns.length} · ordenadas por gasto
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed min-w-[760px]">
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                  <th className="py-2.5 pl-4 pr-2 font-medium">Campanha</th>
                  <th className="py-2.5 px-2 font-medium">Status</th>
                  <th className="py-2.5 px-2 font-medium text-right">Gasto</th>
                  <th className="py-2.5 px-2 font-medium text-right">Faturamento</th>
                  <th className="py-2.5 px-2 font-medium text-right">ROAS</th>
                  <th className="py-2.5 px-2 font-medium text-right">Cliques</th>
                  <th className="py-2.5 pl-2 pr-4 font-medium text-right">Impr.</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      Carregando campanhas…
                    </td>
                  </tr>
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      Nenhuma campanha com métricas no período.
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => (
                    <tr
                      key={`${c.accountId}-${c.id}`}
                      className="border-t border-border/60 hover:bg-muted/25"
                    >
                      <td className="py-2.5 pl-4 pr-2 min-w-0">
                        <p className="font-medium text-foreground leading-snug truncate" title={c.name}>
                          {c.name}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                          #{c.id}
                        </p>
                      </td>
                      <td className="py-2.5 px-2">
                        {c.status ? (
                          <span
                            className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-md border whitespace-nowrap ${statusBadgeClass(c.status)}`}
                          >
                            {statusLabel(c.status)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(c.cost)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(c.revenue)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums font-medium whitespace-nowrap">
                        {formatRoas(c.roas)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">
                        {formatNumber(c.clicks)}
                      </td>
                      <td className="py-2.5 pl-2 pr-4 text-right tabular-nums whitespace-nowrap">
                        {formatNumber(c.impressions)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
