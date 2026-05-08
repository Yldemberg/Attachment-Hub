import { useMemo, useState } from "react";
import {
  useListAccounts,
  useGetSalesReport,
  getGetSalesReportQueryKey,
  getGetSalesReportUrl,
  GetSalesReportFormat,
  ApiError,
} from "@workspace/api-client-react";
import type { SalesReportResponse } from "@workspace/api-client-react";
import { getStoredToken } from "@/lib/api-client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { FileSpreadsheet, Loader2, Download } from "lucide-react";

/** Mesmo fuso que pedidos / relatório ML Brasil */
const REPORT_TZ = "America/Sao_Paulo";

function formatYmdSp(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDaysSp(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const anchorUtc = Date.UTC(y, m - 1, d, 15, 0, 0);
  return formatYmdSp(new Date(anchorUtc + deltaDays * 86400000));
}

function calendarPartsSp(): { y: number; m: number } {
  const ymd = formatYmdSp(new Date());
  const [y, m] = ymd.split("-").map(Number);
  return { y, m };
}

function ymdParts(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

type PeriodPreset = "last7" | "month_current" | "month_previous" | "custom";

function computeRange(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const today = formatYmdSp(new Date());
  switch (preset) {
    case "last7":
      return { from: addCalendarDaysSp(today, -6), to: today };
    case "month_current": {
      const { y, m } = calendarPartsSp();
      return { from: ymdParts(y, m, 1), to: today };
    }
    case "month_previous": {
      const { y, m } = calendarPartsSp();
      const firstCurrent = ymdParts(y, m, 1);
      const lastPrev = addCalendarDaysSp(firstCurrent, -1);
      let pm = m - 1;
      let py = y;
      if (pm < 1) {
        pm = 12;
        py--;
      }
      const firstPrev = ymdParts(py, pm, 1);
      return { from: firstPrev, to: lastPrev };
    }
    case "custom": {
      if (customFrom.trim() && customTo.trim()) {
        return customFrom <= customTo
          ? { from: customFrom, to: customTo }
          : { from: customTo, to: customFrom };
      }
      return { from: today, to: today };
    }
    default:
      return { from: addCalendarDaysSp(today, -6), to: today };
  }
}

function formatIsoDatePtBr(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

function filenameFromDisposition(cd: string | null, fallback: string): string {
  if (!cd) return fallback;
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
  const raw = m?.[1]?.trim();
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw.replace(/^"|"$/g, ""));
  } catch {
    return raw.replace(/^"|"$/g, "") || fallback;
  }
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  last7: "Últimos 7 dias",
  month_current: "Mês atual",
  month_previous: "Mês anterior",
  custom: "Personalizado",
};

export default function SalesReport() {
  const { toast } = useToast();
  const [preset, setPreset] = useState<PeriodPreset>("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [accountId, setAccountId] = useState<string | undefined>();
  const [generated, setGenerated] = useState(false);

  const { from: dateFrom, to: dateTo } = useMemo(
    () => computeRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const rangeValid =
    preset !== "custom" ||
    (Boolean(customFrom.trim()) && Boolean(customTo.trim()) && customFrom <= customTo);

  const { data: accountsData } = useListAccounts();
  const accounts =
    (accountsData as { data?: { id: string; mlNickname?: string | null }[] } | null)?.data ?? [];

  const reportParams = {
    date_from: dateFrom,
    date_to: dateTo,
    format: GetSalesReportFormat.json,
    ...(accountId ? { account_id: accountId } : {}),
  };

  const {
    data: rawData,
    isFetching,
    error,
    refetch,
  } = useGetSalesReport(reportParams, {
    query: {
      enabled: generated && rangeValid,
      queryKey: getGetSalesReportQueryKey(reportParams),
    },
  });

  const report =
    rawData && typeof rawData === "object" && !Array.isArray(rawData) && "rows" in rawData
      ? (rawData as SalesReportResponse)
      : null;

  const handleGenerate = () => {
    if (!rangeValid) {
      toast({
        variant: "destructive",
        title: "Período inválido",
        description: "Defina data inicial e final (personalizado) ou escolha outro preset.",
      });
      return;
    }
    setGenerated(true);
    void refetch();
  };

  const download = async (
    fmt:
      | typeof GetSalesReportFormat.csv
      | typeof GetSalesReportFormat.xlsx
      | typeof GetSalesReportFormat.pdf,
  ) => {
    if (!rangeValid) {
      toast({
        variant: "destructive",
        title: "Período inválido",
        description: "Ajuste as datas antes de baixar.",
      });
      return;
    }
    const baseUrl = import.meta.env.VITE_API_URL || "";
    const path = getGetSalesReportUrl({
      date_from: dateFrom,
      date_to: dateTo,
      format: fmt,
      ...(accountId ? { account_id: accountId } : {}),
    });
    const token = getStoredToken();
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          const m =
            j &&
            typeof j === "object" &&
            "error" in j &&
            j.error &&
            typeof j.error === "object" &&
            "message" in j.error
              ? String((j.error as { message?: string }).message)
              : null;
          if (m) msg = m;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const ext = fmt === GetSalesReportFormat.xlsx ? "xlsx" : fmt === GetSalesReportFormat.pdf ? "pdf" : "csv";
      const fallback = `relatorio-vendas_${dateFrom}_${dateTo}.${ext}`;
      const name = filenameFromDisposition(res.headers.get("Content-Disposition"), fallback);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download iniciado", description: name });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Falha no download",
        description: e instanceof Error ? e.message : "Erro desconhecido",
      });
    }
  };

  const statusLabel = (s?: string | null) => {
    if (s === "paid") return "Pago";
    if (s === "confirmed") return "Confirmado";
    return s ?? "—";
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileSpreadsheet className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Relatório de vendas</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Pedidos pagos e confirmados por data de referência (horário de Brasília). Gere a prévia na tela ou
              exporte em CSV, Excel ou PDF.
            </p>
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Período</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {PRESET_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {preset === "custom" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">De</Label>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Até</Label>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
              </>
            )}

            {accounts.length > 0 && (
              <div className="space-y-1.5 min-w-[200px]">
                <Label className="text-xs text-muted-foreground">Conta</Label>
                <Select value={accountId ?? "all"} onValueChange={(v) => setAccountId(v === "all" ? undefined : v)}>
                  <SelectTrigger>
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
              </div>
            )}

            <Button onClick={handleGenerate} disabled={isFetching || !rangeValid} className="gap-2">
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Mostrar na tela
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Intervalo aplicado:{" "}
            <span className="text-foreground font-medium">
              {formatIsoDatePtBr(dateFrom)} — {formatIsoDatePtBr(dateTo)}
            </span>
          </p>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <span className="text-xs text-muted-foreground self-center mr-2">Baixar:</span>
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => download(GetSalesReportFormat.csv)}>
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => download(GetSalesReportFormat.xlsx)}>
              <Download className="w-3.5 h-3.5" />
              Excel (.xlsx)
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => download(GetSalesReportFormat.pdf)}>
              <Download className="w-3.5 h-3.5" />
              PDF
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error instanceof ApiError ? error.message : "Não foi possível carregar o relatório."}
          </div>
        )}

        {generated && !isFetching && report && (
          <div className="bg-card border border-card-border rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Pedidos</p>
                <p className="text-2xl font-bold text-foreground">{report.summary.orderCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Receita total</p>
                <p className="text-2xl font-bold text-amber-600">{formatCurrency(report.summary.revenue)}</p>
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Pedido ML</TableHead>
                    <TableHead className="text-xs">Conta</TableHead>
                    <TableHead className="text-xs text-right">Valor</TableHead>
                    <TableHead className="text-xs">Comprador</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Nenhuma venda neste período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.rows.map((r, i) => (
                      <TableRow key={`${r.mlOrderId}-${r.referenceDate}-${i}`}>
                        <TableCell className="text-xs font-mono">{formatIsoDatePtBr(r.referenceDate)}</TableCell>
                        <TableCell className="text-xs font-mono">{r.mlOrderId ?? "—"}</TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate">{r.accountNickname ?? "—"}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {r.totalAmount != null ? formatCurrency(r.totalAmount) : "—"}
                        </TableCell>
                        <TableCell className="text-xs max-w-[160px] truncate">{r.buyerNickname ?? "—"}</TableCell>
                        <TableCell className="text-xs">{statusLabel(r.status)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {generated && isFetching && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Carregando…
          </div>
        )}
      </div>
    </div>
  );
}
