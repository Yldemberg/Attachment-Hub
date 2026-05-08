import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export interface SalesReportExportRow {
  referenceDate: string;
  mlOrderId: string;
  accountNickname: string | null;
  totalAmount: number | null;
  currencyId: string | null;
  buyerNickname: string | null;
  status: string | null;
}

export interface SalesReportSummary {
  orderCount: number;
  revenue: number;
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildSalesReportCsv(
  rows: SalesReportExportRow[],
  summary: SalesReportSummary,
): string {
  const header = ["Data", "Pedido ML", "Conta", "Valor", "Moeda", "Comprador", "Status"];
  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    const amount = r.totalAmount != null ? String(r.totalAmount) : "";
    lines.push(
      [
        r.referenceDate,
        r.mlOrderId,
        r.accountNickname ?? "",
        amount,
        r.currencyId ?? "",
        r.buyerNickname ?? "",
        r.status ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  lines.push("");
  lines.push(csvEscape(`Resumo: ${summary.orderCount} pedidos; receita total ${summary.revenue.toFixed(2)}`));
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
  ws.addRow(["Relatório de vendas"]);
  ws.addRow([`Período: ${dateFrom} a ${dateTo}`]);
  ws.addRow([`Pedidos: ${summary.orderCount}`, `Receita: ${summary.revenue}`]);
  ws.addRow([]);
  ws.addRow(["Data", "Pedido ML", "Conta", "Valor", "Moeda", "Comprador", "Status"]);
  for (const r of rows) {
    ws.addRow([
      r.referenceDate,
      r.mlOrderId,
      r.accountNickname,
      r.totalAmount,
      r.currencyId,
      r.buyerNickname,
      r.status,
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
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(14).text("Relatório de vendas", { align: "center" });
    doc.fontSize(10).text(`Período: ${dateFrom} a ${dateTo}`, { align: "center" });
    doc.moveDown();
    doc.text(`Total de pedidos: ${summary.orderCount}    Receita: ${summary.revenue.toFixed(2)}`);
    doc.moveDown(0.5);
    doc.fontSize(8);
    doc.text(
      "Data         Pedido ML       Conta                  Valor      Moeda  Comprador            Status",
    );
    doc.moveDown(0.25);

    for (const r of rows) {
      if (doc.y > 520) {
        doc.addPage();
        doc.fontSize(8);
      }
      const line = [
        r.referenceDate.padEnd(12),
        r.mlOrderId.padEnd(15),
        (r.accountNickname ?? "").slice(0, 20).padEnd(20),
        (r.totalAmount != null ? r.totalAmount.toFixed(2) : "").padStart(10),
        (r.currencyId ?? "").padEnd(6),
        (r.buyerNickname ?? "").slice(0, 20).padEnd(20),
        r.status ?? "",
      ].join(" ");
      doc.text(line);
    }
    doc.end();
  });
}
