import { useState } from "react";
import {
  useGetDashboardSummary,
  useGetSalesChart,
  useGetLowStockProducts,
  useListAccounts,
  useListQuestions,
  useAnswerQuestion,
  getGetDashboardSummaryQueryKey,
  getGetSalesChartQueryKey,
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
  TrendingUp,
  Clock,
  MessageSquare,
  AlertTriangle,
  Plug,
  Send,
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
  todaySales?: number | null;
  todayOrders?: number | null;
  monthSales?: number | null;
  monthOrders?: number | null;
  pendingOrders?: number | null;
  unansweredQuestions?: number | null;
  lowStockCount?: number | null;
  accountsConnected?: number | null;
}

interface Product {
  id: string;
  title?: string | null;
  sku?: string | null;
  availableQuantity?: number | null;
  thumbnailUrl?: string | null;
}

interface ChartPoint {
  date?: string;
  amount?: number | null;
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
      <div className="py-2 px-1 text-xs text-emerald-400 font-medium">
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
        className="flex-1 bg-slate-800 border-slate-700 text-slate-200 text-xs placeholder:text-slate-500 min-h-[60px] resize-none"
        rows={2}
      />
      <Button
        size="sm"
        disabled={!answer.trim() || isPending}
        onClick={() => sendAnswer({ id: q.id, data: { text: answer.trim() } })}
        className="bg-blue-600 hover:bg-blue-500 text-white self-end gap-1"
      >
        <Send className="w-3 h-3" />
        Enviar
      </Button>
    </div>
  );
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
      label: "Vendas hoje",
      value: formatCurrency(s?.todaySales),
      sub: `${s?.todayOrders ?? 0} pedidos`,
      icon: TrendingUp,
      color: "text-blue-400",
    },
    {
      label: "Vendas no mes",
      value: formatCurrency(s?.monthSales),
      sub: `${s?.monthOrders ?? 0} pedidos`,
      icon: TrendingUp,
      color: "text-blue-400",
    },
    {
      label: "Pedidos pendentes",
      value: String(s?.pendingOrders ?? 0),
      sub: "aguardando acao",
      icon: Clock,
      color: "text-amber-400",
      link: "/orders",
    },
    {
      label: "Perguntas sem resposta",
      value: String(s?.unansweredQuestions ?? 0),
      sub: "perguntas abertas",
      icon: MessageSquare,
      color: "text-red-400",
      link: "/questions",
    },
    {
      label: "Produtos em baixo estoque",
      value: String(s?.lowStockCount ?? 0),
      sub: "estoque critico",
      icon: AlertTriangle,
      color: "text-amber-400",
      link: "/products",
    },
    {
      label: "Contas conectadas",
      value: String(s?.accountsConnected ?? 0),
      sub: "Mercado Livre",
      icon: Plug,
      color: "text-emerald-400",
      link: "/integrations",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">Visao geral de todas as suas contas</p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <Select value={accountId ?? "all"} onValueChange={(v) => setAccountId(v === "all" ? undefined : v)}>
              <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-slate-300 text-sm h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all" className="text-slate-300">Todas as contas</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-slate-300">
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
              className="bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <p className="text-slate-400 text-xs font-medium">{kpi.label}</p>
                <Icon className={`w-4 h-4 ${kpi.color} flex-shrink-0`} />
              </div>
              <p className={`text-2xl font-bold ${kpi.color} mb-0.5`}>
                {loadingSummary ? "—" : kpi.value}
              </p>
              <p className="text-slate-500 text-xs">{kpi.sub}</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Evolucao de vendas</h2>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-24 bg-slate-800 border-slate-700 text-slate-300 text-xs h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="7d" className="text-slate-300 text-xs">7 dias</SelectItem>
                <SelectItem value="30d" className="text-slate-300 text-xs">30 dias</SelectItem>
                <SelectItem value="90d" className="text-slate-300 text-xs">90 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartPoints} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => {
                  const d = new Date(v);
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => `R$${v}`}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                labelStyle={{ color: "#94a3b8", fontSize: 11 }}
                itemStyle={{ color: "#60a5fa" }}
                formatter={(v: number) => [formatCurrency(v), "Vendas"]}
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#salesGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Estoque critico</h2>
            <Link to="/products" className="text-blue-400 text-xs hover:text-blue-300">
              Ver todos
            </Link>
          </div>
          {lowStockProducts.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">Nenhum produto em baixo estoque</p>
          ) : (
            <div className="space-y-2">
              {lowStockProducts.map((p) => (
                <Link key={p.id} to={`/products/${p.id}`}>
                  <div className="flex items-center gap-2 py-1.5 hover:bg-slate-800 rounded px-1 transition-colors">
                    {p.thumbnailUrl && (
                      <img
                        src={p.thumbnailUrl}
                        alt=""
                        className="w-8 h-8 rounded object-cover flex-shrink-0 bg-slate-800"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-200 text-xs truncate">{p.title}</p>
                      <p className="text-slate-500 text-[10px]">{p.sku}</p>
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

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-red-400" />
            <h2 className="text-sm font-semibold text-white">Perguntas sem resposta</h2>
          </div>
          <Link to="/questions" className="text-blue-400 text-xs hover:text-blue-300">
            Ver todas
          </Link>
        </div>

        {topQuestions.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-6">Nenhuma pergunta pendente</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {topQuestions.map((q) => (
              <div key={q.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-2 mb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {q.mlItemId && (
                      <p className="text-slate-500 text-[10px] mb-0.5 truncate font-mono">#{q.mlItemId}</p>
                    )}
                    <p className="text-slate-200 text-xs leading-relaxed">{q.text}</p>
                    {q.fromUserNickname && (
                      <p className="text-slate-500 text-[10px] mt-0.5">de {q.fromUserNickname}</p>
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
  );
}
