import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export interface SalesReportExportRow {
  referenceDate: string;
  mlOrderId: string;
  accountNickname: string | null;
  /** Total do pedido (ML total_amount). */
  orderTotal: number | null;
  /** Soma (preço de compra × qtd) por SKU nos custos salvos no inventário. */
  productPurchaseTotal: number;
  /** Soma marketplace_fee dos pagamentos (última sync). */
  marketplaceFeesTotal: number;
  /** Soma shipping_cost dos pagamentos. */
  shippingTotal: number;
  /** Imposto estimado: soma (subtotal da linha × % do SKU). */
  taxTotal: number;
  /** Soma de transaction_details.net_received_amount (Mercado Pago) por pagamento. */
  netReceivedAmount: number | null;
  /**
   * Subtotal itens − taxas ML − imposto − preço de compra dos produtos.
   * Subtotal itens = soma unit_price×qtd (mesmo base do relatório ML ao sincronizar).
   */
  profit: number;
}

export interface SalesReportSummary {
  orderCount: number;
  revenue: number;
}

const CSV_HEADERS = [
  "Data",
  "Número do Pedido",
  "Conta",
  "Total da Compra",
  "Preço de Compra do Produto",
  "Total de taxas do Mercado Livre",
  "Frete",
  "Imposto",
  "À Receber",
  "Lucro",
];

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

export function buildSalesReportCsv(
  rows: SalesReportExportRow[],
  _summary: SalesReportSummary,
): string {
  const lines: string[] = [CSV_HEADERS.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.referenceDate,
        r.mlOrderId,
        r.accountNickname ?? "",
        fmtMoney(r.orderTotal),
        fmtMoney(r.productPurchaseTotal),
        fmtMoney(r.marketplaceFeesTotal),
        fmtMoney(r.shippingTotal),
        fmtMoney(r.taxTotal),
        fmtMoney(r.netReceivedAmount),
        fmtMoney(r.profit),
      ]
        .map(csvEscape)
        .join(","),
    );
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
  ws.addRow(CSV_HEADERS);
  for (const r of rows) {
    ws.addRow([
      r.referenceDate,
      r.mlOrderId,
      r.accountNickname,
      r.orderTotal,
      r.productPurchaseTotal,
      r.marketplaceFeesTotal,
      r.shippingTotal,
      r.taxTotal,
      r.netReceivedAmount,
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
    const doc = new PDFDocument({ margin: 28, size: "A4", layout: "landscape" });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(11).text("Relatório de vendas", { align: "center" });
    doc.fontSize(9).text(`Período: ${dateFrom} a ${dateTo}`, { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(8).text(
      `Pedidos: ${summary.orderCount}   Receita (total pedidos): ${summary.revenue.toFixed(2)}`,
      { align: "center" },
    );
    doc.moveDown(0.5);
    doc.fontSize(6.5);
    doc.text(
      "Data       Pedido        Conta                 Tot.Compra Pr.Compra TaxasML   Frete   Imposto A.Receber Lucro",
    );
    doc.moveDown(0.15);

    for (const r of rows) {
      if (doc.y > 520) {
        doc.addPage();
        doc.fontSize(6.5);
      }
      const line = [
        r.referenceDate.padEnd(11),
        r.mlOrderId.padEnd(14),
        (r.accountNickname ?? "").slice(0, 18).padEnd(18),
        fmtMoney(r.orderTotal).padStart(10),
        fmtMoney(r.productPurchaseTotal).padStart(10),
        fmtMoney(r.marketplaceFeesTotal).padStart(9),
        fmtMoney(r.shippingTotal).padStart(7),
        fmtMoney(r.taxTotal).padStart(8),
        fmtMoney(r.netReceivedAmount).padStart(10),
        fmtMoney(r.profit).padStart(10),
      ].join(" ");
      doc.text(line);
      doc.moveDown(0.18);
    }
    doc.end();
  });
}
