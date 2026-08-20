import { useEffect, useMemo, useState } from "react";
import {
  useListInventoryMovements,
  getListInventoryMovementsQueryKey,
  InventoryMovementSource,
} from "@workspace/api-client-react";
import type { InventoryMovementItem, InventoryMovementOperation } from "@workspace/api-client-react";
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
import { formatDateTime, cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const REPORT_TZ = "America/Sao_Paulo";
const PAGE_SIZE = 50;

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

const SOURCE_LABELS: Record<InventoryMovementSource, string> = {
  manual: "Inventário",
  product: "Anúncio / produto",
  sale: "Venda",
  cancel: "Cancelamento",
  sync: "Sincronização",
};

function movementLabel(item: InventoryMovementItem): string {
  if (item.source === "manual") {
    const op: Record<InventoryMovementOperation, string> = {
      add: "Somar (Inventário)",
      subtract: "Subtrair (Inventário)",
      set: "Sobrescrever (Inventário)",
      decrement: "Somar (Inventário)",
      increment: "Subtrair (Inventário)",
      sync: "Sobrescrever (Inventário)",
    };
    return op[item.operation] ?? "Inventário";
  }
  return SOURCE_LABELS[item.source] ?? item.source;
}

export default function InventoryMovements({ initialSku = "" }: { initialSku?: string }) {
  const [skuInput, setSkuInput] = useState(initialSku);
  const [preset, setPreset] = useState<PeriodPreset>("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [source, setSource] = useState<"all" | InventoryMovementSource>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setSkuInput(initialSku);
    setPage(1);
  }, [initialSku]);

  const { from: dateFrom, to: dateTo } = useMemo(
    () => computeRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const params = useMemo(
    () => ({
      sku: skuInput.trim() || undefined,
      date_from: dateFrom,
      date_to: dateTo,
      source: source === "all" ? undefined : source,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [skuInput, dateFrom, dateTo, source, page],
  );

  const query = useListInventoryMovements(params, {
    query: { queryKey: getListInventoryMovementsQueryKey(params) },
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground leading-snug">
        O histórico começa a ser gravado a partir desta versão. Movimentações anteriores não podem ser reconstruídas.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="mov-sku" className="text-xs text-muted-foreground">
            SKU
          </Label>
          <Input
            id="mov-sku"
            value={skuInput}
            onChange={(e) => {
              setSkuInput(e.target.value);
              setPage(1);
            }}
            placeholder="Ex.: K12MeiCMe"
            className="h-9 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Período</Label>
          <Select
            value={preset}
            onValueChange={(v) => {
              setPreset(v as PeriodPreset);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last7">Últimos 7 dias</SelectItem>
              <SelectItem value="month_current">Mês atual</SelectItem>
              <SelectItem value="month_previous">Mês anterior</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Origem</Label>
          <Select
            value={source}
            onValueChange={(v) => {
              setSource(v as "all" | InventoryMovementSource);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="manual">Inventário (manual)</SelectItem>
              <SelectItem value="product">Anúncio / produto</SelectItem>
              <SelectItem value="sale">Venda</SelectItem>
              <SelectItem value="cancel">Cancelamento</SelectItem>
              <SelectItem value="sync">Sincronização</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset === "custom" ? (
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
            <div className="space-y-1">
              <Label htmlFor="mov-from" className="text-xs text-muted-foreground">
                De
              </Label>
              <Input
                id="mov-from"
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mov-to" className="text-xs text-muted-foreground">
                Até
              </Label>
              <Input
                id="mov-to"
                type="date"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-sm"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-end">
            <p className="text-[11px] text-muted-foreground pb-2">
              {dateFrom.split("-").reverse().join("/")} — {dateTo.split("-").reverse().join("/")}
            </p>
          </div>
        )}
      </div>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando histórico…
        </div>
      ) : query.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar o histórico. Tente novamente.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6">
          Nenhuma movimentação neste período{skuInput.trim() ? ` para “${skuInput.trim()}”` : ""}.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Anterior</TableHead>
              <TableHead className="text-right">Delta</TableHead>
              <TableHead className="text-right">Posterior</TableHead>
              <TableHead>Pedido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                <TableCell className="text-xs">{movementLabel(row)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{row.quantityBefore}</TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums text-xs font-semibold",
                    row.quantityDelta > 0 && "text-emerald-600",
                    row.quantityDelta < 0 && "text-red-600",
                  )}
                >
                  {row.quantityDelta > 0 ? `+${row.quantityDelta}` : row.quantityDelta}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs font-medium">{row.quantityAfter}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {row.relatedOrderId ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground">
            {total} movimentaç{total === 1 ? "ão" : "ões"} · página {page} de {totalPages}
          </p>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
