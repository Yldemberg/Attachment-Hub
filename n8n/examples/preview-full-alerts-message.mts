/**
 * Preview local da mensagem WhatsApp (mesma lógica do nó Formatar mensagem).
 * node --experimental-strip-types n8n/examples/preview-full-alerts-message.mts
 */
import sample from "./full-alerts-request.json" with { type: "json" };

const TYPE_META = {
  ruptura: { emoji: "🔴", label: "RUPTURA" },
  critico: { emoji: "🟠", label: "CRÍTICO" },
  parado: { emoji: "⚪", label: "PARADO" },
  saudavel: { emoji: "🟢", label: "SAUDÁVEL" },
};

function fmtDate(ymd) {
  if (!ymd || typeof ymd !== "string") return "—";
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function fmtNum(n) {
  if (n == null || n === "") return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10);
}

const body = sample;
const phone = String(body.phone || "").replace(/\D/g, "");
const alerts = Array.isArray(body.alerts) ? body.alerts : [];
const nick = body.accountNickname || "ML";

if (!phone || alerts.length === 0) {
  throw new Error("phone ou alerts vazios");
}

const shown = alerts.slice(0, 25);
const lines = shown.map((a, i) => {
  const key = String(a.type || "").toLowerCase();
  const meta = TYPE_META[key] || { emoji: "📦", label: String(a.type || "ALERTA").toUpperCase() };
  const sku = String(a.sku || "—");
  const title = String(a.title || "").trim();
  const titleLine = title ? `_${title.slice(0, 80)}${title.length > 80 ? "…" : ""}_\n` : "";
  const cov = a.coverageDays != null ? `${fmtNum(a.coverageDays)}d` : "—";
  const qty = fmtNum(a.suggestedQty || 0);
  const send = fmtDate(a.sendBy);
  return [
    `${meta.emoji} *${i + 1}. ${meta.label}* · *${sku}*`,
    titleLine + `📦 Estoque: *${fmtNum(a.stockFull)}*`,
    `📈 Vendas/dia: *${fmtNum(a.salesPerDay)}*`,
    `⏱ Cobertura: *${cov}*`,
    `🚚 Enviar: *${qty} un.* até *${send}*`,
  ].join("\n");
});

const more =
  alerts.length > shown.length
    ? `\n\n_…e mais ${alerts.length - shown.length} alerta(s) na Gestão Full_`
    : "";

const text = [
  `📦 *iHub · Gestão Full*`,
  `🏪 Conta: *${nick}*`,
  `🔔 *${alerts.length}* alerta(s) precisando de atenção`,
  `────────────────`,
  lines.join("\n\n"),
  more,
  `\n✅ Abra a *Gestão Full* no iHub para sync e envio.`,
].join("\n");

if (!text.includes("*iHub") || !text.includes("🔴") || !text.includes("*ABC-1*")) {
  throw new Error("formatação incompleta");
}
if (!/\*\d+ un\.\*/.test(text) && !text.includes("*72 un.*")) {
  throw new Error("qtd sugerida sem negrito");
}

console.log(text);
console.log("\n--- OK preview ---");
