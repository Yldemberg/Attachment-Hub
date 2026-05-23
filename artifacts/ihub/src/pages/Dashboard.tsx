import { useState } from "react";
import {
  useGetDashboardSummary,
  useGetSalesChart,
  useGetMlExtraCosts,
  useGetLowStockProducts,
  useListAccounts,
  useListQuestions,
  useAnswerQuestion,
  getGetDashboardSummaryQueryKey,
  getGetSalesChartQueryKey,
  getGetMlExtraCostsQueryKey,
  getGetLowStockProductsQueryKey,
  getListQuestionsQueryKey,
  getGetQuestionQueryKey,
  ListQuestionsStatus,
} from "@workspace/api-client-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, stockBgColor } from "@/lib/utils";
import {
  ShoppingCart,
  Clock,
  MessageSquare,
  AlertTriangle,
  Plug,
  Send,
  TrendingUp,
  Receipt,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

type Period = "7d" | "30d" | "90d";

interface DashboardSummaryData {
  salesToday?: number | null;
  salesMonth?: number | null;
  ordersToday?: number | null;
  ordersMonth?: number | null;
  pendingOrders?: number | null;
  unansweredQuestions?: number | null;
  criticalStockCount?: number | null;
  activeAccounts?: number | null;
}

interface Product {
  id: string;
  title?: string | null;
  sku?: string | null;
  availableQuantity?: number | null;
  thumbnail?: string | null;
}

interface ChartPoint {
  date?: string;
  revenue?: number | null;
  orders?: number | null;
}

interface Question {
  id: string;
  text?: string | null;
  mlItemId?: string | null;
  fromUserNickname?: string | null;
  status?: string | null;
}

function QuickReply({ q }: { q: Question }) {
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();

  const { mutate: sendAnswer, isPending } = useAnswerQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuestionsQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getGetQuestionQueryKey(q.id) });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({}) });
        setDone(true);
      },
    },
  });

  if (done) {
    return (
      <div className="py-2 px-1 text-xs text-emerald-600 font-medium">
        Resposta enviada!
      </div>
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Digite sua resposta..."
        className="flex-1 bg-muted border-border text-foreground text-xs placeholder:text-muted-foreground min-h-[60px] resize-none"
        rows={2}
      />
      <Button
        size="sm"
        disabled={!answer.trim() || isPending}
        onClick={() => sendAnswer({ id: q.id, data: { text: answer.trim() } })}
        className="self-end gap-1"
      >
        <Send className="w-3 h-3" />
        Enviar
      </Button>
    </div>
  );
}

interface MlExtraCostsData {
  periodKey?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  productAds?: number;
  fullShipping?: number;
  fullStorage?: number;
  totalExtraCosts?: number;
  available?: boolean;
  message?: string | null;
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

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>("30d");
  const [accountId, setAccountId] = useState<string | undefined>();

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary(
    accountId ? { account_id: accountId } : {},
    { query: { queryKey: getGetDashboardSummaryQueryKey({ account_id: accountId }) } },
  );
  const s = summary as DashboardSummaryData | null;

  const { data: extraCostsRaw, isLoading: loadingExtraCosts } = useGetMlExtraCosts(
    accountId ? { account_id: accountId } : {},
    { query: { queryKey: getGetMlExtraCostsQueryKey({ account_id: accountId }) } },
  );
  const extraCosts = extraCostsRaw as MlExtraCostsData | null;

  const { data: chartData } = useGetSalesChart(
    { period, ...(accountId ? { account_id: accountId } : {}) },
    { query: { queryKey: getGetSalesChartQueryKey({ period, account_id: accountId }) } },
  );
  const chartPoints: ChartPoint[] = (chartData as { data?: ChartPoint[] } | null)?.data ?? [];

  const { data: lowStockData } = useGetLowStockProducts(
    { threshold: 20, ...(accountId ? { account_id: accountId } : {}) },
    { query: { queryKey: getGetLowStockProductsQueryKey({ threshold: 20, account_id: accountId }) } },
  );
  const lowStockProducts: Product[] = (lowStockData as { data?: Product[] } | null)?.data?.slice(0, 8) ?? [];

  const { data: questionsData } = useListQuestions(
    { status: ListQuestionsStatus.unanswered, limit: 3, ...(accountId ? { account_id: accountId } : {}) },
    { query: { queryKey: getListQuestionsQueryKey({ status: ListQuestionsStatus.unanswered, limit: 3, account_id: accountId }) } },
  );
  const topQuestions: Question[] = (questionsData as { data?: Question[] } | null)?.data ?? [];

  const kpis = [
    {
      label: "Pedidos hoje",
      value: String(s?.ordersToday ?? 0),
      sub: s?.salesToday ? `${formatCurrency(s.salesToday)} em vendas` : "nenhuma venda registrada",
      icon: ShoppingCart,
      color: "text-primary",
      valueColor: "text-amber-600",
    },
    {
      label: "Pedidos no mês",
      value: String(s?.ordersMonth ?? 0),
      sub: s?.salesMonth ? `${formatCurrency(s.salesMonth)} em vendas` : "nenhuma venda registrada",
      icon: TrendingUp,
      color: "text-primary",
      valueColor: "text-amber-600",
    },
    {
      label: "Pedidos pendentes",
      value: String(s?.pendingOrders ?? 0),
      sub: "aguardando ação",
      icon: Clock,
      color: "text-amber-600",
      valueColor: "text-amber-600",
      link: "/orders",
    },
    {
      label: "Perguntas sem resposta",
      value: String(s?.unansweredQuestions ?? 0),
      sub: "perguntas abertas",
      icon: MessageSquare,
      color: "text-red-500",
      valueColor: "text-red-600",
      link: "/questions",
    },
    {
      label: "Produtos em baixo estoque",
      value: String(s?.criticalStockCount ?? 0),
      sub: "estoque crítico (< 5 un.)",
      icon: AlertTriangle,
      color: "text-amber-600",
      valueColor: "text-amber-600",
      link: "/products",
    },
    {
      label: "Contas conectadas",
      value: String(s?.activeAccounts ?? 0),
      sub: "Mercado Livre",
      icon: Plug,
      color: "text-emerald-600",
      valueColor: "text-emerald-600",
      link: "/integrations",
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Visão geral de todas as suas contas</p>
          </div>
          <div className="flex items-center gap-2">
            {accounts.length > 0 && (
              <Select value={accountId ?? "all"} onValueChange={(v) => setAccountId(v === "all" ? undefined : v)}>
                <SelectTrigger className="w-44 text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as contas</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.mlNickname ?? a.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            const inner = (
              <div
                key={kpi.label}
                className="bg-card border border-card-border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <p className="text-muted-foreground text-xs font-medium">{kpi.label}</p>
                  <Icon className={`w-4 h-4 ${kpi.color} flex-shrink-0`} />
                </div>
                <p className={`text-2xl font-bold ${kpi.valueColor} mb-0.5`}>
                  {loadingSummary ? "—" : kpi.value}
                </p>
                <p className="text-muted-foreground text-xs">{kpi.sub}</p>
              </div>
            );

            return kpi.link ? (
              <Link key={kpi.label} to={kpi.link}>
                {inner}
              </Link>
            ) : (
              <div key={kpi.label}>{inner}</div>
            );
          })}
        </div>

        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-2">
              <Receipt className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">Custos extras Mercado Livre</h2>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {extraCosts?.periodFrom && extraCosts?.periodTo
                    ? `Período de faturamento: ${formatIsoDatePtBr(extraCosts.periodFrom)} — ${formatIsoDatePtBr(extraCosts.periodTo)}`
                    : "Product Ads e taxas Full (envios e estoque) do último período de faturamento."}
                </p>
              </div>
            </div>
            {extraCosts?.available && extraCosts.totalExtraCosts != null && (
              <div className="text-right flex-shrink-0">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Total</p>
                <p className="text-lg font-bold text-orange-600 tabular-nums">
                  {loadingExtraCosts ? "—" : formatCurrency(extraCosts.totalExtraCosts)}
                </p>
              </div>
            )}
          </div>

          {loadingExtraCosts ? (
            <p className="text-muted-foreground text-sm text-center py-6">Carregando custos…</p>
          ) : !extraCosts?.available ? (
            <p className="text-muted-foreground text-sm text-center py-6">
              {extraCosts?.message ?? "Conecte uma conta do Mercado Livre para ver os custos extras."}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <p className="text-muted-foreground text-xs">Product Ads</p>
                <p className="text-base font-semibold text-foreground tabular-nums mt-1">
                  {formatCurrency(extraCosts.productAds ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <p className="text-muted-foreground text-xs">Full — envios / coleta</p>
                <p className="text-base font-semibold text-foreground tabular-nums mt-1">
                  {formatCurrency(extraCosts.fullShipping ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <p className="text-muted-foreground text-xs">Full — armazenamento</p>
                <p className="text-base font-semibold text-foreground tabular-nums mt-1">
                  {formatCurrency(extraCosts.fullStorage ?? 0)}
                </p>
              </div>
            </div>
          )}

          {extraCosts?.available && extraCosts.message && (
            <p className="text-amber-700 text-xs mt-3">{extraCosts.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">Evolução de vendas</h2>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="w-24 text-xs h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d" className="text-xs">7 dias</SelectItem>
                  <SelectItem value="30d" className="text-xs">30 dias</SelectItem>
                  <SelectItem value="90d" className="text-xs">90 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartPoints} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `R$${v}`}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)" }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  itemStyle={{ color: "hsl(var(--chart-1))" }}
                  formatter={(v: number) => [formatCurrency(v), "Receita"]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  fill="url(#salesGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">Estoque crítico</h2>
              <Link to="/products" className="text-primary text-xs hover:text-primary/80">
                Ver todos
              </Link>
            </div>
            {lowStockProducts.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">Nenhum produto em baixo estoque</p>
            ) : (
              <div className="space-y-2">
                {lowStockProducts.map((p) => (
                  <Link key={p.id} to={`/products/${p.id}`}>
                    <div className="flex items-center gap-2 py-1.5 hover:bg-accent rounded-lg px-1 transition-colors">
                      {p.thumbnail ? (
                        <img
                          src={p.thumbnail}
                          alt=""
                          className="w-8 h-8 rounded object-cover flex-shrink-0 bg-muted"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground text-xs truncate">{p.title}</p>
                        <p className="text-muted-foreground text-[10px]">{p.sku}</p>
                      </div>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${stockBgColor(p.availableQuantity)}`}>
                        {p.availableQuantity ?? 0}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-red-500" />
              <h2 className="text-sm font-semibold text-foreground">Perguntas sem resposta</h2>
            </div>
            <Link to="/questions" className="text-primary text-xs hover:text-primary/80">
              Ver todas
            </Link>
          </div>

          {topQuestions.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Nenhuma pergunta pendente</p>
          ) : (
            <div className="divide-y divide-border">
              {topQuestions.map((q) => (
                <div key={q.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-2 mb-1">
                    <MessageSquare className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      {q.mlItemId && (
                        <p className="text-muted-foreground text-[10px] mb-0.5 truncate font-mono">#{q.mlItemId}</p>
                      )}
                      <p className="text-foreground text-xs leading-relaxed">{q.text}</p>
                      {q.fromUserNickname && (
                        <p className="text-muted-foreground text-[10px] mt-0.5">de {q.fromUserNickname}</p>
                      )}
                    </div>
                  </div>
                  <QuickReply q={q} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
