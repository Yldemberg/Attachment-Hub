import { ml } from "./mercadolivre";
import { logger } from "./logger";

const ML_REPORT_TZ = "America/Sao_Paulo";
const PERIOD_HISTORY_MONTHS = 12;

const FULL_SHIPPING_TYPES = new Set([
  "INBOUND_COLLECT",
  "WITHDRAWAL",
  "INBOUND_PENALTY",
  "OUTBOUND",
]);
const FULL_STORAGE_TYPES = new Set([
  "WAREHOUSING",
  "AGING",
  "OVERAGE",
  "SPACE_PURCHASE",
  "SPACE_CANCELLATION",
]);

const FULL_SUMMARY_CHARGE_TYPES = new Set([
  "CFCB",
  "CFAL",
  "CFAM",
  "CFWH",
  "CFST",
  "CFAG",
  "CFWD",
]);

const ADS_DETAIL_SUB_TYPES = new Set(["PADS"]);
const ADS_TEXT_RE =
  /product ads|product_ads|campanhas publicit|an[uú]ncios de produto|publicidade|product ads/i;
const FULL_STORAGE_TEXT_RE =
  /almacenamiento|armazenamento|warehousing|aging|overage|espac|storage|prolongado/i;
const FULL_SHIPPING_TEXT_RE =
  /colecta|coleta|retiro|withdrawal|incumplimiento|inbound|envio full|envío full|fulfillment/i;

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
  creation_date_time?: string;
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

function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

function isWithinCalendarRange(
  creationDateTime: string | undefined | null,
  dateFrom: string,
  dateTo: string,
): boolean {
  if (!creationDateTime) return true;
  const day = creationDateTime.slice(0, 10);
  return day >= dateFrom && day <= dateTo;
}

function resolveMlPeriodKeysForCalendarMonth(
  rows: MlBillingPeriodRow[],
  calendarKey: string,
): string[] {
  const calendar = calendarRangeForPeriodKey(calendarKey);
  const keys = new Set<string>([calendarKey]);

  for (const row of rows) {
    if (!row.key) continue;
    const key = normalizePeriodKey(row.key);
    if (key === calendarKey) {
      keys.add(key);
      continue;
    }
    const from = row.period?.date_from;
    const to = row.period?.date_to;
    if (from && to && rangesOverlap(calendar.dateFrom, calendar.dateTo, from, to)) {
      keys.add(key);
    }
  }

  return [...keys].sort((a, b) => {
    if (a === calendarKey) return -1;
    if (b === calendarKey) return 1;
    return b.localeCompare(a);
  });
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

function isFullSummaryCharge(charge: MlBillingCharge): boolean {
  const type = (charge.type ?? "").toUpperCase();
  const label = (charge.label ?? "").toLowerCase();
  if (FULL_SUMMARY_CHARGE_TYPES.has(type)) return true;
  if (/full|fulfillment/.test(label) && !ADS_TEXT_RE.test(label)) return true;
  if (FULL_STORAGE_TEXT_RE.test(label) || FULL_SHIPPING_TEXT_RE.test(label)) return true;
  return false;
}

function classifyFullAmount(row: MlFullBillingRow): { shipping: number; storage: number } {
  const info = row.charge_info;
  if (info?.detail_type === "BONUS") return { shipping: 0, storage: 0 };

  const amount = Math.abs(Number(info?.detail_amount ?? row.fulfillment_info?.amount ?? 0));
  if (!Number.isFinite(amount) || amount === 0) return { shipping: 0, storage: 0 };

  const fType = (row.fulfillment_info?.type ?? "").toUpperCase();
  if (FULL_STORAGE_TYPES.has(fType)) return { shipping: 0, storage: amount };
  if (FULL_SHIPPING_TYPES.has(fType)) return { shipping: amount, storage: 0 };

  const desc = (info?.transaction_detail ?? "").toLowerCase();
  if (FULL_STORAGE_TEXT_RE.test(desc)) {
    return { shipping: 0, storage: amount };
  }
  if ((info?.concept_type ?? "").toUpperCase() === "FULFILLMENT") {
    return { shipping: amount, storage: 0 };
  }
  if (fType) return { shipping: amount, storage: 0 };
  if (FULL_SHIPPING_TEXT_RE.test(desc)) return { shipping: amount, storage: 0 };

  return { shipping: 0, storage: 0 };
}

function sumProductAdsFromSummary(data: MlBillingSummaryResponse): number {
  const charges = data.bill_includes?.charges ?? [];
  let total = 0;
  for (const c of charges) {
    if (isAdsCharge(c)) total += Number(c.amount ?? 0);
  }
  return roundMoney(total);
}

function sumFullFromSummary(data: MlBillingSummaryResponse): { fullShipping: number; fullStorage: number } {
  let fullShipping = 0;
  let fullStorage = 0;
  for (const charge of data.bill_includes?.charges ?? []) {
    if (!isFullSummaryCharge(charge)) continue;
    const amount = Math.abs(Number(charge.amount ?? 0));
    const label = (charge.label ?? "").toLowerCase();
    if (FULL_STORAGE_TEXT_RE.test(label)) {
      fullStorage += amount;
    } else {
      fullShipping += amount;
    }
  }
  return { fullShipping: roundMoney(fullShipping), fullStorage: roundMoney(fullStorage) };
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

/**
 * Custo de Product Ads por item no período (só itens com gasto > 0).
 * Usa GET /advertising/product_ads/items/{id}?metrics=cost
 */
export async function fetchProductAdsItemCosts(
  accountId: string,
  itemIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(itemIds.filter(Boolean))];
  if (unique.length === 0) return out;

  const chunkSize = 6;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (itemId) => {
        try {
          const qs = new URLSearchParams({
            date_from: dateFrom,
            date_to: dateTo,
            metrics: "cost",
          });
          const data = await ml.getWithHeaders<{
            item_id?: string;
            metrics?: { cost?: number | null };
            metrics_summary?: { cost?: number | null };
          }>(
            accountId,
            `/advertising/product_ads/items/${encodeURIComponent(itemId)}?${qs.toString()}`,
            { "api-version": "2" },
          );
          const cost = Number(data.metrics?.cost ?? data.metrics_summary?.cost ?? 0);
          if (Number.isFinite(cost) && cost > 0) {
            out.set(itemId, roundMoney(cost));
          }
        } catch {
          // item sem Ads / sem permissão — permanece ausente (pedido fica sem Ads)
        }
      }),
    );
  }
  return out;
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

function aggregateFullRows(
  rows: MlFullBillingRow[],
  calendar: { dateFrom: string; dateTo: string },
  applyCalendarFilter = true,
): { fullShipping: number; fullStorage: number } {
  let fullShipping = 0;
  let fullStorage = 0;
  for (const row of rows) {
    if (
      applyCalendarFilter &&
      !isWithinCalendarRange(row.charge_info?.creation_date_time, calendar.dateFrom, calendar.dateTo)
    ) {
      continue;
    }
    const split = classifyFullAmount(row);
    fullShipping += split.shipping;
    fullStorage += split.storage;
  }

  if (applyCalendarFilter && fullShipping === 0 && fullStorage === 0 && rows.length > 0) {
    return aggregateFullRows(rows, calendar, false);
  }

  return { fullShipping: roundMoney(fullShipping), fullStorage: roundMoney(fullStorage) };
}

async function fetchFullFromDetailsEndpoint(
  accountId: string,
  periodKey: string,
  calendar: { dateFrom: string; dateTo: string },
): Promise<{ fullShipping: number; fullStorage: number }> {
  const rows = await paginateBilling<MlFullBillingRow>(accountId, (fromId) =>
    `/billing/integration/periods/key/${encodeURIComponent(periodKey)}/group/ML/full/details?document_type=BILL&limit=1000&from_id=${fromId}`,
  );
  return aggregateFullRows(rows, calendar);
}

async function fetchFullFromGeneralDetails(
  accountId: string,
  periodKey: string,
  calendar: { dateFrom: string; dateTo: string },
): Promise<{ fullShipping: number; fullStorage: number }> {
  const rows = await paginateBilling<MlFullBillingRow>(accountId, (fromId) =>
    `/billing/integration/periods/key/${encodeURIComponent(periodKey)}/group/ML/details?document_type=BILL&limit=1000&from_id=${fromId}`,
  );
  const fulfillmentRows = rows.filter(
    (row) => (row.charge_info?.concept_type ?? "").toUpperCase() === "FULFILLMENT",
  );
  return aggregateFullRows(fulfillmentRows, calendar);
}

async function aggregateProductAdsFromMlDetails(accountId: string, periodKey: string): Promise<number> {
  const rows = await paginateBilling<{ charge_info?: MlChargeInfo }>(accountId, (fromId) =>
    `/billing/integration/periods/key/${encodeURIComponent(periodKey)}/group/ML/details?document_type=BILL&limit=1000&from_id=${fromId}`,
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
  periodKeys: string[],
  calendar: { dateFrom: string; dateTo: string },
): Promise<{ fullShipping: number; fullStorage: number }> {
  let fullShipping = 0;
  let fullStorage = 0;

  for (const periodKey of periodKeys) {
    if (fullShipping > 0 || fullStorage > 0) break;

    try {
      const fromFull = await fetchFullFromDetailsEndpoint(accountId, periodKey, calendar);
      fullShipping = fromFull.fullShipping;
      fullStorage = fromFull.fullStorage;
    } catch (err) {
      logger.warn({ err, accountId, periodKey }, "ML full/details fetch failed");
    }

    if (fullShipping === 0 && fullStorage === 0) {
      try {
        const fromGeneral = await fetchFullFromGeneralDetails(accountId, periodKey, calendar);
        fullShipping = fromGeneral.fullShipping;
        fullStorage = fromGeneral.fullStorage;
      } catch (err) {
        logger.warn({ err, accountId, periodKey }, "ML general details full fetch failed");
      }
    }

    if (fullShipping === 0 && fullStorage === 0) {
      try {
        const summary = await fetchBillingSummary(accountId, periodKey);
        const fromSummary = sumFullFromSummary(summary);
        fullShipping = fromSummary.fullShipping;
        fullStorage = fromSummary.fullStorage;
      } catch (err) {
        logger.warn({ err, accountId, periodKey }, "ML billing summary full fetch failed");
      }
    }
  }

  return { fullShipping, fullStorage };
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
  calendarKey: string,
  billingRows: MlBillingPeriodRow[],
): Promise<MlExtraCostsBreakdown | null> {
  const selectedPeriodKey = normalizePeriodKey(calendarKey);
  const calendar = calendarRangeForPeriodKey(selectedPeriodKey);
  const mlPeriodKeys = resolveMlPeriodKeysForCalendarMonth(billingRows, selectedPeriodKey);

  let productAds = 0;
  let resolvedKey = selectedPeriodKey;
  let gotSummary = false;

  for (const periodKey of mlPeriodKeys) {
    try {
      const summary = await fetchBillingSummary(accountId, periodKey);
      gotSummary = true;
      productAds = sumProductAdsFromSummary(summary);
      resolvedKey = summary.period?.key ?? periodKey;
      if (productAds > 0) break;
    } catch (err) {
      logger.warn({ err, accountId, periodKey }, "ML billing summary fetch failed");
    }
  }

  if (productAds === 0) {
    for (const periodKey of mlPeriodKeys) {
      try {
        productAds = await aggregateProductAdsFromMlDetails(accountId, periodKey);
        if (productAds > 0) {
          gotSummary = true;
          resolvedKey = periodKey;
          break;
        }
      } catch (detailsErr) {
        logger.warn({ err: detailsErr, accountId, periodKey }, "ML billing details ads fetch failed");
      }
    }
  }

  let fullShipping = 0;
  let fullStorage = 0;
  try {
    const fullTotals = await fetchFullFulfillmentTotals(
      accountId,
      mlPeriodKeys,
      calendar,
    );
    fullShipping = fullTotals.fullShipping;
    fullStorage = fullTotals.fullStorage;
    if (fullShipping > 0 || fullStorage > 0) gotSummary = true;
  } catch (err) {
    logger.warn({ err, accountId, periodKey: selectedPeriodKey }, "ML full billing fetch failed");
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
  const billingRows = await fetchBillingPeriodRows(accountId);
  const availablePeriods = mergeAvailablePeriods([
    billingRows.map(mapPeriodRow).filter((p): p is MlBillingPeriodOption => p != null),
    buildCalendarMonthOptions(),
  ]);

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
    const result = await resolveExtraCostsForPeriod(accountId, selectedPeriodKey, billingRows);
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
