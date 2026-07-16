import { getDb } from "./db";
import {
  listingTemplatesTable,
  productsTable,
  accountsTable,
} from "@workspace/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ml, type MlItem, type MlVariation } from "./mercadolivre";
import {
  getMlItemDescription,
  createMlItem,
  upsertProductFromMlItem,
  MlListingError,
  type CreateMlListingInput,
  type MlListingAttributeInput,
  type MlListingVariationInput,
  type MlSaleTermInput,
  type CreateMlListingShippingInput,
} from "./ml-listings";
import { logger } from "./logger";

const TEMPLATE_SYNC_CONCURRENCY = 3;

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
  const isFull = item.shipping?.logistic_type === "fulfillment";
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
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.userId, userId), eq(accountsTable.isActive, true)));

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
  options?: { includePayload?: boolean },
) {
  const base = {
    id: row.id,
    userId: row.userId,
    sourceAccountId: row.sourceAccountId,
    sourceProductId: row.sourceProductId,
    sourceMlItemId: row.sourceMlItemId,
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
    const q = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(listingTemplatesTable.name, q),
        ilike(listingTemplatesTable.sourceMlItemId, q),
      )!,
    );
  }

  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listingTemplatesTable)
    .where(where);

  const rows = await db
    .select()
    .from(listingTemplatesTable)
    .where(where)
    .orderBy(desc(listingTemplatesTable.updatedAt))
    .limit(limit)
    .offset(offset);

  return {
    data: rows.map((row) => serializeListingTemplate(row)),
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
    .select()
    .from(listingTemplatesTable)
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
  const template = await getListingTemplateForUser(params.userId, params.templateId);
  if (!template) {
    throw new MlListingError("Modelo de anúncio não encontrado.", "TEMPLATE_NOT_FOUND");
  }

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
  if (template.isFull) {
    throw new MlListingError(
      "Modelos Full (Fulfillment) não podem ser publicados automaticamente pelo iHub.",
      "FULL_ITEM",
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

  const created = await createMlItem(params.targetAccountId, input);
  const productId = await upsertProductFromMlItem(params.targetAccountId, created);
  return { itemId: created.id, productId };
}
