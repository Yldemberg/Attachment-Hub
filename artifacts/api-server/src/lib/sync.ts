import { getDb } from "./db";
import {
  ml,
  MlItem,
  MlOrder,
  MlQuestion,
  enrichMlItemForSellerSku,
  enrichMlItem,
  fetchMlItemVariations,
  fetchMlItemPricesBatch,
  getMlEffectiveLogisticType,
  getMlItemRepresentativeSku,
  getMlOriginalListPrice,
  getMlVariationSku,
  itemIsMlFull,
  mergeMlVariation,
} from "./mercadolivre";
import { buildMlOrderStoredPayload } from "./ml-order-payload";
import {
  productsTable,
  ordersTable,
  questionsTable,
  accountsTable,
  notificationsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { applyMandateStockFromWebhookOrder } from "./order-mandate-stock";
import { syncListingTemplatesForAccount } from "./listing-templates";

const ALL_ML_STATUSES = ["active", "paused", "closed", "under_review"];

async function syncProducts(accountId: string, mlUserId: string): Promise<void> {
  const db = getDb();
  const limit = 50;
  const allItemIds: string[] = [];

  for (const status of ALL_ML_STATUSES) {
    let offset = 0;
    while (true) {
      const result = await ml.get<{ results: string[]; paging: { total: number } }>(
        accountId,
        `/users/${mlUserId}/items/search?status=${status}&limit=${limit}&offset=${offset}`,
      );
      allItemIds.push(...result.results);
      if (result.results.length < limit) break;
      offset += limit;
    }
  }

  const BATCH = 20;
  for (let i = 0; i < allItemIds.length; i += BATCH) {
    const batch = allItemIds.slice(i, i + BATCH);
    const items = await ml.get<Array<{ code: number; body: MlItem }>>(
      accountId,
      `/items?ids=${batch.join(",")}`,
    );

    // Fetch prices for the whole batch in one call.
    const validItems = items.filter(({ code }) => code === 200);
    const pricesMap = await fetchMlItemPricesBatch(
      accountId,
      validItems.map(({ body }) => body.id),
    );

    for (const { code, body: item } of items) {
      if (code !== 200 || !item) continue;

      const hasVariations = Array.isArray(item.variations) && item.variations.length > 0;

      let workItem: MlItem = item;
      if (!hasVariations) {
        workItem = await enrichMlItemForSellerSku(accountId, item);
      } else {
        const detailed = await fetchMlItemVariations(accountId, item.id);
        if (detailed.length > 0) {
          const byId = new Map(detailed.map((d) => [d.id, d]));
          workItem = {
            ...item,
            variations: item.variations!.map((v) => mergeMlVariation(v, byId.get(v.id))),
          };
        }
      }

      // Batch endpoint may omit shipping.tags, logistic_type and catalog_listing; enrich from GET /items/{id}.
      // Single fetch covers both fields to avoid duplicate API calls.
      const mlItemForDb = await enrichMlItem(accountId, workItem);
      const isFull = itemIsMlFull(mlItemForDb);
      const isFlex =
        Array.isArray(mlItemForDb.shipping?.tags) && mlItemForDb.shipping.tags!.includes("self_service_in");
      const logisticType = getMlEffectiveLogisticType(mlItemForDb);

      const sku = getMlItemRepresentativeSku(workItem);

      const variationsJson = hasVariations
        ? workItem.variations!.map((v) => ({
            id: v.id,
            sku: getMlVariationSku(v),
            price: v.price,
            available_quantity: v.available_quantity,
            sold_quantity: v.sold_quantity,
            attributes: (v.attribute_combinations ?? []).map((a) => ({
              name: a.name,
              value: a.value_name,
            })),
          }))
        : null;

      const originalPrice = getMlOriginalListPrice(item);
      const itemPrices = pricesMap.get(item.id) ?? { amount: null, regularAmount: null };

      const values = {
        accountId,
        mlItemId: item.id,
        title: item.title,
        sku,
        price: item.price.toString(),
        originalPrice,
        amount: itemPrices.amount,
        regularAmount: itemPrices.regularAmount,
        availableQuantity: item.available_quantity,
        soldQuantity: item.sold_quantity,
        status: item.status,
        listingType: item.listing_type_id,
        logisticType,
        isFull,
        isFlex,
        catalogListing: !!mlItemForDb.catalog_listing,
        thumbnail: item.thumbnail,
        permalink: item.permalink,
        mlCategoryId: item.category_id,
        variationsJson,
        lastSyncedAt: new Date(),
      };

      await db
        .insert(productsTable)
        .values(values)
        .onConflictDoUpdate({
          target: [productsTable.accountId, productsTable.mlItemId],
          set: {
            title: values.title,
            sku: values.sku,
            price: values.price,
            originalPrice: values.originalPrice,
            amount: itemPrices.amount,
            regularAmount: itemPrices.regularAmount,
            availableQuantity: values.availableQuantity,
            soldQuantity: values.soldQuantity,
            status: values.status,
            listingType: values.listingType,
            logisticType: values.logisticType,
            isFull: values.isFull,
            isFlex: values.isFlex,
            catalogListing: values.catalogListing,
            thumbnail: values.thumbnail,
            permalink: values.permalink,
            mlCategoryId: values.mlCategoryId,
            variationsJson: values.variationsJson,
            lastSyncedAt: values.lastSyncedAt,
          },
        });
    }
  }
}

async function syncOrders(accountId: string, mlUserId: string): Promise<void> {
  const db = getDb();
  let offset = 0;
  const limit = 50;

  while (true) {
    const result = await ml.get<{ results: MlOrder[]; paging: { total: number } }>(
      accountId,
      `/orders/search?seller=${mlUserId}&sort=date_desc&limit=${limit}&offset=${offset}`,
    );

    for (const order of result.results) {
      const { itemsJson, shippingStatus, shippingSubstatus, reportFinancials } =
        await buildMlOrderStoredPayload(accountId, order);

      await db
        .insert(ordersTable)
        .values({
          accountId,
          mlOrderId: BigInt(order.id),
          status: order.status,
          totalAmount: order.total_amount.toString(),
          currencyId: order.currency_id,
          buyerId: BigInt(order.buyer.id),
          buyerNickname: order.buyer.nickname,
          shippingId: order.shipping?.id ? BigInt(order.shipping.id) : null,
          shippingStatus,
          shippingSubstatus,
          dateCreated: order.date_created ? new Date(order.date_created) : null,
          dateClosed: order.date_closed ? new Date(order.date_closed) : null,
          itemsJson,
          reportFinancials,
        })
        .onConflictDoUpdate({
          target: [ordersTable.accountId, ordersTable.mlOrderId],
          set: {
            status: order.status,
            shippingStatus,
            shippingSubstatus,
            dateClosed: order.date_closed ? new Date(order.date_closed) : null,
            itemsJson,
            reportFinancials,
          },
        });

      await applyMandateStockFromWebhookOrder(accountId, order);
    }

    if (result.results.length < limit) break;
    offset += limit;
    // ML orders/search caps at offset 10 000; stop before hitting the limit.
    if (offset >= 10000) break;
  }
}

async function syncQuestions(accountId: string, mlUserId: string): Promise<void> {
  const db = getDb();
  let offset = 0;
  const limit = 50;

  while (true) {
    const result = await ml.get<{ questions: MlQuestion[]; paging: { total: number } }>(
      accountId,
      `/questions/search?seller_id=${mlUserId}&status=unanswered&limit=${limit}&offset=${offset}`,
    );

    for (const q of result.questions) {
      await db
        .insert(questionsTable)
        .values({
          accountId,
          mlQuestionId: BigInt(q.id),
          mlItemId: q.item_id,
          text: q.text,
          status: q.status.toLowerCase(),
          fromUserId: q.from?.id ? BigInt(q.from.id) : null,
          fromUserNickname: q.from?.nickname ?? null,
          answerText: q.answer?.text ?? null,
          answerDate: q.answer?.date_created ? new Date(q.answer.date_created) : null,
          dateCreated: q.date_created ? new Date(q.date_created) : null,
        })
        .onConflictDoUpdate({
          target: [questionsTable.accountId, questionsTable.mlQuestionId],
          set: {
            status: q.status.toLowerCase(),
            answerText: q.answer?.text ?? null,
            answerDate: q.answer?.date_created ? new Date(q.answer.date_created) : null,
          },
        });
    }

    if (result.questions.length < limit) break;
    offset += limit;
  }
}

export async function syncAccount(accountId: string, userId: string): Promise<void> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.userId, userId)));

  if (!account) {
    throw new Error("Account not found");
  }

  if (account.platform === "amazon") {
    const { syncAmazonAccount } = await import("./amazon-sync");
    await syncAmazonAccount(accountId, userId);
    return;
  }

  if (!account.mlUserId) {
    throw new Error("Account not found or ml_user_id missing");
  }

  logger.info({ accountId }, "Starting account sync");

  await syncProducts(accountId, account.mlUserId);
  await syncOrders(accountId, account.mlUserId);
  await syncQuestions(accountId, account.mlUserId);

  // Snapshot completo dos anúncios (descrição, fotos, atributos, etc.) para uso como modelos.
  try {
    await syncListingTemplatesForAccount(accountId, userId);
  } catch (err) {
    logger.error({ err, accountId }, "Listing templates sync failed after account sync");
  }

  await db
    .update(accountsTable)
    .set({ lastSyncAt: new Date() })
    .where(eq(accountsTable.id, accountId));

  await db.insert(notificationsTable).values({
    userId,
    accountId,
    type: "sync_complete",
    title: "Sincronização concluída",
    message: `Conta ${account.mlNickname ?? accountId} sincronizada com sucesso.`,
    isRead: false,
    resourceType: "account",
    resourceId: accountId,
  });

  logger.info({ accountId }, "Account sync complete");
}
