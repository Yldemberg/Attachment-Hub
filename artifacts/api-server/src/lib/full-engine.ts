/**
 * Motor de cobertura e reposição Full (MVP).
 *
 * vendas_dia = unidades_periodo / dias_periodo
 * cobertura = estoque_full / max(vendas_dia, epsilon)
 * qtd_sugerida = ceil(meta_dias * vendas_dia - estoque_full - em_transito)
 * quando_enviar = hoje + max(0, cobertura - lead_time)
 * critico = cobertura < lead_time OU cobertura < meta * 0.3
 *
 * Defaults recomendados: ver full-recommended-settings.ts (meta 25, lead 12, período 15).
 *
 * Fase 2 (não implementado): em_transito de inbound, vendas perdidas R$, ABC, cap mandate.
 */

export type FullSkuStatus = "ruptura" | "critico" | "saudavel" | "parado";

export type FullEngineParams = {
  coverageTargetDays: number;
  leadTimeDays: number;
  salesPeriodDays: number;
  stuckMultiplier: number;
  /** Unidades em trânsito (MVP = 0). */
  inTransit?: number;
  now?: Date;
};

export type FullSkuMetricsInput = {
  stockFull: number;
  unitsSoldPeriod: number;
};

export type FullSkuMetrics = {
  salesPerDay: number;
  coverageDays: number | null;
  suggestedQty: number;
  sendBy: string | null;
  status: FullSkuStatus;
};

const EPSILON = 0.0001;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function computeFullSkuMetrics(
  input: FullSkuMetricsInput,
  params: FullEngineParams,
): FullSkuMetrics {
  const period = Math.max(1, params.salesPeriodDays);
  const target = Math.max(1, params.coverageTargetDays);
  const lead = Math.max(0, params.leadTimeDays);
  const stuckMul = Math.max(1, params.stuckMultiplier);
  const inTransit = Math.max(0, params.inTransit ?? 0);
  const stock = Math.max(0, input.stockFull);
  const sold = Math.max(0, input.unitsSoldPeriod);
  const now = params.now ?? new Date();

  const salesPerDay = sold / period;
  const hasVelocity = salesPerDay > EPSILON;

  let coverageDays: number | null = null;
  if (hasVelocity) {
    coverageDays = stock / salesPerDay;
  } else if (stock > 0) {
    coverageDays = null;
  } else {
    coverageDays = 0;
  }

  let suggestedQty = 0;
  if (hasVelocity) {
    suggestedQty = Math.max(0, Math.ceil(target * salesPerDay - stock - inTransit));
  }

  let sendBy: string | null = null;
  if (hasVelocity && suggestedQty > 0) {
    const daysUntilSend = Math.max(0, Math.floor((coverageDays ?? 0) - lead));
    const sendDate = new Date(now);
    sendDate.setDate(sendDate.getDate() + daysUntilSend);
    sendBy = ymd(sendDate);
  } else if (!hasVelocity && stock === 0) {
    sendBy = null;
  }

  let status: FullSkuStatus;
  if (stock === 0) {
    status = "ruptura";
  } else if (sold === 0) {
    status = "parado";
  } else if (hasVelocity && coverageDays != null && coverageDays > target * stuckMul) {
    status = "parado";
  } else if (
    hasVelocity &&
    coverageDays != null &&
    (coverageDays < lead || coverageDays < target * 0.3)
  ) {
    status = "critico";
  } else {
    status = "saudavel";
  }

  return {
    salesPerDay: Math.round(salesPerDay * 1000) / 1000,
    coverageDays: coverageDays == null ? null : Math.round(coverageDays * 10) / 10,
    suggestedQty,
    sendBy,
    status,
  };
}

export type FullOverviewKpis = {
  rupturaCount: number;
  criticoCount: number;
  saudavelCount: number;
  paradoCount: number;
  avgCoverageDays: number | null;
};

export function computeFullOverviewKpis(
  items: Array<{ status: FullSkuStatus; coverageDays: number | null }>,
): FullOverviewKpis {
  let rupturaCount = 0;
  let criticoCount = 0;
  let saudavelCount = 0;
  let paradoCount = 0;
  let coverageSum = 0;
  let coverageN = 0;

  for (const it of items) {
    if (it.status === "ruptura") rupturaCount += 1;
    else if (it.status === "critico") criticoCount += 1;
    else if (it.status === "parado") paradoCount += 1;
    else saudavelCount += 1;

    if (it.coverageDays != null && Number.isFinite(it.coverageDays)) {
      coverageSum += it.coverageDays;
      coverageN += 1;
    }
  }

  return {
    rupturaCount,
    criticoCount,
    saudavelCount,
    paradoCount,
    avgCoverageDays: coverageN > 0 ? Math.round((coverageSum / coverageN) * 10) / 10 : null,
  };
}
