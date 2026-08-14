import { getDb } from "./db";
import {
  listingTemplatesTable,
  productsTable,
  accountsTable,
} from "@workspace/db/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { ml, type MlItem, type MlVariation, itemIsMlFull } from "./mercadolivre";
import {
  getMlItemDescription,
  createMlItem,
  upsertProductFromMlItem,
  updateMlItem,
  sanitizeAttributesForCreate,
  isUserProductSeller,
  extractBlockedFieldIdsFromMlError,
  WRITABLE_SALE_TERM_IDS,
  MlListingError,
  type CreateMlListingInput,
  type UpdateMlListingInput,
  type MlListingAttributeInput,
  type MlListingVariationInput,
  type MlSaleTermInput,
  type CreateMlListingShippingInput,
} from "./ml-listings";
import { productsMatchSellerSkuIncludingVariations } from "./product-sku";
import { logger } from "./logger";

const TEMPLATE_SYNC_CONCURRENCY = 3;

function escapeIlikePattern(token: string): string {
  return token.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export type ListingTemplatePayload = {
  title: string;
  familyName?: string;
  categoryId: string;
  price: number;
  availableQuantity: number;
  condition: "new" | "used";
  listingTypeId: string;
  pictures: string[];
  pictureSources: string[];
  attributes: MlListingAttributeInput[];
  description?: string;
  saleTerms?: MlSaleTermInput[];
  shipping?: CreateMlListingShippingInput;
  variations?: MlListingVariationInput[];
  videoId?: string | null;
  sourcePermalink?: string;
};

type MlItemForTemplate = MlItem & {
  condition?: string;
  family_name?: string;
  pictures?: Array<{ id?: string; secure_url?: string; url?: string }>;
  sale_terms?: Array<{ id: string; value_name?: string | null; value_id?: string | null }>;
  shipping?: MlItem["shipping"] & {
    mode?: string;
    local_pick_up?: boolean;
    free_shipping?: boolean;
  };
};

function mapAttributes(attributes: MlItemForTemplate["attributes"]): MlListingAttributeInput[] {
  return (attributes ?? [])
    .filter((a) => a.id && a.id !== "ITEM_CONDITION" && a.value_name?.trim())
    .map((a) => ({
      id: a.id!,
      value_name: a.value_name!.trim(),
      ...(a.value_id ? { value_id: a.value_id } : {}),
    }));
}

function mapSaleTerms(saleTerms: MlItemForTemplate["sale_terms"]): MlSaleTermInput[] {
  return (saleTerms ?? [])
    .filter((t) => t.value_name?.trim() || t.value_id)
    .map((t) => ({
      id: t.id,
      ...(t.value_name?.trim() ? { value_name: t.value_name.trim() } : {}),
      ...(t.value_id ? { value_id: t.value_id } : {}),
    }));
}

function mapVariations(variations: MlVariation[] | undefined): MlListingVariationInput[] | undefined {
  if (!Array.isArray(variations) || variations.length === 0) return undefined;
  return variations.map((v) => ({
    attribute_combinations: (v.attribute_combinations ?? [])
      .filter((a) => a.id && a.value_name)
      .map((a) => ({
        id: a.id,
        value_name: a.value_name,
        ...(a.value_id ? { value_id: a.value_id } : {}),
      })),
    price: v.price,
    available_quantity: v.available_quantity,
    picture_ids: v.picture_ids,
  }));
}

function mapShipping(shipping: MlItemForTemplate["shipping"]): CreateMlListingShippingInput | undefined {
  if (!shipping) return undefined;
  const out: CreateMlListingShippingInput = {};
  if (typeof shipping.mode === "string") out.mode = shipping.mode;
  if (typeof shipping.local_pick_up === "boolean") out.local_pick_up = shipping.local_pick_up;
  if (typeof shipping.free_shipping === "boolean") out.free_shipping = shipping.free_shipping;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildTemplatePayloadFromMlItem(
  item: MlItemForTemplate,
  description: string,
): ListingTemplatePayload {
  const pictureSources = (item.pictures ?? [])
    .map((p) => p.secure_url ?? p.url ?? "")
    .filter((url) => url.length > 0);
  const pictureIds = (item.pictures ?? [])
    .map((p) => p.id ?? "")
    .filter((id) => id.length > 0);
  const condition = item.condition === "used" ? "used" : "new";
  const title = item.title?.trim() || item.id;
  const saleTerms = mapSaleTerms(item.sale_terms);
  const shipping = mapShipping(item.shipping);
  const variations = mapVariations(item.variations);

  return {
    title,
    familyName: item.family_name?.trim() || title,
    categoryId: item.category_id,
    price: item.price,
    availableQuantity: item.available_quantity,
    condition,
    listingTypeId: item.listing_type_id,
    pictures: pictureIds,
    pictureSources,
    attributes: mapAttributes(item.attributes),
    description: description.trim() || undefined,
    ...(saleTerms.length ? { saleTerms } : {}),
    ...(shipping ? { shipping } : {}),
    ...(variations?.length ? { variations } : {}),
    videoId: item.video_id ?? null,
    sourcePermalink: item.permalink,
  };
}

export function templatePayloadToCreateInput(payload: ListingTemplatePayload): CreateMlListingInput {
  return {
    title: payload.title,
    familyName: payload.familyName,
    categoryId: payload.categoryId,
    price: payload.price,
    availableQuantity: payload.availableQuantity,
    condition: payload.condition,
    listingTypeId: payload.listingTypeId,
    pictures: payload.pictures ?? [],
    pictureSources: payload.pictureSources?.length ? payload.pictureSources : undefined,
    attributes: payload.attributes ?? [],
    description: payload.description,
    saleTerms: payload.saleTerms,
    shipping: payload.shipping,
    variations: payload.variations,
    videoId: payload.videoId ?? null,
  };
}

export async function upsertListingTemplateFromMlItem(params: {
  userId: string;
  accountId: string;
  productId?: string | null;
  item: MlItemForTemplate;
  description: string;
}): Promise<string> {
  const { userId, accountId, productId, item, description } = params;
  const db = getDb();
  const payload = buildTemplatePayloadFromMlItem(item, description);
  const isFull = itemIsMlFull(item);
  const isCatalog = item.catalog_listing === true;
  const hasVariations = Array.isArray(item.variations) && item.variations.length > 0;
  const now = new Date();

  const values = {
    userId,
    sourceAccountId: accountId,
    sourceProductId: productId ?? null,
    sourceMlItemId: item.id,
    name: payload.title,
    thumbnail: item.thumbnail ?? payload.pictureSources[0] ?? null,
    categoryId: payload.categoryId,
    listingTypeId: payload.listingTypeId,
    condition: payload.condition,
    sourceStatus: item.status ?? null,
    isFull,
    isCatalog,
    hasVariations,
    payloadJson: payload,
    lastSyncedAt: now,
    updatedAt: now,
  };

  const [row] = await db
    .insert(listingTemplatesTable)
    .values(values)
    .onConflictDoUpdate({
      target: [
        listingTemplatesTable.userId,
        listingTemplatesTable.sourceAccountId,
        listingTemplatesTable.sourceMlItemId,
      ],
      set: {
        sourceProductId: values.sourceProductId,
        name: values.name,
        thumbnail: values.thumbnail,
        categoryId: values.categoryId,
        listingTypeId: values.listingTypeId,
        condition: values.condition,
        sourceStatus: values.sourceStatus,
        isFull: values.isFull,
        isCatalog: values.isCatalog,
        hasVariations: values.hasVariations,
        payloadJson: values.payloadJson,
        lastSyncedAt: values.lastSyncedAt,
        updatedAt: values.updatedAt,
      },
    })
    .returning({ id: listingTemplatesTable.id });

  return row.id;
}

async function fetchMlItemForTemplate(accountId: string, mlItemId: string): Promise<MlItemForTemplate> {
  return ml.get<MlItemForTemplate>(accountId, `/items/${encodeURIComponent(mlItemId)}`);
}

export async function syncListingTemplateForProduct(params: {
  userId: string;
  accountId: string;
  productId: string;
  mlItemId: string;
}): Promise<string> {
  const item = await fetchMlItemForTemplate(params.accountId, params.mlItemId);
  const description = await getMlItemDescription(params.accountId, params.mlItemId);
  return upsertListingTemplateFromMlItem({
    userId: params.userId,
    accountId: params.accountId,
    productId: params.productId,
    item,
    description,
  });
}

export type SyncListingTemplatesResult = {
  synced: number;
  failed: number;
  errors: Array<{ mlItemId: string; message: string }>;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Busca todos os anúncios da conta no banco e grava/atualiza modelos com campos completos do ML. */
export async function syncListingTemplatesForAccount(
  accountId: string,
  userId: string,
): Promise<SyncListingTemplatesResult> {
  const db = getDb();
  const products = await db
    .select({
      id: productsTable.id,
      mlItemId: productsTable.mlItemId,
    })
    .from(productsTable)
    .where(eq(productsTable.accountId, accountId));

  const result: SyncListingTemplatesResult = { synced: 0, failed: 0, errors: [] };

  if (products.length === 0) return result;

  logger.info({ accountId, count: products.length }, "Starting listing templates sync");

  await mapPool(products, TEMPLATE_SYNC_CONCURRENCY, async (product) => {
    if (!product.mlItemId) {
      return;
    }
    try {
      await syncListingTemplateForProduct({
        userId,
        accountId,
        productId: product.id,
        mlItemId: product.mlItemId,
      });
      result.synced += 1;
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : "Unknown error";
      result.errors.push({ mlItemId: product.mlItemId, message });
      logger.warn(
        { err, accountId, mlItemId: product.mlItemId },
        "Failed to sync listing template",
      );
    }
  });

  logger.info(
    { accountId, synced: result.synced, failed: result.failed },
    "Listing templates sync complete",
  );
  return result;
}

export async function syncListingTemplatesForUser(userId: string): Promise<{
  accounts: number;
  synced: number;
  failed: number;
}> {
  const db = getDb();
  const accounts = await db
    .select({ id: accountsTable.id, platform: accountsTable.platform })
    .from(accountsTable)
    .where(
      and(
        eq(accountsTable.userId, userId),
        or(eq(accountsTable.isActive, true), eq(accountsTable.platform, "amazon"))!,
      ),
    );

  let synced = 0;
  let failed = 0;
  for (const account of accounts) {
    const result = await syncListingTemplatesForAccount(account.id, userId);
    synced += result.synced;
    failed += result.failed;
  }
  return { accounts: accounts.length, synced, failed };
}

export function serializeListingTemplate(
  row: typeof listingTemplatesTable.$inferSelect,
  options?: { includePayload?: boolean; sku?: string | null },
) {
  const base = {
    id: row.id,
    userId: row.userId,
    sourceAccountId: row.sourceAccountId,
    sourceProductId: row.sourceProductId,
    sourceMlItemId: row.sourceMlItemId,
    sku: options?.sku ?? null,
    name: row.name,
    thumbnail: row.thumbnail,
    categoryId: row.categoryId,
    listingTypeId: row.listingTypeId,
    condition: row.condition,
    sourceStatus: row.sourceStatus,
    isFull: row.isFull,
    isCatalog: row.isCatalog,
    hasVariations: row.hasVariations,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (options?.includePayload) {
    return { ...base, payload: row.payloadJson as ListingTemplatePayload };
  }
  return base;
}

export async function listListingTemplatesForUser(params: {
  userId: string;
  accountId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const db = getDb();
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions = [eq(listingTemplatesTable.userId, params.userId)];
  if (params.accountId) {
    conditions.push(eq(listingTemplatesTable.sourceAccountId, params.accountId));
  }
  if (params.search?.trim()) {
    // Mesma lógica de /products: várias palavras = AND; cada token casa título, MLB ou SKU.
    const tokens = params.search
      .trim()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    for (const token of tokens) {
      const pat = `%${escapeIlikePattern(token)}%`;
      conditions.push(
        sql`(
          coalesce(${listingTemplatesTable.name}, '') ILIKE ${pat} ESCAPE '\\'
          OR coalesce(${listingTemplatesTable.sourceMlItemId}, '') ILIKE ${pat} ESCAPE '\\'
          OR coalesce(${listingTemplatesTable.payloadJson}::text, '') ILIKE ${pat} ESCAPE '\\'
          OR coalesce(${productsTable.sku}, '') ILIKE ${pat} ESCAPE '\\'
          OR coalesce(${productsTable.title}, '') ILIKE ${pat} ESCAPE '\\'
          OR coalesce(${productsTable.variationsJson}::text, '') ILIKE ${pat} ESCAPE '\\'
        )`,
      );
    }
  }

  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listingTemplatesTable)
    .leftJoin(
      productsTable,
      eq(listingTemplatesTable.sourceProductId, productsTable.id),
    )
    .where(where);

  const rows = await db
    .select({
      template: listingTemplatesTable,
      sku: productsTable.sku,
    })
    .from(listingTemplatesTable)
    .leftJoin(
      productsTable,
      eq(listingTemplatesTable.sourceProductId, productsTable.id),
    )
    .where(where)
    .orderBy(desc(listingTemplatesTable.updatedAt))
    .limit(limit)
    .offset(offset);

  return {
    data: rows.map((row) => serializeListingTemplate(row.template, { sku: row.sku })),
    pagination: {
      page,
      limit,
      total: countRow?.count ?? 0,
      totalPages: Math.max(1, Math.ceil((countRow?.count ?? 0) / limit)),
    },
  };
}

export async function getListingTemplateForUser(userId: string, templateId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      template: listingTemplatesTable,
      sku: productsTable.sku,
    })
    .from(listingTemplatesTable)
    .leftJoin(productsTable, eq(listingTemplatesTable.sourceProductId, productsTable.id))
    .where(and(eq(listingTemplatesTable.id, templateId), eq(listingTemplatesTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function deleteListingTemplateForUser(userId: string, templateId: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(listingTemplatesTable)
    .where(and(eq(listingTemplatesTable.id, templateId), eq(listingTemplatesTable.userId, userId)))
    .returning({ id: listingTemplatesTable.id });
  return deleted.length > 0;
}

export async function publishListingTemplate(params: {
  userId: string;
  templateId: string;
  targetAccountId: string;
  overrides?: Partial<CreateMlListingInput>;
}): Promise<{ itemId: string; productId: string }> {
  const db = getDb();
  const found = await getListingTemplateForUser(params.userId, params.templateId);
  if (!found) {
    throw new MlListingError("Modelo de anúncio não encontrado.", "TEMPLATE_NOT_FOUND");
  }
  const template = found.template;

  const [account] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(
      and(
        eq(accountsTable.id, params.targetAccountId),
        eq(accountsTable.userId, params.userId),
        eq(accountsTable.isActive, true),
      ),
    )
    .limit(1);

  if (!account) {
    throw new MlListingError("Conta de destino não encontrada.", "ACCOUNT_NOT_FOUND");
  }

  if (template.isCatalog) {
    throw new MlListingError(
      "Modelos de catálogo compartilhado não podem ser publicados automaticamente. Use um anúncio tradicional.",
      "CATALOG_LISTING",
    );
  }

  const payload = template.payloadJson as ListingTemplatePayload;
  const input: CreateMlListingInput = {
    ...templatePayloadToCreateInput(payload),
    ...params.overrides,
  };

  // Prefer public URLs so pictures work across accounts.
  if (input.pictureSources?.length) {
    input.pictures = [];
  }

  // Full (Fulfillment) templates are content-only: publish as a traditional listing,
  // never carry over fulfillment shipping to the new item.
  if (template.isFull) {
    delete input.shipping;
  }

  const created = await createMlItem(params.targetAccountId, input);
  const productId = await upsertProductFromMlItem(params.targetAccountId, created);
  return { itemId: created.id, productId };
}

export const LISTING_TEMPLATE_PROPAGATE_FIELDS = [
  "title",
  "price",
  "pictures",
  "description",
  "attributes",
  "saleTerms",
  "videoId",
] as const;

export type ListingTemplatePropagateField = (typeof LISTING_TEMPLATE_PROPAGATE_FIELDS)[number];

export type ListingTemplateSkuTargets = {
  total: number;
  full: number;
  traditional: number;
  closed: number;
};

export type PropagateListingTemplateResultItem = {
  productId: string;
  mlItemId: string;
  accountId: string;
  accountLabel: string | null;
  isFull: boolean;
  status: "updated" | "skipped" | "failed";
  reason: string | null;
};

export type PropagateListingTemplateResult = {
  sku: string;
  fields: ListingTemplatePropagateField[];
  updated: number;
  skipped: number;
  failed: number;
  results: PropagateListingTemplateResultItem[];
};

const PROPAGATE_CONCURRENCY = 3;
const PROPAGATE_RETRY_MAX = 3;
const PROPAGATE_RETRY_BASE_MS = 400;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryablePropagateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|503|ECONNRESET|ETIMEDOUT|timeout|temporar/i.test(msg);
}

function normalizePropagateFields(fields: string[]): ListingTemplatePropagateField[] {
  const allowed = new Set<string>(LISTING_TEMPLATE_PROPAGATE_FIELDS);
  const unique: ListingTemplatePropagateField[] = [];
  for (const raw of fields) {
    if (!allowed.has(raw)) continue;
    const field = raw as ListingTemplatePropagateField;
    if (!unique.includes(field)) unique.push(field);
  }
  return unique;
}

function asAttributeInputs(rows: unknown): MlListingAttributeInput[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .filter((a) => typeof a.id === "string" && a.id)
    .map((a) => ({
      id: a.id as string,
      value_name:
        typeof a.value_name === "string"
          ? a.value_name
          : typeof a.valueName === "string"
            ? a.valueName
            : "",
      ...(typeof a.value_id === "string" && a.value_id
        ? { value_id: a.value_id }
        : typeof a.valueId === "string" && a.valueId
          ? { value_id: a.valueId }
          : {}),
    }))
    .filter((a) => a.value_name.trim() || a.value_id);
}

function mergeTemplatePayload(
  current: ListingTemplatePayload,
  overrides?: Partial<CreateMlListingInput>,
): ListingTemplatePayload {
  if (!overrides) return current;
  return {
    ...current,
    ...overrides,
    pictures: overrides.pictures ?? current.pictures,
    pictureSources: overrides.pictureSources ?? current.pictureSources,
    attributes: overrides.attributes ?? current.attributes,
    saleTerms: overrides.saleTerms ?? current.saleTerms,
    shipping: overrides.shipping ?? current.shipping,
    variations: overrides.variations ?? current.variations,
  };
}

export async function resolveTemplateSku(params: {
  userId: string;
  template: typeof listingTemplatesTable.$inferSelect;
  joinedSku?: string | null;
}): Promise<string | null> {
  if (params.joinedSku?.trim()) return params.joinedSku.trim();
  const db = getDb();
  if (params.template.sourceProductId) {
    const [product] = await db
      .select({ sku: productsTable.sku })
      .from(productsTable)
      .innerJoin(accountsTable, eq(productsTable.accountId, accountsTable.id))
      .where(
        and(
          eq(productsTable.id, params.template.sourceProductId),
          eq(accountsTable.userId, params.userId),
        ),
      )
      .limit(1);
    if (product?.sku?.trim()) return product.sku.trim();
  }
  if (params.template.sourceMlItemId && params.template.sourceAccountId) {
    const [product] = await db
      .select({ sku: productsTable.sku })
      .from(productsTable)
      .innerJoin(accountsTable, eq(productsTable.accountId, accountsTable.id))
      .where(
        and(
          eq(productsTable.mlItemId, params.template.sourceMlItemId),
          eq(productsTable.accountId, params.template.sourceAccountId),
          eq(accountsTable.userId, params.userId),
        ),
      )
      .limit(1);
    if (product?.sku?.trim()) return product.sku.trim();
  }
  return null;
}

type MlSkuListingTarget = {
  productId: string;
  mlItemId: string;
  accountId: string;
  accountLabel: string | null;
  isFull: boolean;
  hasVariations: boolean;
  status: string | null;
  categoryId: string | null;
};

async function listMlListingsBySku(userId: string, sku: string): Promise<MlSkuListingTarget[]> {
  const db = getDb();
  const rows = await db
    .select({
      productId: productsTable.id,
      mlItemId: productsTable.mlItemId,
      accountId: productsTable.accountId,
      accountLabel: accountsTable.mlNickname,
      isFull: productsTable.isFull,
      variationsJson: productsTable.variationsJson,
      status: productsTable.status,
      categoryId: productsTable.mlCategoryId,
    })
    .from(productsTable)
    .innerJoin(accountsTable, eq(productsTable.accountId, accountsTable.id))
    .where(
      and(
        eq(accountsTable.userId, userId),
        eq(accountsTable.isActive, true),
        or(eq(accountsTable.platform, "mercadolivre"), sql`${accountsTable.platform} is null`)!,
        productsMatchSellerSkuIncludingVariations(sku),
      ),
    );

  return rows
    .filter((row): row is typeof row & { mlItemId: string } => Boolean(row.mlItemId))
    .map((row) => ({
      productId: row.productId,
      mlItemId: row.mlItemId,
      accountId: row.accountId,
      accountLabel: row.accountLabel,
      isFull: row.isFull,
      hasVariations: Array.isArray(row.variationsJson) && row.variationsJson.length > 0,
      status: row.status,
      categoryId: row.categoryId,
    }));
}

export async function summarizeMlSkuTargets(
  userId: string,
  sku: string,
): Promise<ListingTemplateSkuTargets> {
  const listings = await listMlListingsBySku(userId, sku);
  let full = 0;
  let traditional = 0;
  let closed = 0;
  for (const listing of listings) {
    if (listing.status === "closed") {
      closed += 1;
      continue;
    }
    if (listing.isFull) full += 1;
    else traditional += 1;
  }
  return {
    total: listings.length,
    full,
    traditional,
    closed,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof MlListingError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Falha ao atualizar o anúncio no Mercado Livre.";
}

async function buildPropagatePatch(params: {
  accountId: string;
  categoryId: string | null;
  payload: ListingTemplatePayload;
  fields: ListingTemplatePropagateField[];
  hasVariations: boolean;
}): Promise<{ patch: UpdateMlListingInput; notes: string[] }> {
  const notes: string[] = [];
  const patch: UpdateMlListingInput = {};
  const isUpSeller = await isUserProductSeller(params.accountId);

  if (params.fields.includes("title")) {
    const familyName = (params.payload.familyName ?? params.payload.title).trim();
    const title = params.payload.title.trim();
    if (isUpSeller) {
      patch.familyName = familyName || title;
    } else {
      patch.title = title;
    }
  }

  if (params.fields.includes("price")) {
    if (params.hasVariations) {
      notes.push("Preço não aplicado: anúncio com variações (preço por variação).");
    } else if (typeof params.payload.price === "number" && params.payload.price > 0) {
      patch.price = params.payload.price;
    }
  }

  if (params.fields.includes("pictures")) {
    const sources = (params.payload.pictureSources ?? []).map((u) => u.trim()).filter(Boolean);
    if (sources.length > 0) {
      patch.pictureSources = sources;
    } else {
      notes.push("Fotos ignoradas: o modelo não tem URLs públicas.");
    }
  }

  if (params.fields.includes("description")) {
    patch.description = params.payload.description?.trim() ?? "";
  }

  if (params.fields.includes("attributes")) {
    const raw = asAttributeInputs(params.payload.attributes);
    const categoryId = params.categoryId || params.payload.categoryId;
    patch.attributes = categoryId
      ? await sanitizeAttributesForCreate(params.accountId, categoryId, raw)
      : raw;
  }

  if (params.fields.includes("saleTerms")) {
    patch.saleTerms = asAttributeInputs(params.payload.saleTerms).filter((t) =>
      WRITABLE_SALE_TERM_IDS.has(t.id),
    );
  }

  if (params.fields.includes("videoId")) {
    patch.videoId = params.payload.videoId?.trim() ? params.payload.videoId.trim() : null;
  }

  return { patch, notes };
}

async function applyPropagatePatch(
  accountId: string,
  mlItemId: string,
  patch: UpdateMlListingInput,
  isFull: boolean,
): Promise<void> {
  const putOnce = async (input: UpdateMlListingInput) => {
    await updateMlItem(accountId, mlItemId, input, { isFull, omitStock: true });
  };

  let working = { ...patch };
  try {
    await putOnce(working);
    return;
  } catch (firstErr) {
    const blockedIds = extractBlockedFieldIdsFromMlError(firstErr);
    if (blockedIds.length === 0) throw firstErr;
    const blocked = new Set(blockedIds);
    working = {
      ...working,
      attributes: working.attributes?.filter((a) => !blocked.has(a.id)),
      saleTerms: working.saleTerms?.filter((t) => !blocked.has(t.id)),
    };
    logger.warn(
      { accountId, mlItemId, blockedIds },
      "Listing template propagate: retrying without blocked ML fields",
    );
    await putOnce(working);
  }
}

export async function propagateListingTemplate(params: {
  userId: string;
  templateId: string;
  fields: string[];
  overrides?: Partial<CreateMlListingInput>;
}): Promise<PropagateListingTemplateResult> {
  const fields = normalizePropagateFields(params.fields);
  if (fields.length === 0) {
    throw new MlListingError(
      "Selecione ao menos um campo para espelhar (estoque não é alterado).",
      "MISSING_FIELDS",
    );
  }

  const found = await getListingTemplateForUser(params.userId, params.templateId);
  if (!found) {
    throw new MlListingError("Modelo de anúncio não encontrado.", "TEMPLATE_NOT_FOUND");
  }

  const sku = await resolveTemplateSku({
    userId: params.userId,
    template: found.template,
    joinedSku: found.sku,
  });
  if (!sku) {
    throw new MlListingError(
      "Este modelo não tem SKU. Sincronize o anúncio de origem e tente de novo.",
      "MISSING_SKU",
    );
  }

  const currentPayload = found.template.payloadJson as ListingTemplatePayload;
  const payload = mergeTemplatePayload(currentPayload, params.overrides);

  const db = getDb();
  await db
    .update(listingTemplatesTable)
    .set({
      payloadJson: payload,
      name: payload.title || found.template.name,
      categoryId: payload.categoryId ?? found.template.categoryId,
      listingTypeId: payload.listingTypeId ?? found.template.listingTypeId,
      condition: payload.condition ?? found.template.condition,
      updatedAt: new Date(),
    })
    .where(eq(listingTemplatesTable.id, found.template.id));

  const listings = await listMlListingsBySku(params.userId, sku);
  const results = await mapPool(listings, PROPAGATE_CONCURRENCY, async (listing) => {
    const base: PropagateListingTemplateResultItem = {
      productId: listing.productId,
      mlItemId: listing.mlItemId,
      accountId: listing.accountId,
      accountLabel: listing.accountLabel,
      isFull: listing.isFull,
      status: "failed",
      reason: null,
    };

    if (listing.status === "closed") {
      return { ...base, status: "skipped" as const, reason: "Anúncio encerrado." };
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt < PROPAGATE_RETRY_MAX; attempt++) {
      try {
        const { patch, notes } = await buildPropagatePatch({
          accountId: listing.accountId,
          categoryId: listing.categoryId,
          payload,
          fields,
          hasVariations: listing.hasVariations,
        });

        const hasBody =
          patch.title !== undefined ||
          patch.familyName !== undefined ||
          patch.price !== undefined ||
          patch.pictureSources !== undefined ||
          patch.pictures !== undefined ||
          patch.attributes !== undefined ||
          patch.description !== undefined ||
          patch.saleTerms !== undefined ||
          patch.videoId !== undefined;

        if (!hasBody) {
          return {
            ...base,
            status: "skipped" as const,
            reason: notes[0] ?? "Nenhum campo aplicável neste anúncio.",
          };
        }

        await applyPropagatePatch(listing.accountId, listing.mlItemId, patch, listing.isFull);

        try {
          const fresh = await ml.get<MlItem>(
            listing.accountId,
            `/items/${encodeURIComponent(listing.mlItemId)}`,
          );
          await upsertProductFromMlItem(listing.accountId, fresh);
        } catch (err) {
          logger.warn(
            { err, accountId: listing.accountId, mlItemId: listing.mlItemId },
            "Listing template propagate: item updated but local snapshot refresh failed",
          );
        }

        return {
          ...base,
          status: "updated" as const,
          reason: notes.length ? notes.join(" ") : null,
        };
      } catch (err) {
        lastErr = err;
        if (attempt === PROPAGATE_RETRY_MAX - 1 || !isRetryablePropagateError(err)) break;
        await sleepMs(PROPAGATE_RETRY_BASE_MS * 2 ** attempt);
      }
    }

    return { ...base, status: "failed" as const, reason: errorMessage(lastErr) };
  });

  return {
    sku,
    fields,
    updated: results.filter((r) => r.status === "updated").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
