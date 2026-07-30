import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export interface SalesReportExportRow {
  referenceDate: string;
  mlOrderId: string;
  accountNickname: string | null;
  /** Clássico / Premium. */
  listingTypeLabel: string | null;
  sku: string | null;
  titleShort: string | null;
  /** Full / Flex / Coleta / Padrão… */
  logisticLabel: string | null;
  /** Total do pedido (ML total_amount). */
  orderTotal: number | null;
  /** Soma (preço de compra × qtd) por SKU nos custos salvos no inventário. */
  productPurchaseTotal: number;
  /** Soma marketplace_fee dos pagamentos (última sync). */
  marketplaceFeesTotal: number;
  /** Frete / custo operacional (shipping_cost dos pagamentos). */
  shippingTotal: number;
  /** Imposto estimado: soma (subtotal da linha × % do SKU). */
  taxTotal: number;
  /** Soma de transaction_details.net_received_amount (Mercado Pago) por pagamento. */
  netReceivedAmount: number | null;
  /** Taxa de Product Ads do pedido, quando disponível. */
  adsFee: number | null;
  /**
   * Margem de contribuição: A receber − imposto − preço de compra (− ads).
   */
  profit: number | null;
}

export interface SalesReportSummary {
  orderCount: number;
  revenue: number;
}

/** Cabeçalhos abreviados (tela + CSV/XLSX/PDF). */
export const CSV_HEADERS = [
  "Data",
  "Conta",
  "Nº Pedido",
  "Tipo",
  "SKU",
  "Título",
  "Logística",
  "Tot. Venda",
  "P. Compra",
  "Frete/Op.",
  "Imposto",
  "A Receber",
  "Ads",
  "$ Mg Cont",
] as const;

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

function rowCells(r: SalesReportExportRow): (string | number | null)[] {
  return [
    r.referenceDate,
    r.accountNickname ?? "",
    r.mlOrderId,
    r.listingTypeLabel ?? "",
    r.sku ?? "",
    r.titleShort ?? "",
    r.logisticLabel ?? "",
    fmtMoney(r.orderTotal),
    fmtMoney(r.productPurchaseTotal),
    fmtMoney(r.shippingTotal),
    fmtMoney(r.taxTotal),
    fmtMoney(r.netReceivedAmount),
    fmtMoney(r.adsFee),
    fmtMoney(r.profit),
  ];
}

export function buildSalesReportCsv(
  rows: SalesReportExportRow[],
  _summary: SalesReportSummary,
): string {
  const lines: string[] = [CSV_HEADERS.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(rowCells(r).map((c) => csvEscape(String(c ?? ""))).join(","));
  }
  return "\uFEFF" + lines.join("\n");
}

export async function buildSalesReportXlsx(
  dateFrom: string,
  dateTo: string,
  rows: SalesReportExportRow[],
  summary: SalesReportSummary,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Vendas");
  ws.addRow([`Relatório de vendas — ${dateFrom} a ${dateTo}`]);
  ws.addRow([`Pedidos: ${summary.orderCount} | Receita (total pedidos): ${summary.revenue.toFixed(2)}`]);
  ws.addRow([]);
  ws.addRow([...CSV_HEADERS]);
  for (const r of rows) {
    ws.addRow([
      r.referenceDate,
      r.accountNickname,
      r.mlOrderId,
      r.listingTypeLabel,
      r.sku,
      r.titleShort,
      r.logisticLabel,
      r.orderTotal,
      r.productPurchaseTotal,
      r.shippingTotal,
      r.taxTotal,
      r.netReceivedAmount,
      r.adsFee,
      r.profit,
    ]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildSalesReportPdf(
  dateFrom: string,
  dateTo: string,
  rows: SalesReportExportRow[],
  summary: SalesReportSummary,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 18, size: "A4", layout: "landscape" });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(11).text("Relatório de vendas", { align: "center" });
    doc.fontSize(9).text(`Período: ${dateFrom} a ${dateTo}`, { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(8).text(
      `Pedidos: ${summary.orderCount}   Receita (total pedidos): ${summary.revenue.toFixed(2)}`,
      { align: "center" },
    );
    doc.moveDown(0.4);
    doc.fontSize(5.5);
    doc.text(CSV_HEADERS.join(" | "));
    doc.moveDown(0.12);

    for (const r of rows) {
      if (doc.y > 540) {
        doc.addPage();
        doc.fontSize(5.5);
      }
      const line = [
        r.referenceDate,
        (r.accountNickname ?? "").slice(0, 12),
        r.mlOrderId.slice(0, 14),
        (r.listingTypeLabel ?? "").slice(0, 8),
        (r.sku ?? "").slice(0, 12),
        (r.titleShort ?? "").slice(0, 22),
        (r.logisticLabel ?? "").slice(0, 8),
        fmtMoney(r.orderTotal),
        fmtMoney(r.productPurchaseTotal),
        fmtMoney(r.shippingTotal),
        fmtMoney(r.taxTotal),
        fmtMoney(r.netReceivedAmount),
        fmtMoney(r.adsFee),
        fmtMoney(r.profit),
      ].join(" | ");
      doc.text(line);
      doc.moveDown(0.14);
    }
    doc.end();
  });
}
