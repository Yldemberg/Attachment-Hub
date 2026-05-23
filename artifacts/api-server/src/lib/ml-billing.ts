import { ml } from "./mercadolivre";
import { logger } from "./logger";

const ML_REPORT_TZ = "America/Sao_Paulo";

const FULL_SHIPPING_TYPES = new Set(["INBOUND_COLLECT", "WITHDRAWAL", "INBOUND_PENALTY"]);
const FULL_STORAGE_TYPES = new Set(["WAREHOUSING", "AGING", "OVERAGE", "SPACE_PURCHASE", "SPACE_CANCELLATION"]);

const ADS_DETAIL_SUB_TYPES = new Set(["PADS"]);
const ADS_TEXT_RE =
  /product ads|product_ads|campanhas publicit|an[uú]ncios de produto|publicidade|product ads/i;

type MlBillingPeriodRow = {
  key?: string;
  period?: { date_from?: string; date_to?: string };
  period_status?: string;
};

type MlBillingPeriodsResponse = {
  results?: MlBillingPeriodRow[];
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

type MlChargeInfo = {
  detail_amount?: number;
  detail_type?: string;
  detail_sub_type?: string;
  concept_type?: string;
  transaction_detail?: string;
};

type MlFullBillingRow = {
  charge_info?: MlChargeInfo;
  fulfillment_info?: {
    type?: string;
    amount?: number;
  };
};

type MlBillingPage<T> = {
  results?: T[];
  total?: number;
  last_id?: number;
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

function isAdsCharge(charge: MlBillingCharge): boolean {
  const type = (charge.type ?? "").toUpperCase();
  const label = (charge.label ?? "").toLowerCase();
  return type === "PADS" || ADS_TEXT_RE.test(label);
}

function isAdsDetail(info: MlChargeInfo): boolean {
  const sub = (info.detail_sub_type ?? "").toUpperCase();
  const desc = (info.transaction_detail ?? "").toLowerCase();
  return ADS_DETAIL_SUB_TYPES.has(sub) || ADS_TEXT_RE.test(desc);
}

function sumProductAdsFromSummary(data: MlBillingSummaryResponse): number {
  const charges = data.bill_includes?.charges ?? [];
  let total = 0;
  for (const c of charges) {
    if (isAdsCharge(c)) total += Number(c.amount ?? 0);
  }
  return roundMoney(total);
}

async function fetchBillingPeriodCandidates(accountId: string): Promise<MlBillingPeriodRow[]> {
  try {
    const data = await ml.get<MlBillingPeriodsResponse>(
      accountId,
      "/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=12",
    );
    const rows = data.results ?? [];
    const closed = rows.filter((r) => (r.period_status ?? "").toUpperCase() === "CLOSED");
    const open = rows.filter((r) => (r.period_status ?? "").toUpperCase() === "OPEN");
    return [...closed, ...open, ...rows];
  } catch (err) {
    logger.warn({ err, accountId }, "ML billing periods fetch failed");
    return [{ key: currentMonthPeriodKeyFallback() }];
  }
}

async function fetchBillingSummary(
  accountId: string,
  periodKey: string,
): Promise<MlBillingSummaryResponse> {
  return ml.get<MlBillingSummaryResponse>(
    accountId,
    `/billing/integration/periods/key/${encodeURIComponent(periodKey)}/summary/details?group=ML`,
  );
}

function billingPeriodDateRangeSp(): { dateFrom: string; dateTo: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: ML_REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m] = today.split("-");
  return { dateFrom: `${y}-${m}-01`, dateTo: today };
}

async function fetchProductAdsSpendFallback(
  accountId: string,
  dateFrom?: string | null,
  dateTo?: string | null,
): Promise<number | null> {
  const range = billingPeriodDateRangeSp();
  const from = dateFrom ?? range.dateFrom;
  const to = dateTo ?? range.dateTo;
  try {
    const advertisers = await ml.get<{
      advertisers?: Array<{ advertiser_id?: number; site_id?: string }>;
    }>(accountId, "/advertising/advertisers?product_id=PADS");
    const adv = advertisers.advertisers?.[0];
    if (!adv?.advertiser_id) return null;
    const siteId = adv.site_id ?? "MLB";
    const data = await ml.get<{
      results?: Array<{ metrics?: { cost?: number; spend?: number } }>;
    }>(
      accountId,
      `/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${adv.advertiser_id}/product_ads/campaigns/search?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}&metrics=cost&limit=50`,
    );
    let total = 0;
    for (const row of data.results ?? []) {
      const cost = row.metrics?.cost ?? row.metrics?.spend;
      if (cost != null) total += Number(cost);
    }
    return roundMoney(total);
  } catch (err) {
    logger.warn({ err, accountId }, "ML Product Ads spend fallback failed");
    return null;
  }
}

async function paginateBilling<T>(
  accountId: string,
  buildPath: (fromId: number) => string,
): Promise<T[]> {
  const all: T[] = [];
  let fromId = 0;
  for (let page = 0; page < 25; page++) {
    const data = await ml.get<MlBillingPage<T>>(accountId, buildPath(fromId));
    const rows = data.results ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    const next = data.last_id;
    if (next == null || next === fromId) break;
    fromId = next;
    if (rows.length < (data.limit ?? 1000)) break;
  }
  return all;
}

async function aggregateProductAdsFromMlDetails(accountId: string, periodKey: string): Promise<number> {
  const rows = await paginateBilling<{ charge_info?: MlChargeInfo }>(accountId, (fromId) =>
    `/billing/integration/periods/key/${encodeURIComponent(periodKey)}/group/ML/details?group=ML&document_type=BILL&limit=1000&from_id=${fromId}`,
  );
  let total = 0;
  for (const row of rows) {
    const info = row.charge_info;
    if (!info || info.detail_type === "BONUS") continue;
    if (!isAdsDetail(info)) continue;
    total += Number(info.detail_amount ?? 0);
  }
  return roundMoney(total);
}

async function fetchFullFulfillmentTotals(
  accountId: string,
  periodKey: string,
): Promise<{ fullShipping: number; fullStorage: number }> {
  let fullShipping = 0;
  let fullStorage = 0;

  const rows = await paginateBilling<MlFullBillingRow>(accountId, (fromId) =>
    `/billing/integration/periods/key/${encodeURIComponent(periodKey)}/group/ML/full/details?group=ML&document_type=BILL&limit=1000&from_id=${fromId}`,
  );

  for (const row of rows) {
    const info = row.charge_info;
    if (info?.detail_type === "BONUS") continue;
    const amount = Number(info?.detail_amount ?? row.fulfillment_info?.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const fType = (row.fulfillment_info?.type ?? "").toUpperCase();
    if (FULL_STORAGE_TYPES.has(fType)) {
      fullStorage += amount;
    } else if (FULL_SHIPPING_TYPES.has(fType) || fType) {
      fullShipping += amount;
    } else if ((info?.concept_type ?? "").toUpperCase() === "FULFILLMENT") {
      fullShipping += amount;
    }
  }

  return { fullShipping: roundMoney(fullShipping), fullStorage: roundMoney(fullStorage) };
}

async function resolveExtraCostsForPeriod(
  accountId: string,
  period: MlBillingPeriodRow,
): Promise<MlExtraCostsBreakdown | null> {
  const periodKey = period.key;
  if (!periodKey) return null;

  let productAds = 0;
  let periodFrom = period.period?.date_from ?? null;
  let periodTo = period.period?.date_to ?? null;
  let resolvedKey = periodKey;
  let gotSummary = false;

  try {
    const summary = await fetchBillingSummary(accountId, periodKey);
    gotSummary = true;
    productAds = sumProductAdsFromSummary(summary);
    periodFrom = summary.period?.date_from ?? periodFrom;
    periodTo = summary.period?.date_to ?? periodTo;
    resolvedKey = summary.period?.key ?? periodKey;
  } catch (err) {
    logger.warn({ err, accountId, periodKey }, "ML billing summary fetch failed");
    try {
      productAds = await aggregateProductAdsFromMlDetails(accountId, periodKey);
      gotSummary = productAds > 0;
    } catch (detailsErr) {
      logger.warn({ err: detailsErr, accountId, periodKey }, "ML billing details ads fetch failed");
    }
  }

  let fullShipping = 0;
  let fullStorage = 0;
  try {
    const fullTotals = await fetchFullFulfillmentTotals(accountId, periodKey);
    fullShipping = fullTotals.fullShipping;
    fullStorage = fullTotals.fullStorage;
  } catch (err) {
    logger.warn({ err, accountId, periodKey }, "ML full billing details fetch failed");
  }

  if (productAds === 0) {
    const adsFallback = await fetchProductAdsSpendFallback(accountId, periodFrom, periodTo);
    if (adsFallback != null) {
      productAds = adsFallback;
      gotSummary = true;
    }
  }

  if (!gotSummary && fullShipping === 0 && fullStorage === 0 && productAds === 0) {
    return null;
  }

  const totalExtraCosts = roundMoney(productAds + fullShipping + fullStorage);
  return {
    periodKey: resolvedKey,
    periodFrom,
    periodTo,
    productAds,
    fullShipping,
    fullStorage,
    totalExtraCosts,
    available: true,
    message: null,
  };
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
    message:
      "Não foi possível obter custos extras. Verifique se a conta ML tem faturamento habilitado e reconecte a integração.",
  };

  const candidates = await fetchBillingPeriodCandidates(accountId);
  const seenKeys = new Set<string>();

  for (const period of candidates) {
    const key = period.key;
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    try {
      const result = await resolveExtraCostsForPeriod(accountId, period);
      if (result) return result;
    } catch (err) {
      logger.warn({ err, accountId, periodKey: key }, "ML extra costs period attempt failed");
    }
  }

  const fallbackKey = currentMonthPeriodKeyFallback();
  if (!seenKeys.has(fallbackKey)) {
    try {
      const result = await resolveExtraCostsForPeriod(accountId, { key: fallbackKey });
      if (result) return result;
    } catch (err) {
      logger.warn({ err, accountId, periodKey: fallbackKey }, "ML extra costs fallback period failed");
    }
  }

  const first = candidates[0];
  return {
    ...empty,
    periodKey: first?.key ?? fallbackKey,
    periodFrom: null,
    periodTo: null,
  };
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
      periodFrom: null,
      periodTo: null,
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
    message:
      availableParts.length < parts.length
        ? "Algumas contas não retornaram dados de faturamento."
        : null,
  };
}
