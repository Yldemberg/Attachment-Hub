import { ml } from "./mercadolivre";
import { logger } from "./logger";

const ML_REPORT_TZ = "America/Sao_Paulo";
const METRICS =
  "clicks,prints,cost,cpc,acos,roas,total_amount,units_quantity";
const MANAGE_URL = "https://www.mercadolivre.com.br/publicidade";
const CAMPAIGN_PAGE_LIMIT = 50;
const MAX_CAMPAIGN_PAGES = 20;

export type AdsAlertBucketId = "spent_no_sales" | "below_target" | "on_track";

export type AdsKpis = {
  impressions: number;
  clicks: number;
  cost: number;
  revenue: number;
  cpc: number;
  roas: number;
};

export type AdsAlertRow = {
  id: AdsAlertBucketId;
  label: string;
  quantity: number;
  costSharePct: number;
  cost: number;
  revenue: number;
  roas: number;
};

export type AdsCampaignRow = {
  id: string;
  name: string;
  status: string | null;
  accountId: string;
  cost: number;
  revenue: number;
  roas: number;
  clicks: number;
  impressions: number;
  cpc: number;
  roasTarget: number | null;
  alertBucket: AdsAlertBucketId;
};

export type AdsDailyPoint = {
  date: string;
  cost: number;
  revenue: number;
};

export type AdsKpiDeltas = {
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
  revenue: number | null;
  cpc: number | null;
  roas: number | null;
};

export type AdsOverview = {
  available: boolean;
  message: string | null;
  dateFrom: string;
  dateTo: string;
  previousDateFrom: string;
  previousDateTo: string;
  kpis: AdsKpis;
  previousKpis: AdsKpis;
  kpiDeltas: AdsKpiDeltas;
  alerts: AdsAlertRow[];
  daily: AdsDailyPoint[];
  campaigns: AdsCampaignRow[];
  manageUrl: string;
};

type MlAdvertiser = {
  advertiser_id?: number;
  site_id?: string;
};

type MlCampaignMetrics = {
  clicks?: number | null;
  prints?: number | null;
  cost?: number | null;
  spend?: number | null;
  cpc?: number | null;
  acos?: number | null;
  roas?: number | null;
  total_amount?: number | null;
  units_quantity?: number | null;
};

type MlCampaignRow = {
  id?: number | string;
  name?: string;
  status?: string;
  acos_target?: number | null;
  roas_target?: number | null;
  metrics?: MlCampaignMetrics;
  metrics_summary?: MlCampaignMetrics;
};

type MlDailyRow = {
  date?: string;
  cost?: number | null;
  spend?: number | null;
  total_amount?: number | null;
  metrics?: MlCampaignMetrics;
};

type MlCampaignsResponse = {
  paging?: { total?: number; offset?: number; limit?: number };
  results?: Array<MlCampaignRow | MlDailyRow>;
  metrics_summary?: MlCampaignMetrics;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundRatio(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function todayYmdSp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ML_REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function daysInclusive(from: string, to: string): number {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (!a || !b) return 1;
  const start = Date.UTC(a.y, a.m - 1, a.d);
  const end = Date.UTC(b.y, b.m - 1, b.d);
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function emptyKpis(): AdsKpis {
  return { impressions: 0, clicks: 0, cost: 0, revenue: 0, cpc: 0, roas: 0 };
}

function metricsToPartial(m?: MlCampaignMetrics | null): {
  impressions: number;
  clicks: number;
  cost: number;
  revenue: number;
} {
  return {
    impressions: num(m?.prints),
    clicks: num(m?.clicks),
    cost: num(m?.cost ?? m?.spend),
    revenue: num(m?.total_amount),
  };
}

function finalizeKpis(partial: {
  impressions: number;
  clicks: number;
  cost: number;
  revenue: number;
}): AdsKpis {
  const cost = roundMoney(partial.cost);
  const revenue = roundMoney(partial.revenue);
  const clicks = Math.round(partial.clicks);
  const impressions = Math.round(partial.impressions);
  return {
    impressions,
    clicks,
    cost,
    revenue,
    cpc: clicks > 0 ? roundMoney(cost / clicks) : 0,
    roas: cost > 0 ? roundRatio(revenue / cost) : 0,
  };
}

function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) {
    if (current === 0) return 0;
    return null;
  }
  return roundRatio(((current - previous) / Math.abs(previous)) * 100);
}

function resolveRoasTarget(row: MlCampaignRow): number | null {
  const roasTarget = row.roas_target;
  if (roasTarget != null && Number.isFinite(Number(roasTarget)) && Number(roasTarget) > 0) {
    return Number(roasTarget);
  }
  const acosTarget = row.acos_target;
  if (acosTarget != null && Number.isFinite(Number(acosTarget)) && Number(acosTarget) > 0) {
    // ACOS% → ROAS ≈ 100 / ACOS
    return roundRatio(100 / Number(acosTarget));
  }
  return null;
}

function classifyCampaign(cost: number, revenue: number, roas: number, roasTarget: number | null): AdsAlertBucketId {
  if (cost > 0 && revenue <= 0) return "spent_no_sales";
  const target = roasTarget != null && roasTarget > 0 ? roasTarget : 1;
  if (cost > 0 && roas < target) return "below_target";
  return "on_track";
}

function buildAlerts(campaigns: AdsCampaignRow[]): AdsAlertRow[] {
  const totalCost = campaigns.reduce((s, c) => s + c.cost, 0);
  const defs: Array<{ id: AdsAlertBucketId; label: string }> = [
    { id: "spent_no_sales", label: "Gasto sem venda" },
    { id: "below_target", label: "Fora da meta" },
    { id: "on_track", label: "No fluxo / perto da meta" },
  ];

  return defs.map((def) => {
    const rows = campaigns.filter((c) => c.alertBucket === def.id);
    const cost = roundMoney(rows.reduce((s, c) => s + c.cost, 0));
    const revenue = roundMoney(rows.reduce((s, c) => s + c.revenue, 0));
    return {
      id: def.id,
      label: def.label,
      quantity: rows.length,
      costSharePct: totalCost > 0 ? roundRatio((cost / totalCost) * 100) : 0,
      cost,
      revenue,
      roas: cost > 0 ? roundRatio(revenue / cost) : 0,
    };
  });
}

function buildDateSpan(dateFrom: string, dateTo: string): string[] {
  const days = daysInclusive(dateFrom, dateTo);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(addDaysYmd(dateFrom, i));
  }
  return out;
}

async function resolveAdvertiser(accountId: string): Promise<MlAdvertiser | null> {
  try {
    const data = await ml.get<{ advertisers?: MlAdvertiser[] }>(
      accountId,
      "/advertising/advertisers?product_id=PADS",
    );
    const adv = data.advertisers?.[0];
    if (!adv?.advertiser_id) return null;
    return { advertiser_id: adv.advertiser_id, site_id: adv.site_id ?? "MLB" };
  } catch (err) {
    logger.warn({ err, accountId }, "ML Product Ads advertiser lookup failed");
    return null;
  }
}

async function fetchCampaignsPage(
  accountId: string,
  advertiserId: number,
  siteId: string,
  dateFrom: string,
  dateTo: string,
  offset: number,
): Promise<MlCampaignsResponse> {
  const qs = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
    metrics: METRICS,
    limit: String(CAMPAIGN_PAGE_LIMIT),
    offset: String(offset),
  });

  try {
    return await ml.getWithHeaders<MlCampaignsResponse>(
      accountId,
      `/advertising/advertisers/${advertiserId}/product_ads/campaigns?${qs.toString()}`,
      { "api-version": "2" },
    );
  } catch (primaryErr) {
    logger.warn(
      { err: primaryErr, accountId, advertiserId },
      "ML campaigns v2 path failed; trying marketplace search",
    );
    return ml.get<MlCampaignsResponse>(
      accountId,
      `/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${advertiserId}/product_ads/campaigns/search?${qs.toString()}`,
    );
  }
}

async function fetchAllCampaigns(
  accountId: string,
  advertiserId: number,
  siteId: string,
  dateFrom: string,
  dateTo: string,
): Promise<MlCampaignRow[]> {
  const all: MlCampaignRow[] = [];
  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page++) {
    const offset = page * CAMPAIGN_PAGE_LIMIT;
    const data = await fetchCampaignsPage(accountId, advertiserId, siteId, dateFrom, dateTo, offset);
    const rows = (data.results ?? []).filter((r): r is MlCampaignRow => "id" in r || "name" in r);
    all.push(...rows);
    const total = data.paging?.total ?? all.length;
    if (all.length >= total || rows.length < CAMPAIGN_PAGE_LIMIT) break;
  }
  return all;
}

function normalizeDailyDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function accumulateDailyRow(
  byDate: Map<string, { cost: number; revenue: number }>,
  row: MlDailyRow & Record<string, unknown>,
): void {
  const date =
    normalizeDailyDate(row.date) ??
    normalizeDailyDate(row.day) ??
    normalizeDailyDate((row as { date_from?: string }).date_from);
  if (!date) return;
  const cost = num(row.cost ?? row.spend ?? row.metrics?.cost ?? row.metrics?.spend);
  const revenue = num(row.total_amount ?? row.metrics?.total_amount);
  if (cost === 0 && revenue === 0) return;
  const prev = byDate.get(date) ?? { cost: 0, revenue: 0 };
  byDate.set(date, { cost: prev.cost + cost, revenue: prev.revenue + revenue });
}

async function fetchMetricsSummary(
  accountId: string,
  advertiserId: number,
  siteId: string,
  dateFrom: string,
  dateTo: string,
): Promise<AdsKpis> {
  const qs = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
    metrics: METRICS,
    metrics_summary: "true",
    limit: "1",
    offset: "0",
  });
  try {
    const data = await ml.getWithHeaders<MlCampaignsResponse>(
      accountId,
      `/advertising/advertisers/${advertiserId}/product_ads/campaigns?${qs.toString()}`,
      { "api-version": "2" },
    );
    if (data.metrics_summary) {
      return finalizeKpis(metricsToPartial(data.metrics_summary));
    }
    const first = data.results?.[0] as MlCampaignRow | undefined;
    if (first?.metrics_summary) {
      return finalizeKpis(metricsToPartial(first.metrics_summary));
    }
  } catch (err) {
    logger.warn({ err, accountId, advertiserId }, "ML Product Ads metrics_summary failed");
  }

  // Fallback: soma das campanhas do período anterior
  try {
    const rows = await fetchAllCampaigns(accountId, advertiserId, siteId, dateFrom, dateTo);
    return finalizeKpis(
      rows.reduce(
        (acc, row) => {
          const m = metricsToPartial(row.metrics ?? row.metrics_summary);
          return {
            impressions: acc.impressions + m.impressions,
            clicks: acc.clicks + m.clicks,
            cost: acc.cost + m.cost,
            revenue: acc.revenue + m.revenue,
          };
        },
        { impressions: 0, clicks: 0, cost: 0, revenue: 0 },
      ),
    );
  } catch (err) {
    logger.warn({ err, accountId, advertiserId }, "ML Product Ads previous-period campaigns failed");
  }
  return emptyKpis();
}

async function fetchDailySeries(
  accountId: string,
  advertiserId: number,
  siteId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Map<string, { cost: number; revenue: number }>> {
  const byDate = new Map<string, { cost: number; revenue: number }>();
  const qsBase = {
    date_from: dateFrom,
    date_to: dateTo,
    metrics: "cost,total_amount,clicks,prints",
    aggregation_type: "DAILY",
    limit: String(CAMPAIGN_PAGE_LIMIT),
  };

  const paths = [
    (offset: number) => {
      const qs = new URLSearchParams({ ...qsBase, offset: String(offset) });
      return {
        path: `/advertising/advertisers/${advertiserId}/product_ads/campaigns?${qs.toString()}`,
        headers: { "api-version": "2" } as Record<string, string>,
      };
    },
    (offset: number) => {
      const qs = new URLSearchParams({ ...qsBase, offset: String(offset) });
      return {
        path: `/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${advertiserId}/product_ads/campaigns/search?${qs.toString()}`,
        headers: {} as Record<string, string>,
      };
    },
  ];

  for (const build of paths) {
    byDate.clear();
    try {
      for (let page = 0; page < MAX_CAMPAIGN_PAGES; page++) {
        const offset = page * CAMPAIGN_PAGE_LIMIT;
        const { path, headers } = build(offset);
        const data =
          Object.keys(headers).length > 0
            ? await ml.getWithHeaders<MlCampaignsResponse>(accountId, path, headers)
            : await ml.get<MlCampaignsResponse>(accountId, path);
        const rows = data.results ?? [];
        for (const row of rows) {
          accumulateDailyRow(byDate, row as MlDailyRow & Record<string, unknown>);
          // Alguns payloads aninham série diária em `metrics`/`values`
          const nested = (row as { values?: unknown[]; metrics?: unknown }).values;
          if (Array.isArray(nested)) {
            for (const point of nested) {
              if (point && typeof point === "object") {
                accumulateDailyRow(byDate, point as MlDailyRow & Record<string, unknown>);
              }
            }
          }
        }
        const total = data.paging?.total ?? rows.length;
        if ((page + 1) * CAMPAIGN_PAGE_LIMIT >= total || rows.length < CAMPAIGN_PAGE_LIMIT) break;
      }
      if (byDate.size > 0) return byDate;
    } catch (err) {
      logger.warn({ err, accountId, advertiserId }, "ML Product Ads daily metrics attempt failed");
    }
  }

  return byDate;
}

function mapCampaigns(accountId: string, rows: MlCampaignRow[]): AdsCampaignRow[] {
  return rows
    .map((row) => {
      const m = metricsToPartial(row.metrics ?? row.metrics_summary);
      const cost = roundMoney(m.cost);
      const revenue = roundMoney(m.revenue);
      const clicks = Math.round(m.clicks);
      const impressions = Math.round(m.impressions);
      const roasFromApi = row.metrics?.roas != null ? num(row.metrics.roas) : null;
      const roas = roasFromApi != null && roasFromApi > 0
        ? roundRatio(roasFromApi)
        : cost > 0
          ? roundRatio(revenue / cost)
          : 0;
      const cpcFromApi = row.metrics?.cpc != null ? num(row.metrics.cpc) : null;
      const cpc = cpcFromApi != null && cpcFromApi > 0
        ? roundMoney(cpcFromApi)
        : clicks > 0
          ? roundMoney(cost / clicks)
          : 0;
      const roasTarget = resolveRoasTarget(row);
      const alertBucket = classifyCampaign(cost, revenue, roas, roasTarget);
      const id = row.id != null ? String(row.id) : `${accountId}-${row.name ?? "campaign"}`;
      return {
        id,
        name: row.name?.trim() || `Campanha ${id}`,
        status: row.status ?? null,
        accountId,
        cost,
        revenue,
        roas,
        clicks,
        impressions,
        cpc,
        roasTarget,
        alertBucket,
      };
    })
    .filter((c) => c.cost > 0 || c.revenue > 0 || c.clicks > 0 || c.impressions > 0 || Boolean(c.status));
}

async function fetchOverviewForAccount(
  accountId: string,
  dateFrom: string,
  dateTo: string,
  previousDateFrom: string,
  previousDateTo: string,
): Promise<{
  available: boolean;
  message: string | null;
  campaigns: AdsCampaignRow[];
  kpis: AdsKpis;
  previousKpis: AdsKpis;
  daily: Map<string, { cost: number; revenue: number }>;
} | null> {
  const adv = await resolveAdvertiser(accountId);
  if (!adv?.advertiser_id) {
    return {
      available: false,
      message: "Conta sem Product Ads ativo (advertiser PADS não encontrado).",
      campaigns: [],
      kpis: emptyKpis(),
      previousKpis: emptyKpis(),
      daily: new Map(),
    };
  }

  const advertiserId = adv.advertiser_id;
  const siteId = adv.site_id ?? "MLB";

  try {
    const [campaignRows, previousKpis, daily] = await Promise.all([
      fetchAllCampaigns(accountId, advertiserId, siteId, dateFrom, dateTo),
      fetchMetricsSummary(accountId, advertiserId, siteId, previousDateFrom, previousDateTo),
      fetchDailySeries(accountId, advertiserId, siteId, dateFrom, dateTo),
    ]);

    const campaigns = mapCampaigns(accountId, campaignRows);
    const kpis = finalizeKpis(
      campaigns.reduce(
        (acc, c) => ({
          impressions: acc.impressions + c.impressions,
          clicks: acc.clicks + c.clicks,
          cost: acc.cost + c.cost,
          revenue: acc.revenue + c.revenue,
        }),
        { impressions: 0, clicks: 0, cost: 0, revenue: 0 },
      ),
    );

    return {
      available: true,
      message: null,
      campaigns,
      kpis,
      previousKpis,
      daily,
    };
  } catch (err) {
    logger.warn({ err, accountId }, "ML Product Ads overview fetch failed");
    return {
      available: false,
      message: "Não foi possível obter métricas de Product Ads. Verifique permissões da integração ML.",
      campaigns: [],
      kpis: emptyKpis(),
      previousKpis: emptyKpis(),
      daily: new Map(),
    };
  }
}

export function defaultAdsDateRange(): { dateFrom: string; dateTo: string } {
  const today = todayYmdSp();
  const p = parseYmd(today)!;
  const dateFrom = `${p.y}-${String(p.m).padStart(2, "0")}-01`;
  return { dateFrom, dateTo: today };
}

export function resolveAdsDateRange(
  dateFromRaw?: string | null,
  dateToRaw?: string | null,
): { dateFrom: string; dateTo: string; previousDateFrom: string; previousDateTo: string } {
  const defaults = defaultAdsDateRange();
  let dateFrom = dateFromRaw && parseYmd(dateFromRaw) ? dateFromRaw : defaults.dateFrom;
  let dateTo = dateToRaw && parseYmd(dateToRaw) ? dateToRaw : defaults.dateTo;
  if (dateFrom > dateTo) {
    const tmp = dateFrom;
    dateFrom = dateTo;
    dateTo = tmp;
  }
  // ML metrics endpoints typically allow up to 90 days
  const span = daysInclusive(dateFrom, dateTo);
  if (span > 90) {
    dateFrom = addDaysYmd(dateTo, -89);
  }
  const previousDateTo = addDaysYmd(dateFrom, -1);
  const previousDateFrom = addDaysYmd(previousDateTo, -(span - 1));
  return { dateFrom, dateTo, previousDateFrom, previousDateTo };
}

export async function fetchAdsOverviewAggregated(
  accountIds: string[],
  dateFromRaw?: string | null,
  dateToRaw?: string | null,
): Promise<AdsOverview> {
  const { dateFrom, dateTo, previousDateFrom, previousDateTo } = resolveAdsDateRange(
    dateFromRaw,
    dateToRaw,
  );

  if (accountIds.length === 0) {
    return {
      available: false,
      message: "Conecte uma conta do Mercado Livre para ver Gestão Ads.",
      dateFrom,
      dateTo,
      previousDateFrom,
      previousDateTo,
      kpis: emptyKpis(),
      previousKpis: emptyKpis(),
      kpiDeltas: {
        impressions: null,
        clicks: null,
        cost: null,
        revenue: null,
        cpc: null,
        roas: null,
      },
      alerts: buildAlerts([]),
      daily: buildDateSpan(dateFrom, dateTo).map((date) => ({ date, cost: 0, revenue: 0 })),
      campaigns: [],
      manageUrl: MANAGE_URL,
    };
  }

  const parts = await Promise.all(
    accountIds.map((id) =>
      fetchOverviewForAccount(id, dateFrom, dateTo, previousDateFrom, previousDateTo),
    ),
  );

  const availableParts = parts.filter((p): p is NonNullable<typeof p> => p != null && p.available);
  if (availableParts.length === 0) {
    return {
      available: false,
      message:
        parts.find((p) => p?.message)?.message ??
        "Conecte uma conta com Product Ads ativo para ver o dashboard.",
      dateFrom,
      dateTo,
      previousDateFrom,
      previousDateTo,
      kpis: emptyKpis(),
      previousKpis: emptyKpis(),
      kpiDeltas: {
        impressions: null,
        clicks: null,
        cost: null,
        revenue: null,
        cpc: null,
        roas: null,
      },
      alerts: buildAlerts([]),
      daily: buildDateSpan(dateFrom, dateTo).map((date) => ({ date, cost: 0, revenue: 0 })),
      campaigns: [],
      manageUrl: MANAGE_URL,
    };
  }

  const campaigns = availableParts
    .flatMap((p) => p.campaigns)
    .sort((a, b) => b.cost - a.cost);

  const kpis = finalizeKpis(
    availableParts.reduce(
      (acc, p) => ({
        impressions: acc.impressions + p.kpis.impressions,
        clicks: acc.clicks + p.kpis.clicks,
        cost: acc.cost + p.kpis.cost,
        revenue: acc.revenue + p.kpis.revenue,
      }),
      { impressions: 0, clicks: 0, cost: 0, revenue: 0 },
    ),
  );

  const previousKpis = finalizeKpis(
    availableParts.reduce(
      (acc, p) => ({
        impressions: acc.impressions + p.previousKpis.impressions,
        clicks: acc.clicks + p.previousKpis.clicks,
        cost: acc.cost + p.previousKpis.cost,
        revenue: acc.revenue + p.previousKpis.revenue,
      }),
      { impressions: 0, clicks: 0, cost: 0, revenue: 0 },
    ),
  );

  const dailyMap = new Map<string, { cost: number; revenue: number }>();
  for (const part of availableParts) {
    for (const [date, vals] of part.daily) {
      const prev = dailyMap.get(date) ?? { cost: 0, revenue: 0 };
      dailyMap.set(date, {
        cost: prev.cost + vals.cost,
        revenue: prev.revenue + vals.revenue,
      });
    }
  }

  const daily = buildDateSpan(dateFrom, dateTo).map((date) => {
    const vals = dailyMap.get(date) ?? { cost: 0, revenue: 0 };
    return {
      date,
      cost: roundMoney(vals.cost),
      revenue: roundMoney(vals.revenue),
    };
  });

  return {
    available: true,
    message: null,
    dateFrom,
    dateTo,
    previousDateFrom,
    previousDateTo,
    kpis,
    previousKpis,
    kpiDeltas: {
      impressions: pctDelta(kpis.impressions, previousKpis.impressions),
      clicks: pctDelta(kpis.clicks, previousKpis.clicks),
      cost: pctDelta(kpis.cost, previousKpis.cost),
      revenue: pctDelta(kpis.revenue, previousKpis.revenue),
      cpc: pctDelta(kpis.cpc, previousKpis.cpc),
      roas: pctDelta(kpis.roas, previousKpis.roas),
    },
    alerts: buildAlerts(campaigns),
    daily,
    campaigns,
    manageUrl: MANAGE_URL,
  };
}
