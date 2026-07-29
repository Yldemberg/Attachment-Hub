import { getDb } from "./db";
import { accountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const SP_API_BASE_URL = "https://sellingpartnerapi-na.amazon.com";
const AMAZON_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export const AMAZON_BR_MARKETPLACE_ID = "A2Q3Y263D00KWC";

export function getAmazonMarketplaceId(): string {
  return process.env.AMAZON_MARKETPLACE_ID?.trim() || AMAZON_BR_MARKETPLACE_ID;
}

/** Credenciais do app LWA (compartilhadas entre todas as lojas / CNPJs). */
export function getAmazonLwaAppCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.AMAZON_LWA_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.AMAZON_LWA_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "Amazon SP-API não configurada: defina AMAZON_LWA_CLIENT_ID e AMAZON_LWA_CLIENT_SECRET",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Credenciais padrão via env (1ª loja / legado).
 * Lojas adicionais usam refresh token + seller id no body do connect (mesmo app LWA).
 */
export function getAmazonEnvCredentials(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sellerId: string;
  marketplaceId: string;
} {
  const { clientId, clientSecret } = getAmazonLwaAppCredentials();
  const refreshToken = process.env.AMAZON_REFRESH_TOKEN?.trim() ?? "";
  const sellerId = process.env.AMAZON_SELLER_ID?.trim() ?? "";
  if (!refreshToken) {
    throw new Error(
      "Amazon SP-API: defina AMAZON_REFRESH_TOKEN ou informe refreshToken no connect da conta",
    );
  }
  if (!sellerId) {
    throw new Error(
      "Amazon SP-API: defina AMAZON_SELLER_ID ou informe sellerId no connect da conta",
    );
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    sellerId,
    marketplaceId: getAmazonMarketplaceId(),
  };
}

/** Seller Central BR — Website Authorization Workflow (app público). */
export const AMAZON_BR_SELLER_CENTRAL_ORIGIN = "https://sellercentral.amazon.com.br";

/**
 * Application ID do app SP-API (ex.: amzn1.sp.solution.…).
 * Obrigatório para OAuth estilo “Conectar → autorizar no browser”.
 */
export function getAmazonApplicationId(): string {
  const id = process.env.AMAZON_APPLICATION_ID?.trim() ?? "";
  if (!id) {
    throw new Error(
      "Amazon OAuth: defina AMAZON_APPLICATION_ID (Application ID do app público no Developer Central)",
    );
  }
  return id;
}

/**
 * Redirect URI registrado no app Amazon.
 * Prefira AMAZON_REDIRECT_URI em produção para bater exatamente com o cadastro.
 */
export function resolveAmazonOAuthRedirectUri(requestBuiltUri?: string): string {
  const fromEnv = process.env.AMAZON_REDIRECT_URI?.trim() ?? "";
  if (fromEnv) return fromEnv;
  if (requestBuiltUri?.trim()) return requestBuiltUri.trim();
  throw new Error(
    "Amazon OAuth: defina AMAZON_REDIRECT_URI (ex.: https://seu-dominio/api/amazon/callback)",
  );
}

/** draft/beta enquanto o app público não está publicado. */
export function isAmazonOAuthDraftMode(): boolean {
  const raw = (process.env.AMAZON_OAUTH_DRAFT ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

/**
 * URL de consentimento no Seller Central (Website Authorization Workflow).
 * @see https://developer-docs.amazon.com/sp-api/docs/website-authorization-workflow
 */
export function getAmazonAuthUrl(state: string, redirectUri?: string): string {
  const applicationId = getAmazonApplicationId();
  // redirectUri validado para falhar cedo se o env estiver incompleto (Amazon usa o cadastrado no app)
  resolveAmazonOAuthRedirectUri(redirectUri);

  const params = new URLSearchParams({
    application_id: applicationId,
    state,
  });
  if (isAmazonOAuthDraftMode()) {
    params.set("version", "beta");
  }
  return `${AMAZON_BR_SELLER_CENTRAL_ORIGIN}/apps/authorize/consent?${params.toString()}`;
}

/**
 * Troca spapi_oauth_code → access + refresh token (LWA authorization_code).
 */
export async function exchangeAmazonAuthorizationCode(
  code: string,
  redirectUri: string,
): Promise<LwaTokenResponse & { refresh_token: string }> {
  const { clientId, clientSecret } = getAmazonLwaAppCredentials();
  const resolvedRedirect = resolveAmazonOAuthRedirectUri(redirectUri);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: resolvedRedirect,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amazon LWA authorization_code exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as LwaTokenResponse;
  if (!data.refresh_token) {
    throw new Error("Amazon LWA não retornou refresh_token no authorization_code exchange");
  }
  return data as LwaTokenResponse & { refresh_token: string };
}

export type AmazonMarketplaceParticipation = {
  marketplace: {
    id: string;
    countryCode: string;
    name: string;
    defaultCurrencyCode: string;
    defaultLanguageCode: string;
    domainName: string;
  };
  storeName?: string;
  participation: {
    isParticipating: boolean;
    hasSuspendedListings: boolean;
  };
};

type LwaTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
};

export async function exchangeRefreshTokenForAccess(
  refreshToken: string,
  clientId?: string,
  clientSecret?: string,
): Promise<LwaTokenResponse> {
  const id = clientId ?? process.env.AMAZON_LWA_CLIENT_ID?.trim();
  const secret = clientSecret ?? process.env.AMAZON_LWA_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new Error("AMAZON_LWA_CLIENT_ID / AMAZON_LWA_CLIENT_SECRET não configurados");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secret,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amazon LWA token exchange failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<LwaTokenResponse>;
}

async function refreshAccessToken(accountId: string): Promise<string> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));

  if (!account) throw new Error("Account not found");

  const lwa = getAmazonLwaAppCredentials();
  const refreshToken =
    account.refreshToken?.trim() || process.env.AMAZON_REFRESH_TOKEN?.trim() || "";
  if (!refreshToken) {
    throw new Error("Conta Amazon sem refresh token. Reconecte a loja em Integrações.");
  }

  try {
    const data = await exchangeRefreshTokenForAccess(refreshToken, lwa.clientId, lwa.clientSecret);
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    await db
      .update(accountsTable)
      .set({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        tokenExpiresAt: expiresAt,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(accountsTable.id, accountId));
    return data.access_token;
  } catch (err) {
    logger.warn({ accountId, err }, "Amazon token refresh failed");
    await db
      .update(accountsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(accountsTable.id, accountId));
    throw err;
  }
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
  if (!account.tokenExpiresAt || account.tokenExpiresAt < fiveMinFromNow || !account.accessToken) {
    return refreshAccessToken(accountId);
  }

  return account.accessToken;
}

export async function getAmazonAccessToken(accountId: string): Promise<string> {
  return getValidToken(accountId);
}

async function amazonFetch<T>(
  accountId: string,
  path: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<T> {
  const token = await getValidToken(accountId);
  const url = path.startsWith("http") ? path : `${SP_API_BASE_URL}${path}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AMAZON_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "x-amz-access-token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(options.headers as Record<string, string>),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.status === 429) {
        lastError = new Error("Rate limited by Amazon SP-API");
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Amazon SP-API ${res.status}: ${text}`);
      }

      if (res.status === 204) {
        return undefined as T;
      }

      const text = await res.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err as Error;
      if ((err as Error).name === "AbortError") {
        lastError = new Error("Amazon SP-API request timed out");
      }
      if (attempt === retries - 1) break;
      // Don't retry deterministic client errors except 429
      if (lastError.message.includes("Amazon SP-API 4") && !lastError.message.includes("429")) {
        break;
      }
    }
  }

  throw lastError ?? new Error("Amazon SP-API request failed");
}

export const amazon = {
  get: <T>(accountId: string, path: string) =>
    amazonFetch<T>(accountId, path, { method: "GET" }),

  post: <T>(accountId: string, path: string, body: unknown) =>
    amazonFetch<T>(accountId, path, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  put: <T>(accountId: string, path: string, body: unknown) =>
    amazonFetch<T>(accountId, path, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  patch: <T>(accountId: string, path: string, body: unknown) =>
    amazonFetch<T>(accountId, path, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  delete: <T>(accountId: string, path: string) =>
    amazonFetch<T>(accountId, path, { method: "DELETE" }),
};

/** Grantless / env-token call used during connect before account row exists. */
export async function amazonFetchWithAccessToken<T>(
  accessToken: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${SP_API_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amazon SP-API ${res.status}: ${text}`);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function fetchMarketplaceParticipationsWithToken(
  accessToken: string,
): Promise<AmazonMarketplaceParticipation[]> {
  const data = await amazonFetchWithAccessToken<{ payload?: AmazonMarketplaceParticipation[] }>(
    accessToken,
    "/sellers/v1/marketplaceParticipations",
  );
  return data.payload ?? [];
}

export async function getMarketplaceParticipations(
  accountId: string,
): Promise<AmazonMarketplaceParticipation[]> {
  const data = await amazon.get<{ payload?: AmazonMarketplaceParticipation[] }>(
    accountId,
    "/sellers/v1/marketplaceParticipations",
  );
  return data.payload ?? [];
}

export type AmazonListingsItemSummary = {
  marketplaceId?: string;
  asin?: string;
  productType?: string;
  status?: string[];
  itemName?: string;
  mainImage?: { link?: string };
};

export type AmazonListingsItem = {
  sku: string;
  summaries?: AmazonListingsItemSummary[];
  attributes?: Record<string, unknown>;
  offers?: Array<{
    marketplaceId?: string;
    offerType?: string;
    price?: { currencyCode?: string; amount?: string | number };
  }>;
  fulfillmentAvailability?: Array<{
    fulfillmentChannelCode?: string;
    quantity?: number;
  }>;
};

/** Resposta de putListingsItem / patchListingsItem (HTTP 200 mesmo com INVALID). */
export type AmazonListingsIssue = {
  code?: string;
  message?: string;
  severity?: "ERROR" | "WARNING" | "INFO" | string;
  attributeNames?: string[];
  categories?: string[];
};

export type AmazonListingsSubmissionResponse = {
  sku?: string;
  status?: "ACCEPTED" | "INVALID" | "VALID" | string;
  submissionId?: string;
  issues?: AmazonListingsIssue[];
};

export function formatAmazonListingsIssues(issues: AmazonListingsIssue[] | undefined): string {
  if (!issues?.length) return "";
  return issues
    .map((issue) => {
      const attrs = issue.attributeNames?.length ? ` [${issue.attributeNames.join(", ")}]` : "";
      const sev = issue.severity ? `${issue.severity}: ` : "";
      return `${sev}${issue.message || issue.code || "problema desconhecido"}${attrs}`;
    })
    .join("; ");
}

export type AmazonListingsSearchResponse = {
  numberOfResults?: number;
  pagination?: { nextToken?: string };
  items?: AmazonListingsItem[];
};

export function resolveAmazonSellerId(account: {
  amazonSellerId?: string | null;
}): string {
  return account.amazonSellerId?.trim() || getAmazonEnvCredentials().sellerId;
}

export function listingsItemPath(
  sellerId: string,
  sku: string,
  marketplaceId: string,
  includedData?: string[],
): string {
  const params = new URLSearchParams({ marketplaceIds: marketplaceId });
  if (includedData?.length) {
    params.set("includedData", includedData.join(","));
  }
  return `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}?${params}`;
}

export async function searchListingsItems(
  accountId: string,
  sellerId: string,
  marketplaceId: string,
  nextToken?: string,
): Promise<AmazonListingsSearchResponse> {
  const params = new URLSearchParams({
    marketplaceIds: marketplaceId,
    pageSize: "20",
    includedData: "summaries,attributes,offers,fulfillmentAvailability",
  });
  if (nextToken) params.set("pageToken", nextToken);
  return amazon.get<AmazonListingsSearchResponse>(
    accountId,
    `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}?${params}`,
  );
}

export async function getListingsItem(
  accountId: string,
  sellerId: string,
  sku: string,
  marketplaceId: string,
): Promise<AmazonListingsItem> {
  return amazon.get<AmazonListingsItem>(
    accountId,
    listingsItemPath(sellerId, sku, marketplaceId, [
      "summaries",
      "attributes",
      "offers",
      "fulfillmentAvailability",
    ]),
  );
}

/** Resolve o product type oficial do ASIN no catálogo (essencial para LISTING_OFFER_ONLY). */
export async function getCatalogProductTypeForAsin(
  accountId: string,
  asin: string,
  marketplaceId: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    marketplaceIds: marketplaceId,
    includedData: "productTypes,summaries",
  });
  try {
    const data = await amazon.get<{
      productTypes?: Array<{ marketplaceId?: string; productType?: string }>;
      summaries?: Array<{ productType?: string; marketplaceId?: string }>;
    }>(
      accountId,
      `/catalog/2022-04-01/items/${encodeURIComponent(asin)}?${params}`,
    );
    const fromTypes = data.productTypes?.find((p) => p.productType)?.productType;
    if (fromTypes) return fromTypes;
    const fromSummary = data.summaries?.find((s) => s.productType)?.productType;
    return fromSummary ?? null;
  } catch (err) {
    logger.warn(
      { asin, err: err instanceof Error ? err.message : String(err) },
      "Amazon catalog productType lookup failed",
    );
    return null;
  }
}

export type AmazonProductTypeOption = {
  name: string;
  displayName?: string;
};

export type AmazonBrowseNodeOption = {
  id: string;
  name: string;
};

const browseNodeCache = new Map<
  string,
  { expiresAt: number; nodes: AmazonBrowseNodeOption[] }
>();
const BROWSE_NODE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Extrai enums de recommended_browse_nodes do schema JSON do product type. */
function extractBrowseNodesFromSchema(schema: {
  properties?: Record<string, unknown>;
}): AmazonBrowseNodeOption[] {
  const prop = schema.properties?.recommended_browse_nodes as
    | {
        items?: {
          properties?: {
            value?: {
              anyOf?: Array<{ enum?: string[]; enumNames?: string[] }>;
              enum?: string[];
              enumNames?: string[];
            };
          };
        };
      }
    | undefined;
  const valueSchema = prop?.items?.properties?.value;
  if (!valueSchema) return [];

  let ids: string[] = [];
  let names: string[] = [];
  if (Array.isArray(valueSchema.enum)) {
    ids = valueSchema.enum;
    names = valueSchema.enumNames ?? [];
  } else if (Array.isArray(valueSchema.anyOf)) {
    const block = valueSchema.anyOf.find((a) => Array.isArray(a.enum));
    if (block?.enum) {
      ids = block.enum;
      names = block.enumNames ?? [];
    }
  }

  return ids
    .map((id, i) => ({
      id: String(id),
      name: String(names[i] || id),
    }))
    .filter((n) => n.id.trim());
}

/**
 * Lista caminhos de navegação (browse nodes) válidos para o product type no BR.
 * Fonte: Product Type Definitions schema → recommended_browse_nodes.enum
 */
export async function getAmazonRecommendedBrowseNodes(
  accountId: string,
  productType: string,
  marketplaceId?: string,
): Promise<AmazonBrowseNodeOption[]> {
  const type = productType.trim().toUpperCase();
  if (!type || type === "PRODUCT") return [];
  const mp = marketplaceId || getAmazonMarketplaceId();
  const cacheKey = `${accountId}:${mp}:${type}`;
  const cached = browseNodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.nodes;

  const params = new URLSearchParams({
    marketplaceIds: mp,
    requirements: "LISTING",
    locale: "pt_BR",
  });
  const definition = await amazon.get<{
    schema?: { link?: { resource?: string } };
  }>(accountId, `/definitions/2020-09-01/productTypes/${encodeURIComponent(type)}?${params}`);

  const schemaUrl = definition.schema?.link?.resource;
  if (!schemaUrl) {
    browseNodeCache.set(cacheKey, { expiresAt: Date.now() + BROWSE_NODE_CACHE_TTL_MS, nodes: [] });
    return [];
  }

  // URL S3 pré-assinada — sem header x-amz-access-token
  const schemaRes = await fetch(schemaUrl, { headers: { Accept: "application/json" } });
  if (!schemaRes.ok) {
    logger.warn(
      { productType: type, status: schemaRes.status },
      "Failed to fetch Amazon product type schema for browse nodes",
    );
    return [];
  }
  const schema = (await schemaRes.json()) as { properties?: Record<string, unknown> };
  const nodes = extractBrowseNodesFromSchema(schema);
  browseNodeCache.set(cacheKey, {
    expiresAt: Date.now() + BROWSE_NODE_CACHE_TTL_MS,
    nodes,
  });
  return nodes;
}

/** Escolhe o browse node mais adequado ao título / product type. */
export function suggestAmazonBrowseNode(
  nodes: AmazonBrowseNodeOption[],
  opts: { title?: string; productType?: string } = {},
): AmazonBrowseNodeOption | null {
  if (!nodes.length) return null;
  const title = (opts.title || "").toLowerCase();
  const type = (opts.productType || "").toUpperCase();

  const boostTerms: string[] = [];
  if (type.includes("DUFFEL") || /duffel|academia|esportiva|fitness|gym/.test(title)) {
    boostTerms.push("duffel", "esportiva", "marinheira", "academia");
  }
  if (type.includes("COSMETIC") || /necessaire|maquiagem|cosmetic|estojo/.test(title)) {
    boostTerms.push("necessaire", "maquiagem", "cosmético", "cosmetico", "viagem");
  }
  if (type.includes("BACKPACK") || /mochila/.test(title)) {
    boostTerms.push("mochila");
  }
  if (type.includes("LUGGAGE") || /\bmala\b|bagagem|bordo/.test(title)) {
    boostTerms.push("mala", "viagem", "bagagem");
  }
  if (type.includes("BAG") || /bolsa/.test(title)) {
    boostTerms.push("bolsa");
  }
  if (/feminina|mulher|lady/.test(title)) boostTerms.push("feminin");
  if (/masculina|homem|men/.test(title)) boostTerms.push("masculin");

  let best = nodes[0]!;
  let bestScore = -1;
  for (const node of nodes) {
    const nameL = node.name.toLowerCase();
    let score = 0;
    for (const term of boostTerms) {
      if (nameL.includes(term)) score += 3;
    }
    // palavras do título presentes no caminho
    for (const word of title.split(/[^a-zà-ú0-9]+/i).filter((w) => w.length > 3)) {
      if (nameL.includes(word.toLowerCase())) score += 1;
    }
    // prefere caminhos mais específicos (mais segmentos)
    score += Math.min((node.name.match(/>/g) || []).length, 4) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

/** Busca product types no catálogo SP-API (similares por título/keywords). */
export async function searchAmazonProductTypes(
  accountId: string,
  opts: {
    marketplaceId?: string;
    itemName?: string;
    keywords?: string;
  },
): Promise<AmazonProductTypeOption[]> {
  const marketplaceId = opts.marketplaceId || getAmazonMarketplaceId();
  const params = new URLSearchParams({
    marketplaceIds: marketplaceId,
  });
  if (opts.itemName?.trim()) {
    params.set("itemName", opts.itemName.trim().slice(0, 200));
  } else if (opts.keywords?.trim()) {
    params.set("keywords", opts.keywords.trim().slice(0, 200));
  } else {
    return [];
  }

  const data = await amazon.get<{
    productTypes?: Array<{ name?: string; displayName?: string }>;
  }>(accountId, `/definitions/2020-09-01/productTypes?${params}`);

  const out: AmazonProductTypeOption[] = [];
  const seen = new Set<string>();
  for (const pt of data.productTypes ?? []) {
    const name = pt.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      displayName: pt.displayName?.trim() || name,
    });
  }
  return out;
}

export function extractListingQuantity(item: AmazonListingsItem): number {
  const qty = item.fulfillmentAvailability?.find(
    (f) => f.fulfillmentChannelCode === "DEFAULT" || f.quantity != null,
  )?.quantity;
  return typeof qty === "number" ? qty : 0;
}

export function extractListingPrice(item: AmazonListingsItem): number | null {
  const amount = item.offers?.[0]?.price?.amount;
  if (amount == null) return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? n : null;
}

export function extractListingSummary(item: AmazonListingsItem): AmazonListingsItemSummary | undefined {
  return item.summaries?.[0];
}
