import { getDb } from "./db";
import { accountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const ML_BASE_URL = "https://api.mercadolibre.com";
const ML_AUTH_URL = "https://auth.mercadolivre.com.br";
const ML_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export function getMlAuthUrl(state: string): string {
  const clientId = process.env.ML_CLIENT_ID;
  const redirectUri = process.env.ML_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error("ML_CLIENT_ID and ML_REDIRECT_URI must be set");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${ML_AUTH_URL}/authorization?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  token_type: string;
  scope: string;
}> {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("ML credentials not configured");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${ML_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ML token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: number;
    token_type: string;
    scope: string;
  }>;
}

async function refreshAccessToken(accountId: string): Promise<string> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));

  if (!account?.refreshToken) {
    throw new Error("No refresh token available");
  }

  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ML credentials not configured");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: account.refreshToken,
  });

  const res = await fetch(`${ML_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn({ accountId, status: res.status }, "ML token refresh failed");
    await db
      .update(accountsTable)
      .set({ isActive: false })
      .where(eq(accountsTable.id, accountId));
    throw new Error(`ML token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await db
    .update(accountsTable)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: expiresAt,
    })
    .where(eq(accountsTable.id, accountId));

  return data.access_token;
}

async function getValidToken(accountId: string): Promise<string> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));

  if (!account) throw new Error("Account not found");
  if (!account.isActive) throw new Error("Account is inactive");

  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (!account.tokenExpiresAt || account.tokenExpiresAt < fiveMinFromNow) {
    return refreshAccessToken(accountId);
  }

  return account.accessToken!;
}

async function mlFetch<T>(
  accountId: string,
  path: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<T> {
  const token = await getValidToken(accountId);
  const url = path.startsWith("http") ? path : `${ML_BASE_URL}${path}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      await new Promise((r) => setTimeout(r, delay));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(options.headers as Record<string, string>),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.status === 429) {
        lastError = new Error("Rate limited by Mercado Livre");
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ML API ${res.status}: ${text}`);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err as Error;
      if ((err as Error).name === "AbortError") {
        lastError = new Error("ML API request timed out");
      }
      if (attempt === retries - 1) break;
    }
  }

  throw lastError ?? new Error("ML API request failed");
}

export const ml = {
  get: <T>(accountId: string, path: string) =>
    mlFetch<T>(accountId, path, { method: "GET" }),

  post: <T>(accountId: string, path: string, body: unknown) =>
    mlFetch<T>(accountId, path, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  put: <T>(accountId: string, path: string, body: unknown) =>
    mlFetch<T>(accountId, path, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

export type MlUser = {
  id: number;
  nickname: string;
  email: string;
};

/** Item or variation attribute row (e.g. id SELLER_SKU, value_name = SKU). */
export type MlAttributeRow = {
  id?: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
};

export type MlItem = {
  id: string;
  title: string;
  price: number;
  original_price?: number | null;
  /** Reference price before deals; often present when `price` is a promotional sale price. */
  base_price?: number | null;
  available_quantity: number;
  sold_quantity: number;
  status: string;
  listing_type_id: string;
  shipping: {
    logistic_type: string;
    /** Shipping-level tags — "self_service_in" signals Flex/Coleta logistics. */
    tags?: string[] | null;
  };
  seller_custom_field?: string | null;
  /** Root-level attributes on GET /items/{id} (SELLER_SKU for listings without variations). */
  attributes?: MlAttributeRow[] | null;
  thumbnail: string;
  permalink: string;
  category_id: string;
  /** Present on GET /items — true for user products linked to Mercado Livre catalog. */
  catalog_listing?: boolean;
  variations?: MlVariation[];
};

/**
 * Fallback list price from GET /items (not /prices) when syncing DB `original_price`.
 */
export function getMlOriginalListPrice(item: {
  price: number;
  original_price?: number | null;
  base_price?: number | null;
}): string | null {
  const sale = item.price;
  if (item.original_price != null && item.original_price > sale) {
    return item.original_price.toString();
  }
  if (item.base_price != null && item.base_price > sale) {
    return item.base_price.toString();
  }
  return null;
}

/** Row from GET https://api.mercadolibre.com/items/{ITEM_ID}/prices → `prices[]`. */
export type MlItemPriceRow = {
  id?: string;
  type?: string | null;
  amount?: number | null;
  regular_amount?: number | null;
  currency_id?: string | null;
  conditions?: {
    context_restrictions?: string[] | null;
    start_time?: string | null;
    end_time?: string | null;
  } | null;
};

export type MlItemPricesResponse = {
  id?: string;
  prices?: MlItemPriceRow[] | null;
};

function mlPriceRowAppliesToMarketplace(row: MlItemPriceRow): boolean {
  const restrictions = row.conditions?.context_restrictions;
  if (!restrictions || restrictions.length === 0) return true;
  return restrictions.includes("channel_marketplace");
}

function isMlPromotionPriceRow(row: MlItemPriceRow): boolean {
  const a = row.amount;
  const r = row.regular_amount;
  return typeof a === "number" && typeof r === "number" && r > a;
}

/**
 * Derives DB columns `amount` and `regular_amount` from
 * GET /items/{id}/prices → `prices[].amount` and `prices[].regular_amount`
 * (marketplace context; best promotion = lowest `amount`).
 */
export function resolveProductPricesFromMlPricesApi(
  data: MlItemPricesResponse,
): { amount: string; regularAmount: string | null } | null {
  const applicable = (data.prices ?? []).filter(mlPriceRowAppliesToMarketplace);
  if (applicable.length === 0) return null;

  const promos = applicable.filter(
    (row) => (row.type === "promotion" || row.type == null) && isMlPromotionPriceRow(row),
  );

  if (promos.length > 0) {
    const best = promos.reduce((a, b) => ((a.amount as number) <= (b.amount as number) ? a : b));
    return {
      amount: String(best.amount),
      regularAmount: String(best.regular_amount),
    };
  }

  const standard = applicable.find(
    (row) => row.type === "standard" && typeof row.amount === "number",
  );
  if (standard && typeof standard.amount === "number") {
    return { amount: String(standard.amount), regularAmount: null };
  }

  const anyAmount = applicable.find((row) => typeof row.amount === "number");
  if (anyAmount && typeof anyAmount.amount === "number") {
    return { amount: String(anyAmount.amount), regularAmount: null };
  }

  return null;
}

export async function fetchMlItemPrices(
  accountId: string,
  itemId: string,
): Promise<MlItemPricesResponse> {
  return ml.get<MlItemPricesResponse>(
    accountId,
    `/items/${encodeURIComponent(itemId)}/prices`,
  );
}

export type MlVariation = {
  id: number;
  price: number;
  available_quantity: number;
  sold_quantity: number;
  seller_custom_field?: string | null;
  /** Some API responses expose SKU here. */
  seller_sku?: string | null;
  /**
   * Per-variation attributes from GET /items/{id}/variations (e.g. SELLER_SKU).
   * Multiget /items?ids= often omits these.
   */
  attributes?: MlAttributeRow[] | null;
  attribute_combinations?: Array<{
    id: string;
    name: string;
    value_id: string;
    value_name: string;
  }>;
  picture_ids?: string[];
};

function trimNonEmpty(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Derive all applicable logistic types for storage/display.
 * A product can simultaneously have a shipping.logistic_type (e.g. "fulfillment")
 * AND the "self_service_in" tag. Both are collected and returned as a
 * comma-separated string so multiple badges can be rendered.
 * Examples: "fulfillment" | "self_service_in" | "fulfillment,self_service_in"
 */
export function getMlEffectiveLogisticType(item: MlItem): string | null {
  const types: string[] = [];
  const shippingType = item.shipping?.logistic_type;
  if (shippingType) types.push(shippingType);
  // "self_service_in" lives in shipping.tags, not root-level tags.
  if (Array.isArray(item.shipping?.tags) && item.shipping.tags!.includes("self_service_in")) {
    if (!types.includes("self_service_in")) types.push("self_service_in");
  }
  return types.length > 0 ? types.join(",") : null;
}

const SKU_ATTR_ID = "SELLER_SKU";
/** Names that ML uses in different locales/contexts for the seller SKU attribute. */
const SKU_ATTR_NAME_RE = /\bSKU\b|SELLER[_ ]?SKU|SKU\s*do\s*vendedor|C[oó]digo\s*(SKU|do\s*vendedor)/i;

export function getMlSellerSkuFromAttributes(attrs?: MlAttributeRow[] | null): string | null {
  if (!attrs) return null;
  // First pass: strict id match — the most reliable signal
  for (const a of attrs) {
    if (a.id === SKU_ATTR_ID) {
      const s = trimNonEmpty(a.value_name);
      if (s) return s;
    }
  }
  // Second pass: name-based match for accounts where ML returns a different attribute id
  for (const a of attrs) {
    if (a.name && SKU_ATTR_NAME_RE.test(a.name)) {
      const s = trimNonEmpty(a.value_name);
      if (s) return s;
    }
  }
  return null;
}

/**
 * ML stores the stock code in seller_custom_field and/or the SELLER_SKU attribute
 * (variation `attributes` or `attribute_combinations`). These are not interchangeable in their API.
 */
export function getMlVariationSku(v: MlVariation): string | null {
  const fromCustom = trimNonEmpty(v.seller_custom_field);
  if (fromCustom) return fromCustom;
  const fromSellerSku = trimNonEmpty(v.seller_sku);
  if (fromSellerSku) return fromSellerSku;
  // Check per-variation attributes (available from /items/{id}/variations endpoint)
  const fromAttrs = getMlSellerSkuFromAttributes(v.attributes ?? undefined);
  if (fromAttrs) return fromAttrs;
  // Check attribute_combinations by strict id first, then name-based fallback
  const combos = v.attribute_combinations ?? [];
  const byId = combos.find((x) => x.id === SKU_ATTR_ID);
  if (byId) return trimNonEmpty(byId.value_name);
  // Name-based fallback for attribute_combinations (handles name === value_name ML quirk)
  const byName = combos.find((x) => x.name && SKU_ATTR_NAME_RE.test(x.name));
  return trimNonEmpty(byName?.value_name) ?? null;
}

/** Item-level custom field, SELLER_SKU on the item, or first variation SKU. */
export function getMlItemRepresentativeSku(item: MlItem): string | null {
  const fromCustom = trimNonEmpty(item.seller_custom_field);
  if (fromCustom) return fromCustom;
  const fromAttr = getMlSellerSkuFromAttributes(item.attributes ?? undefined);
  if (fromAttr) return fromAttr;
  const vars = item.variations;
  if (!Array.isArray(vars) || vars.length === 0) return null;
  for (const v of vars) {
    const s = getMlVariationSku(v);
    if (s) return s;
  }
  return null;
}

/** Prefer detailed variation payload (from /items/{id}/variations) for SKU-related fields. */
export function mergeMlVariation(batch: MlVariation, detailed?: MlVariation): MlVariation {
  if (!detailed) return batch;
  const combinations =
    detailed.attribute_combinations?.length ? detailed.attribute_combinations : batch.attribute_combinations;
  return {
    ...batch,
    ...detailed,
    attribute_combinations: combinations,
  };
}

/**
 * GET /items/{id}/variations returns each variation with `attributes` (SELLER_SKU), which multiget often skips.
 */
export async function fetchMlItemVariations(accountId: string, itemId: string): Promise<MlVariation[]> {
  const path = `/items/${encodeURIComponent(itemId)}/variations`;
  try {
    const data = await ml.get<unknown>(accountId, path);
    if (Array.isArray(data)) return data as MlVariation[];
    if (
      data &&
      typeof data === "object" &&
      "variations" in data &&
      Array.isArray((data as { variations: unknown }).variations)
    ) {
      return (data as { variations: MlVariation[] }).variations;
    }
    return [];
  } catch (err) {
    logger.warn({ err, itemId }, "ML fetch /items/.../variations failed");
    return [];
  }
}

/** Multiget may omit item `attributes`; fetch full item when we still have no SKU (no variations). */
export async function enrichMlItemForSellerSku(accountId: string, item: MlItem): Promise<MlItem> {
  const hasVariations = Array.isArray(item.variations) && item.variations.length > 0;
  if (hasVariations) return item;
  if (getMlItemRepresentativeSku(item) !== null) return item;
  try {
    return await ml.get<MlItem>(accountId, `/items/${encodeURIComponent(item.id)}`);
  } catch (err) {
    logger.warn({ err, itemId: item.id }, "ML fetch full item for SELLER_SKU failed");
    return item;
  }
}

/**
 * The multiget batch endpoint (/items?ids=...) does not return the `tags` field.
 * When `tags` is missing (null/undefined) on an item, fetch the individual endpoint
 * to obtain it. Returns the full individual item (which has tags) or the original
 * item on failure.
 */
export async function enrichMlItemWithTags(accountId: string, item: MlItem): Promise<MlItem> {
  // shipping.tags is the correct field (self_service_in lives there, not root-level tags).
  // Batch endpoint may strip shipping.tags; fetch individual if missing.
  if (Array.isArray(item.shipping?.tags)) return item;
  try {
    return await ml.get<MlItem>(accountId, `/items/${encodeURIComponent(item.id)}`);
  } catch (err) {
    logger.warn({ err, itemId: item.id }, "ML fetch full item for tags failed");
    return item;
  }
}

/**
 * Multiget GET /items?ids= often omits `catalog_listing` (always falsy via !!undefined in DB).
 * GET /items/{id} includes it. No-op when the batch payload already has `true`.
 */
export async function enrichMlItemCatalogListing(accountId: string, item: MlItem): Promise<MlItem> {
  if (item.catalog_listing === true) return item;
  try {
    const full = await ml.get<MlItem>(accountId, `/items/${encodeURIComponent(item.id)}`);
    return { ...item, catalog_listing: full.catalog_listing };
  } catch (err) {
    logger.warn({ err, itemId: item.id }, "ML fetch full item for catalog_listing failed");
    return item;
  }
}

/**
 * Consolidates enrichMlItemWithTags + enrichMlItemCatalogListing into a single
 * GET /items/{id} call when either field is missing, avoiding duplicate fetches.
 */
export async function enrichMlItem(accountId: string, item: MlItem): Promise<MlItem> {
  const needsTags = !Array.isArray(item.shipping?.tags);
  const needsCatalog = item.catalog_listing !== true;
  if (!needsTags && !needsCatalog) return item;
  try {
    const full = await ml.get<MlItem>(accountId, `/items/${encodeURIComponent(item.id)}`);
    return {
      ...item,
      ...(needsTags ? { shipping: full.shipping } : {}),
      ...(needsCatalog ? { catalog_listing: full.catalog_listing } : {}),
    };
  } catch (err) {
    logger.warn({ err, itemId: item.id }, "ML fetch full item for enrichment failed");
    return item;
  }
}

/**
 * Batch-fetch prices from GET /items/prices?ids=... (up to 20 IDs per call).
 * Returns a Map of itemId → { amount, regularAmount } as decimal strings,
 * using the same promotion-aware resolution logic as the individual endpoint.
 * Falls back to empty map entries on error so sync continues uninterrupted.
 */
export async function fetchMlItemPricesBatch(
  accountId: string,
  itemIds: string[],
): Promise<Map<string, { amount: string | null; regularAmount: string | null }>> {
  const out = new Map<string, { amount: string | null; regularAmount: string | null }>();
  if (itemIds.length === 0) return out;
  try {
    const data = await ml.get<MlItemPricesResponse[]>(
      accountId,
      `/items/prices?ids=${itemIds.join(",")}`,
    );
    for (const entry of data) {
      if (!entry.id) continue;
      const resolved = resolveProductPricesFromMlPricesApi(entry);
      out.set(entry.id, {
        amount: resolved?.amount ?? null,
        regularAmount: resolved?.regularAmount ?? null,
      });
    }
  } catch (err) {
    logger.warn({ err, itemIds }, "ML fetch /items/prices batch failed");
  }
  return out;
}

export type MlOrder = {
  id: number;
  status: string;
  total_amount: number;
  currency_id: string;
  buyer: { id: number; nickname: string };
  shipping: { id: number; status: string };
  date_created: string;
  date_closed: string;
  order_items: Array<{
    item: { id: string; title: string };
    quantity: number;
    unit_price: number;
  }>;
};

export type MlQuestion = {
  id: number;
  item_id: string;
  text: string;
  status: string;
  from: { id: number; nickname: string };
  answer?: { text: string; date_created: string };
  date_created: string;
};
