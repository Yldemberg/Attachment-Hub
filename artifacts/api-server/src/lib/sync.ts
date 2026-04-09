import { getDb } from "./db";
import { ml, MlItem, MlOrder, MlQuestion } from "./mercadolivre";
import {
  productsTable,
  ordersTable,
  questionsTable,
  accountsTable,
  notificationsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

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

    for (const { code, body: item } of items) {
      if (code !== 200 || !item) continue;
      const isFull = item.shipping?.logistic_type === "fulfillment";
      await db
        .insert(productsTable)
        .values({
          accountId,
          mlItemId: item.id,
          title: item.title,
          sku: item.seller_custom_field ?? null,
          price: item.price.toString(),
          availableQuantity: item.available_quantity,
          soldQuantity: item.sold_quantity,
          status: item.status,
          listingType: item.listing_type_id,
          logisticType: item.shipping?.logistic_type ?? null,
          isFull,
          thumbnail: item.thumbnail,
          permalink: item.permalink,
          mlCategoryId: item.category_id,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [productsTable.accountId, productsTable.mlItemId],
          set: {
            title: item.title,
            sku: item.seller_custom_field ?? null,
            price: item.price.toString(),
            availableQuantity: item.available_quantity,
            soldQuantity: item.sold_quantity,
            status: item.status,
            listingType: item.listing_type_id,
            logisticType: item.shipping?.logistic_type ?? null,
            isFull,
            thumbnail: item.thumbnail,
            permalink: item.permalink,
            mlCategoryId: item.category_id,
            lastSyncedAt: new Date(),
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
      const itemsJson = order.order_items.map((oi) => ({
        item_id: oi.item.id,
        title: oi.item.title,
        quantity: oi.quantity,
        price: oi.unit_price,
      }));

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
          shippingStatus: order.shipping?.status ?? null,
          dateCreated: order.date_created ? new Date(order.date_created) : null,
          dateClosed: order.date_closed ? new Date(order.date_closed) : null,
          itemsJson,
        })
        .onConflictDoUpdate({
          target: [ordersTable.accountId, ordersTable.mlOrderId],
          set: {
            status: order.status,
            shippingStatus: order.shipping?.status ?? null,
            dateClosed: order.date_closed ? new Date(order.date_closed) : null,
            itemsJson,
          },
        });
    }

    if (result.results.length < limit) break;
    offset += limit;
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
          status: q.status,
          fromUserId: q.from?.id ? BigInt(q.from.id) : null,
          fromUserNickname: q.from?.nickname ?? null,
          answerText: q.answer?.text ?? null,
          answerDate: q.answer?.date_created ? new Date(q.answer.date_created) : null,
          dateCreated: q.date_created ? new Date(q.date_created) : null,
        })
        .onConflictDoUpdate({
          target: [questionsTable.accountId, questionsTable.mlQuestionId],
          set: {
            status: q.status,
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

  if (!account || !account.mlUserId) {
    throw new Error("Account not found or ml_user_id missing");
  }

  logger.info({ accountId }, "Starting account sync");

  await syncProducts(accountId, account.mlUserId);
  await syncOrders(accountId, account.mlUserId);
  await syncQuestions(accountId, account.mlUserId);

  await db
    .update(accountsTable)
    .set({ lastSyncAt: new Date() })
    .where(eq(accountsTable.id, accountId));

  await db.insert(notificationsTable).values({
    userId,
    type: "sync_error",
    title: "Sincronização concluída",
    message: `Conta ${account.mlNickname ?? accountId} sincronizada com sucesso.`,
    isRead: false,
    resourceType: "account",
    resourceId: accountId,
  });

  logger.info({ accountId }, "Account sync complete");
}
