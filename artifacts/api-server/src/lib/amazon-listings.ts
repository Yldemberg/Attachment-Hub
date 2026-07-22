import { getDb } from "./db";
import { accountsTable, productsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  amazon,
  extractListingPrice,
  extractListingQuantity,
  extractListingSummary,
  getListingsItem,
  listingsItemPath,
  resolveAmazonSellerId,
  type AmazonListingsItem,
} from "./amazon";
import { logger } from "./logger";

export class AmazonListingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "BAD_REQUEST"
      | "NOT_FOUND"
      | "AMAZON_API_ERROR"
      | "VALIDATION_ERROR" = "AMAZON_API_ERROR",
  ) {
    super(message);
    this.name = "AmazonListingError";
  }
}

export type CreateAmazonListingInput = {
  sellerSku: string;
  productType: string;
  title: string;
  price: number;
  availableQuantity: number;
  condition?: string;
  externalProductId?: string;
  externalProductIdType?: string;
  imageUrls?: string[];
  brand?: string;
  description?: string;
  /** Extra SP-API attributes merged into the payload */
  attributes?: Record<string, unknown>;
};

function attrLocaleValue(value: string | number, marketplaceId: string) {
  return [{ value, marketplace_id: marketplaceId }];
}

function buildCreateAttributes(
  input: CreateAmazonListingInput,
  marketplaceId: string,
): Record<string, unknown> {
  const condition = input.condition ?? "new_new";
  const attrs: Record<string, unknown> = {
    item_name: attrLocaleValue(input.title, marketplaceId),
    condition_type: attrLocaleValue(condition, marketplaceId),
    fulfillment_availability: [
      {
        fulfillment_channel_code: "DEFAULT",
        quantity: input.availableQuantity,
      },
    ],
    purchasable_offer: [
      {
        marketplace_id: marketplaceId,
        currency: "BRL",
        our_price: [{ schedule: [{ value_with_tax: input.price }] }],
      },
    ],
    ...(input.attributes ?? {}),
  };

  if (input.brand) {
    attrs.brand = attrLocaleValue(input.brand, marketplaceId);
  }
  if (input.description) {
    attrs.product_description = attrLocaleValue(input.description, marketplaceId);
  }
  if (input.imageUrls?.length) {
    attrs.main_product_image_locator = [
      { media_location: input.imageUrls[0], marketplace_id: marketplaceId },
    ];
    if (input.imageUrls.length > 1) {
      attrs.other_product_image_locator_1 = input.imageUrls
        .slice(1, 9)
        .map((url, i) => ({
          media_location: url,
          marketplace_id: marketplaceId,
        }));
    }
  }
  if (input.externalProductId) {
    attrs.externally_assigned_product_identifier = [
      {
        type: (input.externalProductIdType ?? "EAN").toLowerCase(),
        value: input.externalProductId,
        marketplace_id: marketplaceId,
      },
    ];
  }

  return attrs;
}

async function loadAmazonAccount(accountId: string) {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.platform, "amazon")));
  if (!account) {
    throw new AmazonListingError("Conta Amazon não encontrada", "NOT_FOUND");
  }
  return account;
}

export async function upsertProductFromAmazonListing(
  accountId: string,
  item: AmazonListingsItem,
): Promise<string> {
  const db = getDb();
  const summary = extractListingSummary(item);
  const sku = item.sku;
  const price = extractListingPrice(item);
  const qty = extractListingQuantity(item);
  const status = summary?.status?.[0] ?? "UNKNOWN";
  const asin = summary?.asin ?? null;
  const title = summary?.itemName ?? sku;
  const thumbnail = summary?.mainImage?.link ?? null;
  const productType = summary?.productType ?? null;
  const permalink = asin ? `https://www.amazon.com.br/dp/${asin}` : null;

  const [existing] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.accountId, accountId), eq(productsTable.amazonSku, sku)));

  if (existing) {
    await db
      .update(productsTable)
      .set({
        amazonAsin: asin,
        amazonProductType: productType,
        title,
        sku,
        price: price != null ? String(price) : null,
        amount: price != null ? String(price) : null,
        availableQuantity: qty,
        status,
        thumbnail,
        permalink,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(productsTable.id, existing.id));
    return existing.id;
  }

  const [inserted] = await db
    .insert(productsTable)
    .values({
      accountId,
      mlItemId: null,
      amazonSku: sku,
      amazonAsin: asin,
      amazonProductType: productType,
      title,
      sku,
      price: price != null ? String(price) : null,
      amount: price != null ? String(price) : null,
      availableQuantity: qty,
      soldQuantity: 0,
      status,
      thumbnail,
      permalink,
      lastSyncedAt: new Date(),
    })
    .returning({ id: productsTable.id });

  return inserted.id;
}

export async function createAmazonListing(
  accountId: string,
  input: CreateAmazonListingInput,
): Promise<{ sku: string; productId: string }> {
  const sellerSku = input.sellerSku?.trim();
  if (!sellerSku) {
    throw new AmazonListingError("Informe sellerSku", "VALIDATION_ERROR");
  }
  if (!input.productType?.trim()) {
    throw new AmazonListingError("Informe productType (ex.: SHOES)", "VALIDATION_ERROR");
  }
  if (!input.title?.trim()) {
    throw new AmazonListingError("Informe o título", "VALIDATION_ERROR");
  }
  if (typeof input.price !== "number" || input.price <= 0) {
    throw new AmazonListingError("Preço inválido", "VALIDATION_ERROR");
  }
  if (typeof input.availableQuantity !== "number" || input.availableQuantity < 0) {
    throw new AmazonListingError("Quantidade inválida", "VALIDATION_ERROR");
  }

  const account = await loadAmazonAccount(accountId);
  const sellerId = resolveAmazonSellerId(account);
  const marketplaceId = account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

  const body = {
    productType: input.productType.trim(),
    requirements: "LISTING",
    attributes: buildCreateAttributes(input, marketplaceId),
  };

  try {
    await amazon.put(
      accountId,
      listingsItemPath(sellerId, sellerSku, marketplaceId),
      body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ accountId, sellerSku, message }, "Amazon putListingsItem failed");
    throw new AmazonListingError(message, "AMAZON_API_ERROR");
  }

  // Re-fetch may lag; upsert from request + best-effort GET
  let item: AmazonListingsItem = {
    sku: sellerSku,
    summaries: [
      {
        marketplaceId,
        productType: input.productType.trim(),
        itemName: input.title,
        status: ["BUYABLE"],
        mainImage: input.imageUrls?.[0] ? { link: input.imageUrls[0] } : undefined,
      },
    ],
    offers: [
      {
        marketplaceId,
        price: { currencyCode: "BRL", amount: input.price },
      },
    ],
    fulfillmentAvailability: [
      { fulfillmentChannelCode: "DEFAULT", quantity: input.availableQuantity },
    ],
  };

  try {
    item = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
  } catch {
    // keep local projection
  }

  const productId = await upsertProductFromAmazonListing(accountId, item);
  return { sku: sellerSku, productId };
}

export async function patchAmazonListingQuantity(
  accountId: string,
  sellerSku: string,
  quantity: number,
  productType?: string | null,
): Promise<AmazonListingsItem> {
  if (typeof quantity !== "number" || quantity < 0) {
    throw new AmazonListingError("Quantidade inválida", "VALIDATION_ERROR");
  }

  const account = await loadAmazonAccount(accountId);
  const sellerId = resolveAmazonSellerId(account);
  const marketplaceId = account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

  let resolvedType = productType?.trim() || "";
  if (!resolvedType) {
    const current = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
    resolvedType = extractListingSummary(current)?.productType ?? "";
  }
  if (!resolvedType) {
    throw new AmazonListingError(
      "productType desconhecido para o anúncio; sincronize a conta ou informe amazonProductType",
      "VALIDATION_ERROR",
    );
  }

  const body = {
    productType: resolvedType,
    patches: [
      {
        op: "replace",
        path: "/attributes/fulfillment_availability",
        value: [
          {
            fulfillment_channel_code: "DEFAULT",
            quantity,
          },
        ],
      },
    ],
  };

  try {
    await amazon.patch(accountId, listingsItemPath(sellerId, sellerSku, marketplaceId), body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AmazonListingError(message, "AMAZON_API_ERROR");
  }

  return getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
}

export async function patchAmazonListingPrice(
  accountId: string,
  sellerSku: string,
  price: number,
  productType?: string | null,
): Promise<AmazonListingsItem> {
  if (typeof price !== "number" || price <= 0) {
    throw new AmazonListingError("Preço inválido", "VALIDATION_ERROR");
  }

  const account = await loadAmazonAccount(accountId);
  const sellerId = resolveAmazonSellerId(account);
  const marketplaceId = account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

  let resolvedType = productType?.trim() || "";
  if (!resolvedType) {
    const current = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
    resolvedType = extractListingSummary(current)?.productType ?? "";
  }
  if (!resolvedType) {
    throw new AmazonListingError("productType desconhecido para o anúncio", "VALIDATION_ERROR");
  }

  const body = {
    productType: resolvedType,
    patches: [
      {
        op: "replace",
        path: "/attributes/purchasable_offer",
        value: [
          {
            marketplace_id: marketplaceId,
            currency: "BRL",
            our_price: [{ schedule: [{ value_with_tax: price }] }],
          },
        ],
      },
    ],
  };

  try {
    await amazon.patch(accountId, listingsItemPath(sellerId, sellerSku, marketplaceId), body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AmazonListingError(message, "AMAZON_API_ERROR");
  }

  return getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
}

export async function updateAmazonListing(
  accountId: string,
  sellerSku: string,
  updates: { price?: number; availableQuantity?: number; productType?: string | null },
): Promise<AmazonListingsItem> {
  let last: AmazonListingsItem | null = null;
  if (typeof updates.availableQuantity === "number") {
    last = await patchAmazonListingQuantity(
      accountId,
      sellerSku,
      updates.availableQuantity,
      updates.productType,
    );
  }
  if (typeof updates.price === "number") {
    last = await patchAmazonListingPrice(accountId, sellerSku, updates.price, updates.productType);
  }
  if (!last) {
    const account = await loadAmazonAccount(accountId);
    const sellerId = resolveAmazonSellerId(account);
    const marketplaceId = account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";
    last = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
  }
  await upsertProductFromAmazonListing(accountId, last);
  return last;
}
