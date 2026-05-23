import { ml } from "./mercadolivre";
import { logger } from "./logger";

const ML_REPORT_TZ = "America/Sao_Paulo";

const FULL_SHIPPING_TYPES = new Set(["INBOUND_COLLECT", "WITHDRAWAL", "INBOUND_PENALTY"]);
const FULL_STORAGE_TYPES = new Set(["WAREHOUSING", "AGING", "OVERAGE", "SPACE_PURCHASE", "SPACE_CANCELLATION"]);

type MlBillingPeriod = {
  key?: string;
  period?: { date_from?: string; date_to?: string };
};

type MlBillingPeriodsResponse = {
  results?: MlBillingPeriod[];
};

type MlBillingCharge = {
  label?: string;
  amount?: number;
  type?: string;
};

type MlBillingSummaryResponse = {
  period?: { date_from?: string; date_to?: string; key?: string };
  bill_includes?: {
    charges?: MlBillingCharge[];
  };
};

type MlFullBillingRow = {
  charge_info?: {
    detail_amount?: number;
    detail_type?: string;
  };
  fulfillment_info?: {
    type?: string;
    amount?: number;
  };
};

type MlFullBillingResponse = {
  results?: MlFullBillingRow[];
  total?: number;
  offset?: number;
  limit?: number;
};

export type MlExtraCostsBreakdown = {
  periodKey: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  productAds: number;
  fullShipping: number;
  fullStorage: number;
  totalExtraCosts: number;
  available: boolean;
  message: string | null;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function currentMonthPeriodKeyFallback(): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: ML_REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m] = ymd.split("-");
  return `${y}-${m}-01`;
}

async function resolveLatestBillingPeriodKey(accountId: string): Promise<MlBillingPeriod | null> {
  try {
    const data = await ml.get<MlBillingPeriodsResponse>(
      accountId,
      "/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=1",
    );
    return data.results?.[0] ?? null;
  } catch (err) {
    logger.warn({ err, accountId }, "ML billing periods fetch failed");
    return null;
  }
}

function sumProductAdsFromSummary(data: MlBillingSummaryResponse): number {
  const charges = data.bill_includes?.charges ?? [];
  let total = 0;
  for (const c of charges) {
    const type = (c.type ?? "").toUpperCase();
    const label = (c.label ?? "").toLowerCase();
    if (type === "PADS" || label.includes("product ads")) {
      total += Number(c.amount ?? 0);
    }
  }
  return roundMoney(total);
}

async function fetchFullFulfillmentTotals(
  accountId: string,
  periodKey: string,
): Promise<{ fullShipping: number; fullStorage: number }> {
  let fullShipping = 0;
  let fullStorage = 0;
  const pageSize = 1000;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const data = await ml.get<MlFullBillingResponse>(
      accountId,
      `/billing/integration/periods/key/${encodeURIComponent(periodKey)}/group/ML/full/details?document_type=BILL&limit=${pageSize}&offset=${offset}`,
    );
    total = data.total ?? 0;
    const rows = data.results ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const amount = Number(row.charge_info?.detail_amount ?? row.fulfillment_info?.amount ?? 0);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const fType = (row.fulfillment_info?.type ?? "").toUpperCase();
      if (FULL_SHIPPING_TYPES.has(fType)) {
        fullShipping += amount;
      } else if (FULL_STORAGE_TYPES.has(fType)) {
        fullStorage += amount;
      } else if (fType) {
        // Outros custos Full não mapeados entram em envios/logística.
        fullShipping += amount;
      }
    }

    offset += rows.length;
    if (rows.length < pageSize) break;
    if (offset >= 10000) break;
  }

  return { fullShipping: roundMoney(fullShipping), fullStorage: roundMoney(fullStorage) };
}

export async function fetchMlExtraCostsForAccount(accountId: string): Promise<MlExtraCostsBreakdown> {
  const empty: MlExtraCostsBreakdown = {
    periodKey: null,
    periodFrom: null,
    periodTo: null,
    productAds: 0,
    fullShipping: 0,
    fullStorage: 0,
    totalExtraCosts: 0,
    available: false,
    message: "Não foi possível obter custos extras do Mercado Livre.",
  };

  const latest = await resolveLatestBillingPeriodKey(accountId);
  const periodKey = latest?.key ?? currentMonthPeriodKeyFallback();
  const periodFrom = latest?.period?.date_from ?? null;
  const periodTo = latest?.period?.date_to ?? null;

  try {
    const summary = await ml.get<MlBillingSummaryResponse>(
      accountId,
      `/billing/integration/periods/key/${encodeURIComponent(periodKey)}/summary/details`,
    );
    const productAds = sumProductAdsFromSummary(summary);

    let fullShipping = 0;
    let fullStorage = 0;
    try {
      const fullTotals = await fetchFullFulfillmentTotals(accountId, periodKey);
      fullShipping = fullTotals.fullShipping;
      fullStorage = fullTotals.fullStorage;
    } catch (err) {
      logger.warn({ err, accountId, periodKey }, "ML full billing details fetch failed");
    }

    const totalExtraCosts = roundMoney(productAds + fullShipping + fullStorage);

    return {
      periodKey: summary.period?.key ?? periodKey,
      periodFrom: summary.period?.date_from ?? periodFrom,
      periodTo: summary.period?.date_to ?? periodTo,
      productAds,
      fullShipping,
      fullStorage,
      totalExtraCosts,
      available: true,
      message: null,
    };
  } catch (err) {
    logger.warn({ err, accountId, periodKey }, "ML billing summary fetch failed");
    return { ...empty, periodKey, periodFrom, periodTo };
  }
}

export async function fetchMlExtraCostsAggregated(accountIds: string[]): Promise<MlExtraCostsBreakdown> {
  if (accountIds.length === 0) {
    return {
      periodKey: null,
      periodFrom: null,
      periodTo: null,
      productAds: 0,
      fullShipping: 0,
      fullStorage: 0,
      totalExtraCosts: 0,
      available: false,
      message: "Conecte uma conta do Mercado Livre para ver custos extras.",
    };
  }

  const parts = await Promise.all(accountIds.map((id) => fetchMlExtraCostsForAccount(id)));
  const availableParts = parts.filter((p) => p.available);

  if (availableParts.length === 0) {
    return {
      periodKey: parts[0]?.periodKey ?? null,
      periodFrom: parts[0]?.periodFrom ?? null,
      periodTo: parts[0]?.periodTo ?? null,
      productAds: 0,
      fullShipping: 0,
      fullStorage: 0,
      totalExtraCosts: 0,
      available: false,
      message: parts[0]?.message ?? "Custos extras indisponíveis no momento.",
    };
  }

  const productAds = roundMoney(availableParts.reduce((s, p) => s + p.productAds, 0));
  const fullShipping = roundMoney(availableParts.reduce((s, p) => s + p.fullShipping, 0));
  const fullStorage = roundMoney(availableParts.reduce((s, p) => s + p.fullStorage, 0));

  const ref = availableParts[0];
  return {
    periodKey: ref.periodKey,
    periodFrom: ref.periodFrom,
    periodTo: ref.periodTo,
    productAds,
    fullShipping,
    fullStorage,
    totalExtraCosts: roundMoney(productAds + fullShipping + fullStorage),
    available: true,
    message: availableParts.length < parts.length ? "Algumas contas não retornaram dados de faturamento." : null,
  };
}
