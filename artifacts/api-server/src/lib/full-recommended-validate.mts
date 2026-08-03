/**
 * Validação dos critérios recomendados (meta 25, lead 12, período 15).
 * Executar: node --experimental-strip-types artifacts/api-server/src/lib/full-recommended-validate.mts
 * ou via tsx se disponível.
 */
import { computeFullSkuMetrics } from "./full-engine.ts";
import { FULL_RECOMMENDED_SETTINGS } from "./full-recommended-settings.ts";

const params = {
  coverageTargetDays: FULL_RECOMMENDED_SETTINGS.coverageTargetDays,
  leadTimeDays: FULL_RECOMMENDED_SETTINGS.leadTimeDays,
  salesPeriodDays: FULL_RECOMMENDED_SETTINGS.salesPeriodDays,
  stuckMultiplier: FULL_RECOMMENDED_SETTINGS.stuckMultiplier,
  now: new Date("2026-08-02T12:00:00.000Z"),
};

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// Curva A: 45 un / 15d = 3/dia; estoque 30 → cobertura 10d < lead 12 → crítico
{
  const m = computeFullSkuMetrics({ stockFull: 30, unitsSoldPeriod: 45 }, params);
  assert(m.salesPerDay === 3, `salesPerDay expected 3 got ${m.salesPerDay}`);
  assert(m.coverageDays === 10, `coverage expected 10 got ${m.coverageDays}`);
  assert(m.status === "critico", `status expected critico got ${m.status}`);
  // qtd = ceil(25*3 - 30) = 45
  assert(m.suggestedQty === 45, `suggestedQty expected 45 got ${m.suggestedQty}`);
  // sendBy: floor(10-12)=0 → hoje
  assert(m.sendBy === "2026-08-02", `sendBy expected 2026-08-02 got ${m.sendBy}`);
}

// Saudável: estoque 60, 3/dia → cobertura 20 >= 12 e >= 7.5
{
  const m = computeFullSkuMetrics({ stockFull: 60, unitsSoldPeriod: 45 }, params);
  assert(m.coverageDays === 20, `coverage expected 20 got ${m.coverageDays}`);
  assert(m.status === "saudavel", `status expected saudavel got ${m.status}`);
  assert(m.suggestedQty === 15, `suggestedQty expected 15 got ${m.suggestedQty}`);
  // sendBy: floor(20-12)=8 → 2026-08-10
  assert(m.sendBy === "2026-08-10", `sendBy expected 2026-08-10 got ${m.sendBy}`);
}

// Ruptura (com vendas)
{
  const m = computeFullSkuMetrics({ stockFull: 0, unitsSoldPeriod: 45 }, params);
  assert(m.status === "ruptura", `status expected ruptura got ${m.status}`);
  assert(m.suggestedQty === 75, `suggestedQty expected 75 got ${m.suggestedQty}`);
}

// Ruptura (estoque zerado sem vendas no período)
{
  const m = computeFullSkuMetrics({ stockFull: 0, unitsSoldPeriod: 0 }, params);
  assert(m.status === "ruptura", `status expected ruptura got ${m.status}`);
}

// WhatsApp: parado off — só ruptura/crítico elegíveis
{
  const enabled = new Set<string>();
  if (FULL_RECOMMENDED_SETTINGS.alertRuptura) enabled.add("ruptura");
  if (FULL_RECOMMENDED_SETTINGS.alertCritico) enabled.add("critico");
  if (FULL_RECOMMENDED_SETTINGS.alertParado) enabled.add("parado");
  assert(enabled.has("ruptura") && enabled.has("critico"), "ruptura+critico must be on");
  assert(!enabled.has("parado"), "parado must be off for WhatsApp");
}

console.log("OK: critérios recomendados (meta 25 / lead 12 / período 15) validados");
