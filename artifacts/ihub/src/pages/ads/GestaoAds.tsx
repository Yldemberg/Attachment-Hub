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
    return { text: "—", className: "text-muted-foreground" };
  }
  const sign = delta > 0 ? "+" : "";
  const text = `${sign}${delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (delta > 0) return { text, className: "text-emerald-600" };
  if (delta < 0) return { text, className: "text-red-600" };
  return { text, className: "text-muted-foreground" };
}

const ALERT_STYLES: Record<
  string,
  { row: string; dot: string }
> = {
  spent_no_sales: {
    row: "bg-red-50/70",
    dot: "bg-red-500",
  },
  below_target: {
    row: "bg-amber-50/70",
    dot: "bg-amber-500",
  },
  on_track: {
    row: "bg-emerald-50/70",
    dot: "bg-emerald-500",
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

  const chartData =
    overview?.daily?.map((d) => ({
      date: d.date,
      label: formatIsoDatePtBr(d.date).slice(0, 5),
      gasto: d.cost,
      faturamento: d.revenue,
    })) ?? [];

  const campaigns: AdsCampaignRow[] = overview?.campaigns ?? [];
  const alerts: AdsAlertRow[] = overview?.alerts ?? [];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Gestão Ads</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Product Ads do Mercado Livre — campanhas, custo e ROAS do período
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mlAccounts.length > 0 && (
              <Select
                value={accountId ?? "all"}
                onValueChange={(v) => setAccountId(v === "all" ? undefined : v)}
              >
                <SelectTrigger className="w-44 text-sm h-8">
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
              <SelectTrigger className="w-48 text-sm h-8">
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
              <Button asChild size="sm" className="h-8 gap-1.5">
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

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Megaphone className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Alertas de Performance</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="py-2 pr-2 font-medium">Status</th>
                    <th className="py-2 px-2 font-medium text-right">Qtd</th>
                    <th className="py-2 px-2 font-medium text-right">% Custo</th>
                    <th className="py-2 px-2 font-medium text-right">Custo</th>
                    <th className="py-2 px-2 font-medium text-right">Faturamento</th>
                    <th className="py-2 pl-2 font-medium text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/60">
                          <td className="py-2.5 text-muted-foreground" colSpan={6}>
                            Carregando…
                          </td>
                        </tr>
                      ))
                    : alerts.map((alert) => {
                        const style = ALERT_STYLES[alert.id] ?? ALERT_STYLES.on_track;
                        return (
                          <tr key={alert.id} className={`${style.row} border-b border-border/40`}>
                            <td className="py-2.5 pr-2">
                              <div className="flex items-center gap-2">
                                <span className={`size-2 rounded-full ${style.dot}`} />
                                <span className="font-medium text-foreground">{alert.label}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-right tabular-nums">{alert.quantity}</td>
                            <td className="py-2.5 px-2 text-right tabular-nums">
                              {alert.costSharePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                            </td>
                            <td className="py-2.5 px-2 text-right tabular-nums">
                              {formatCurrency(alert.cost)}
                            </td>
                            <td className="py-2.5 px-2 text-right tabular-nums">
                              {formatCurrency(alert.revenue)}
                            </td>
                            <td className="py-2.5 pl-2 text-right tabular-nums font-medium">
                              {formatRoas(alert.roas)}
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">Métricas do Período</h2>
              <p className="text-[11px] text-muted-foreground">
                {formatIsoDatePtBr(overview?.dateFrom ?? dateFrom)} –{" "}
                {formatIsoDatePtBr(overview?.dateTo ?? dateTo)}
                {isFetching && !isLoading ? " · atualizando…" : ""}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {kpiCards.map((kpi) => {
                const Icon = kpi.icon;
                const delta = formatDelta(kpi.delta);
                return (
                  <div
                    key={kpi.label}
                    className="rounded-lg border border-border/80 bg-muted/20 px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] text-muted-foreground font-medium">{kpi.label}</p>
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-lg font-bold text-foreground tabular-nums leading-tight">
                      {isLoading ? "—" : kpi.value}
                    </p>
                    <p className={`text-[11px] mt-0.5 font-medium ${delta.className}`}>
                      {isLoading ? "—" : delta.text}
                      <span className="text-muted-foreground font-normal"> vs ant.</span>
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="bg-card border border-card-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Tendência Diária</h2>
          {isLoading ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
              Carregando gráfico…
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
              Sem dados diários no período.
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    tickFormatter={(v) =>
                      Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : String(v)
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

        <section className="bg-card border border-card-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Campanhas</h2>
            <p className="text-[11px] text-muted-foreground">
              {campaigns.length} campanha{campaigns.length === 1 ? "" : "s"} · ordenadas por gasto
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium">Campanha</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  <th className="py-2 px-2 font-medium text-right">Gasto</th>
                  <th className="py-2 px-2 font-medium text-right">Faturamento</th>
                  <th className="py-2 px-2 font-medium text-right">ROAS</th>
                  <th className="py-2 px-2 font-medium text-right">Cliques</th>
                  <th className="py-2 pl-2 font-medium text-right">Impressões</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      Carregando campanhas…
                    </td>
                  </tr>
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      Nenhuma campanha com métricas no período.
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => (
                    <tr key={`${c.accountId}-${c.id}`} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-foreground leading-snug">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{c.id}</p>
                      </td>
                      <td className="py-2.5 px-2">
                        {c.status ? (
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${statusBadgeClass(c.status)}`}
                          >
                            {c.status}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{formatCurrency(c.cost)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{formatCurrency(c.revenue)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums font-medium">{formatRoas(c.roas)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{formatNumber(c.clicks)}</td>
                      <td className="py-2.5 pl-2 text-right tabular-nums">{formatNumber(c.impressions)}</td>
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
