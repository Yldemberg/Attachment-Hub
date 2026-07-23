import { getDb } from "./db";
import { accountsTable, productsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  amazon,
  extractListingPrice,
  extractListingQuantity,
  extractListingSummary,
  formatAmazonListingsIssues,
  getCatalogProductTypeForAsin,
  getListingsItem,
  listingsItemPath,
  resolveAmazonSellerId,
  type AmazonListingsItem,
  type AmazonListingsSubmissionResponse,
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
  /** ASIN do catálogo Amazon (quando o anúncio é oferta de produto existente). */
  asin?: string | null;
  /** LISTING | LISTING_OFFER_ONLY — se omitido, usa OFFER quando há ASIN. */
  requirements?: string;
  /** Extra SP-API attributes merged into the payload */
  attributes?: Record<string, unknown>;
};

function attrLocaleValue(value: string | number, marketplaceId: string) {
  return [{ value, marketplace_id: marketplaceId }];
}

function buildOfferAttributes(
  input: CreateAmazonListingInput,
  marketplaceId: string,
  asin: string,
): Record<string, unknown> {
  const condition = input.condition ?? "new_new";
  const attrs: Record<string, unknown> = {
    merchant_suggested_asin: [{ value: asin, marketplace_id: marketplaceId }],
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
  };

  if (input.imageUrls?.[0]) {
    attrs.main_product_image_locator = [
      { media_location: input.imageUrls[0], marketplace_id: marketplaceId },
    ];
  }

  return attrs;
}

function buildCreateAttributes(
  input: CreateAmazonListingInput,
  marketplaceId: string,
): Record<string, unknown> {
  const condition = input.condition ?? "new_new";
  const fromDraft = input.attributes ? { ...input.attributes } : {};

  // Base offer/product facts — draft attrs can fill gaps, but we keep critical offer fields.
  const attrs: Record<string, unknown> = {
    ...fromDraft,
    item_name: fromDraft.item_name ?? attrLocaleValue(input.title, marketplaceId),
    condition_type:
      fromDraft.condition_type ?? attrLocaleValue(condition, marketplaceId),
    fulfillment_availability: fromDraft.fulfillment_availability ?? [
      {
        fulfillment_channel_code: "DEFAULT",
        quantity: input.availableQuantity,
      },
    ],
    purchasable_offer: fromDraft.purchasable_offer ?? [
      {
        marketplace_id: marketplaceId,
        currency: "BRL",
        our_price: [{ schedule: [{ value_with_tax: input.price }] }],
      },
    ],
  };

  if (input.brand && !attrs.brand) {
    attrs.brand = attrLocaleValue(input.brand, marketplaceId);
  }
  if (input.description && !attrs.product_description) {
    attrs.product_description = attrLocaleValue(input.description, marketplaceId);
  }

  if (input.imageUrls?.length) {
    if (!attrs.main_product_image_locator) {
      attrs.main_product_image_locator = [
        { media_location: input.imageUrls[0], marketplace_id: marketplaceId },
      ];
    }
    for (let i = 1; i < Math.min(input.imageUrls.length, 9); i++) {
      const key = `other_product_image_locator_${i}`;
      if (!attrs[key]) {
        attrs[key] = [
          { media_location: input.imageUrls[i], marketplace_id: marketplaceId },
        ];
      }
    }
  }

  if (input.externalProductId && !attrs.externally_assigned_product_identifier) {
    attrs.externally_assigned_product_identifier = [
      {
        type: (input.externalProductIdType ?? "EAN").toLowerCase(),
        value: input.externalProductId,
        marketplace_id: marketplaceId,
      },
    ];
  }

  const asin = input.asin?.trim();
  if (asin && !attrs.merchant_suggested_asin) {
    attrs.merchant_suggested_asin = [{ value: asin, marketplace_id: marketplaceId }];
  }

  return attrs;
}

function assertSubmissionAccepted(
  response: AmazonListingsSubmissionResponse | undefined,
  sellerSku: string,
): void {
  const status = response?.status?.toUpperCase();
  const issues = response?.issues ?? [];
  const errorIssues = issues.filter((i) => (i.severity || "").toUpperCase() === "ERROR");
  const issuesText = formatAmazonListingsIssues(issues);

  logger.info(
    {
      sellerSku,
      status: response?.status,
      submissionId: response?.submissionId,
      issueCount: issues.length,
      issues,
    },
    "Amazon putListingsItem response",
  );

  // HTTP 200 + INVALID = rejeitado (antes tratávamos como sucesso e só gravávamos no iHub).
  if (status === "INVALID" || (!status && errorIssues.length > 0)) {
    throw new AmazonListingError(
      issuesText
        ? `Amazon rejeitou o anúncio: ${issuesText}`
        : "Amazon rejeitou o anúncio (status INVALID). Verifique product type e atributos obrigatórios.",
      "AMAZON_API_ERROR",
    );
  }

  if (status && status !== "ACCEPTED" && status !== "VALID") {
    throw new AmazonListingError(
      issuesText
        ? `Amazon não aceitou o anúncio (${status}): ${issuesText}`
        : `Amazon não aceitou o anúncio (status: ${status}).`,
      "AMAZON_API_ERROR",
    );
  }

  if (errorIssues.length > 0) {
    logger.warn(
      { sellerSku, errorIssues },
      "Amazon putListingsItem ACCEPTED with ERROR issues — listing may stay incomplete",
    );
  }
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
): Promise<{ sku: string; productId: string; submissionId?: string }> {
  const sellerSku = input.sellerSku?.trim();
  if (!sellerSku) {
    throw new AmazonListingError("Informe sellerSku", "VALIDATION_ERROR");
  }
  if (!input.productType?.trim() || input.productType.trim().toUpperCase() === "PRODUCT") {
    throw new AmazonListingError(
      "Informe um productType válido do catálogo Amazon (não use PRODUCT).",
      "VALIDATION_ERROR",
    );
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
  const marketplaceId =
    account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

  const asin = input.asin?.trim() || null;
  const requirements =
    input.requirements?.trim() ||
    (asin ? "LISTING_OFFER_ONLY" : "LISTING");

  let productType = input.productType.trim();
  if (asin && requirements === "LISTING_OFFER_ONLY") {
    const catalogType = await getCatalogProductTypeForAsin(accountId, asin, marketplaceId);
    if (catalogType) {
      if (catalogType !== productType) {
        logger.info(
          { asin, fromDraft: productType, catalogType },
          "Using catalog productType for Amazon offer",
        );
      }
      productType = catalogType;
    }
  }

  const attributes =
    requirements === "LISTING_OFFER_ONLY" && asin
      ? buildOfferAttributes(input, marketplaceId, asin)
      : buildCreateAttributes(input, marketplaceId);

  const body = {
    productType,
    requirements,
    attributes,
  };

  let submission: AmazonListingsSubmissionResponse | undefined;
  try {
    submission = await amazon.put<AmazonListingsSubmissionResponse>(
      accountId,
      listingsItemPath(sellerId, sellerSku, marketplaceId),
      body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ accountId, sellerSku, message, requirements }, "Amazon putListingsItem failed");
    throw new AmazonListingError(message, "AMAZON_API_ERROR");
  }

  assertSubmissionAccepted(submission, sellerSku);

  let item: AmazonListingsItem | null = null;
  try {
    item = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
  } catch (err) {
    logger.warn(
      { accountId, sellerSku, err: err instanceof Error ? err.message : String(err) },
      "Amazon getListingsItem after put failed; listing may still be processing",
    );
  }

  if (!item) {
    // Não inventar BUYABLE: grava como submetido para o vendedor ver no iHub com status realista.
    item = {
      sku: sellerSku,
      summaries: [
        {
          marketplaceId,
          asin: asin ?? undefined,
          productType,
          itemName: input.title,
          status: ["SUBMITTED"],
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
  }

  const productId = await upsertProductFromAmazonListing(accountId, item);
  return { sku: sellerSku, productId, submissionId: submission?.submissionId };
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
  const marketplaceId =
    account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

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
    const submission = await amazon.patch<AmazonListingsSubmissionResponse>(
      accountId,
      listingsItemPath(sellerId, sellerSku, marketplaceId),
      body,
    );
    assertSubmissionAccepted(submission, sellerSku);
  } catch (err) {
    if (err instanceof AmazonListingError) throw err;
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
  const marketplaceId =
    account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

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
    const submission = await amazon.patch<AmazonListingsSubmissionResponse>(
      accountId,
      listingsItemPath(sellerId, sellerSku, marketplaceId),
      body,
    );
    assertSubmissionAccepted(submission, sellerSku);
  } catch (err) {
    if (err instanceof AmazonListingError) throw err;
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
    const marketplaceId =
      account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";
    last = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
  }
  await upsertProductFromAmazonListing(accountId, last);
  return last;
}
