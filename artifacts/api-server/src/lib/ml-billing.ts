import { ml } from "./mercadolivre";
import { logger } from "./logger";

const ML_REPORT_TZ = "America/Sao_Paulo";
const PERIOD_HISTORY_MONTHS = 12;

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

export type MlBillingPeriodOption = {
  key: string;
  dateFrom: string | null;
  dateTo: string | null;
  status: string | null;
};

export type MlExtraCostsBreakdown = {
  periodKey: string | null;
  selectedPeriodKey: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  productAds: number;
  fullShipping: number;
  fullStorage: number;
  totalExtraCosts: number;
  available: boolean;
  message: string | null;
  availablePeriods: MlBillingPeriodOption[];
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayYmdSp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ML_REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentMonthPeriodKeyFallback(): string {
  const [y, m] = todayYmdSp().split("-");
  return `${y}-${m}-01`;
}

export function normalizePeriodKey(input?: string | null): string {
  if (!input?.trim()) return currentMonthPeriodKeyFallback();
  const match = input.trim().match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) return currentMonthPeriodKeyFallback();
  return `${match[1]}-${match[2]}-01`;
}

function calendarRangeForPeriodKey(periodKey: string): { dateFrom: string; dateTo: string } {
  const [y, m] = periodKey.split("-").map(Number);
  const month = String(m).padStart(2, "0");
  const dateFrom = `${y}-${month}-01`;
  const currentKey = currentMonthPeriodKeyFallback();
  if (periodKey === currentKey) {
    return { dateFrom, dateTo: todayYmdSp() };
  }
  const lastDay = new Date(y, m, 0).getDate();
  const dateTo = `${y}-${month}-${String(lastDay).padStart(2, "0")}`;
  return { dateFrom, dateTo };
}

function buildCalendarMonthOptions(count = PERIOD_HISTORY_MONTHS): MlBillingPeriodOption[] {
  const [y, m] = todayYmdSp().split("-").map(Number);
  const options: MlBillingPeriodOption[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const range = calendarRangeForPeriodKey(key);
    options.push({
      key,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      status: key === currentMonthPeriodKeyFallback() ? "OPEN" : "CLOSED",
    });
  }
  return options;
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

function mapPeriodRow(row: MlBillingPeriodRow): MlBillingPeriodOption | null {
  const key = normalizePeriodKey(row.key);
  const calendar = calendarRangeForPeriodKey(key);
  return {
    key,
    dateFrom: row.period?.date_from ?? calendar.dateFrom,
    dateTo: row.period?.date_to ?? calendar.dateTo,
    status: row.period_status ?? null,
  };
}

async function fetchBillingPeriodRows(accountId: string): Promise<MlBillingPeriodRow[]> {
  try {
    const data = await ml.get<MlBillingPeriodsResponse>(
      accountId,
      `/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=${PERIOD_HISTORY_MONTHS}`,
    );
    return data.results ?? [];
  } catch (err) {
    logger.warn({ err, accountId }, "ML billing periods fetch failed");
    return [];
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

async function fetchProductAdsSpendFallback(
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number | null> {
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
      `/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${adv.advertiser_id}/product_ads/campaigns/search?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}&metrics=cost&limit=50`,
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

function mergeAvailablePeriods(lists: MlBillingPeriodOption[][]): MlBillingPeriodOption[] {
  const byKey = new Map<string, MlBillingPeriodOption>();
  for (const list of lists) {
    for (const item of list) {
      const existing = byKey.get(item.key);
      if (!existing) {
        byKey.set(item.key, item);
        continue;
      }
      byKey.set(item.key, {
        key: item.key,
        dateFrom: existing.dateFrom ?? item.dateFrom,
        dateTo: existing.dateTo ?? item.dateTo,
        status: existing.status ?? item.status,
      });
    }
  }

  const calendar = buildCalendarMonthOptions();
  for (const item of calendar) {
    const existing = byKey.get(item.key);
    byKey.set(item.key, {
      key: item.key,
      dateFrom: existing?.dateFrom ?? item.dateFrom,
      dateTo: existing?.dateTo ?? item.dateTo,
      status: existing?.status ?? item.status,
    });
  }

  return [...byKey.values()].sort((a, b) => b.key.localeCompare(a.key));
}

async function buildAvailablePeriodsForAccount(accountId: string): Promise<MlBillingPeriodOption[]> {
  const rows = await fetchBillingPeriodRows(accountId);
  const fromMl = rows.map(mapPeriodRow).filter((p): p is MlBillingPeriodOption => p != null);
  return mergeAvailablePeriods([fromMl, buildCalendarMonthOptions()]);
}

async function resolveExtraCostsForPeriod(
  accountId: string,
  periodKey: string,
): Promise<MlExtraCostsBreakdown | null> {
  const selectedPeriodKey = normalizePeriodKey(periodKey);
  const calendar = calendarRangeForPeriodKey(selectedPeriodKey);

  let productAds = 0;
  let resolvedKey = selectedPeriodKey;
  let gotSummary = false;

  try {
    const summary = await fetchBillingSummary(accountId, selectedPeriodKey);
    gotSummary = true;
    productAds = sumProductAdsFromSummary(summary);
    resolvedKey = summary.period?.key ?? selectedPeriodKey;
  } catch (err) {
    logger.warn({ err, accountId, periodKey: selectedPeriodKey }, "ML billing summary fetch failed");
    try {
      productAds = await aggregateProductAdsFromMlDetails(accountId, selectedPeriodKey);
      gotSummary = productAds > 0;
    } catch (detailsErr) {
      logger.warn({ err: detailsErr, accountId, periodKey: selectedPeriodKey }, "ML billing details ads fetch failed");
    }
  }

  let fullShipping = 0;
  let fullStorage = 0;
  try {
    const fullTotals = await fetchFullFulfillmentTotals(accountId, selectedPeriodKey);
    fullShipping = fullTotals.fullShipping;
    fullStorage = fullTotals.fullStorage;
    if (fullShipping > 0 || fullStorage > 0) gotSummary = true;
  } catch (err) {
    logger.warn({ err, accountId, periodKey: selectedPeriodKey }, "ML full billing details fetch failed");
  }

  if (productAds === 0) {
    const adsFallback = await fetchProductAdsSpendFallback(
      accountId,
      calendar.dateFrom,
      calendar.dateTo,
    );
    if (adsFallback != null) {
      productAds = adsFallback;
      gotSummary = true;
    }
  }

  if (!gotSummary) return null;

  const totalExtraCosts = roundMoney(productAds + fullShipping + fullStorage);
  return {
    periodKey: resolvedKey,
    selectedPeriodKey,
    periodFrom: calendar.dateFrom,
    periodTo: calendar.dateTo,
    productAds,
    fullShipping,
    fullStorage,
    totalExtraCosts,
    available: true,
    message: null,
    availablePeriods: [],
  };
}

export async function fetchMlExtraCostsForAccount(
  accountId: string,
  periodKey?: string | null,
): Promise<MlExtraCostsBreakdown> {
  const selectedPeriodKey = normalizePeriodKey(periodKey);
  const availablePeriods = await buildAvailablePeriodsForAccount(accountId);

  const empty: MlExtraCostsBreakdown = {
    periodKey: selectedPeriodKey,
    selectedPeriodKey,
    periodFrom: null,
    periodTo: null,
    productAds: 0,
    fullShipping: 0,
    fullStorage: 0,
    totalExtraCosts: 0,
    available: false,
    message:
      "Não foi possível obter custos extras para este mês. Verifique a integração ML ou tente outro período.",
    availablePeriods,
  };

  try {
    const result = await resolveExtraCostsForPeriod(accountId, selectedPeriodKey);
    if (result) {
      return { ...result, availablePeriods };
    }
  } catch (err) {
    logger.warn({ err, accountId, periodKey: selectedPeriodKey }, "ML extra costs period attempt failed");
  }

  return empty;
}

export async function fetchMlExtraCostsAggregated(
  accountIds: string[],
  periodKey?: string | null,
): Promise<MlExtraCostsBreakdown> {
  const selectedPeriodKey = normalizePeriodKey(periodKey);

  if (accountIds.length === 0) {
    return {
      periodKey: selectedPeriodKey,
      selectedPeriodKey,
      periodFrom: null,
      periodTo: null,
      productAds: 0,
      fullShipping: 0,
      fullStorage: 0,
      totalExtraCosts: 0,
      available: false,
      message: "Conecte uma conta do Mercado Livre para ver custos extras.",
      availablePeriods: buildCalendarMonthOptions(),
    };
  }

  const parts = await Promise.all(
    accountIds.map((id) => fetchMlExtraCostsForAccount(id, selectedPeriodKey)),
  );
  const availablePeriods = mergeAvailablePeriods(parts.map((p) => p.availablePeriods));
  const availableParts = parts.filter((p) => p.available);

  if (availableParts.length === 0) {
    const calendar = calendarRangeForPeriodKey(selectedPeriodKey);
    return {
      periodKey: selectedPeriodKey,
      selectedPeriodKey,
      periodFrom: calendar.dateFrom,
      periodTo: calendar.dateTo,
      productAds: 0,
      fullShipping: 0,
      fullStorage: 0,
      totalExtraCosts: 0,
      available: false,
      message: parts[0]?.message ?? "Custos extras indisponíveis no momento.",
      availablePeriods,
    };
  }

  const productAds = roundMoney(availableParts.reduce((s, p) => s + p.productAds, 0));
  const fullShipping = roundMoney(availableParts.reduce((s, p) => s + p.fullShipping, 0));
  const fullStorage = roundMoney(availableParts.reduce((s, p) => s + p.fullStorage, 0));
  const ref = availableParts[0];

  return {
    periodKey: ref.periodKey,
    selectedPeriodKey,
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
    availablePeriods,
  };
}
