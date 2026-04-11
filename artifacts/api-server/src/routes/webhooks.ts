import express, { Router, Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import crypto from "crypto";
import { getDb } from "../lib/db";
import {
  accountsTable,
  notificationsTable,
  productsTable,
  ordersTable,
  questionsTable,
  profilesTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  ml,
  MlItem,
  MlOrder,
  MlQuestion,
  enrichMlItemForSellerSku,
  fetchMlItemVariations,
  fetchMlItemPricesBatch,
  getMlEffectiveLogisticType,
  getMlItemRepresentativeSku,
  getMlOriginalListPrice,
  getMlVariationSku,
  mergeMlVariation,
} from "../lib/mercadolivre";

const router = Router();

const mlRateLimit = new Map<string, { count: number; resetAt: number }>();
const ML_RATE_LIMIT = 120;
const ML_RATE_WINDOW_MS = 60_000;

function mlWebhookRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  let entry = mlRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + ML_RATE_WINDOW_MS };
    mlRateLimit.set(ip, entry);
  }
  entry.count++;
  if (entry.count > ML_RATE_LIMIT) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}

function verifyMlSignature(req: Request): boolean {
  const secret = process.env.ML_WEBHOOK_SECRET;
  if (!secret) return true;

  const signatureHeader = req.headers["x-signature"] as string | undefined;
  const requestId = req.headers["x-request-id"] as string | undefined;
  if (!signatureHeader || !requestId) return false;

  const tsMatch = signatureHeader.match(/ts=([^,]+)/);
  const v1Match = signatureHeader.match(/v1=([^,]+)/);
  if (!tsMatch || !v1Match) return false;

  const ts = tsMatch[1];
  const receivedHmac = v1Match[1];

  const notificationId = (req.query as Record<string, string>).id ?? "";
  const template = `id:${notificationId};request-id:${requestId};ts:${ts}`;
  const expected = crypto.createHmac("sha256", secret).update(template).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedHmac));
}

async function enrichOrderItemsJson(
  accountId: string,
  orderItems: MlOrder["order_items"],
): Promise<Array<{
  item_id: string;
  title: string;
  quantity: number;
  price: number;
  thumbnail: string | null;
  sku: string | null;
  logistic_type: string | null;
}>> {
  const db = getDb();
  return Promise.all(
    orderItems.map(async (oi) => {
      const [product] = await db
        .select({
          thumbnail: productsTable.thumbnail,
          sku: productsTable.sku,
          logisticType: productsTable.logisticType,
        })
        .from(productsTable)
        .where(and(eq(productsTable.accountId, accountId), eq(productsTable.mlItemId, oi.item.id)))
        .limit(1);

      return {
        item_id: oi.item.id,
        title: oi.item.title,
        quantity: oi.quantity,
        price: oi.unit_price,
        thumbnail: product?.thumbnail ?? null,
        sku: product?.sku ?? null,
        logistic_type: product?.logisticType ?? null,
      };
    }),
  );
}

router.post("/webhooks/mercadolivre", mlWebhookRateLimit, async (req, res) => {
  if (!verifyMlSignature(req)) {
    logger.warn("ML webhook signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  res.status(200).json({ status: "ok" });

  const payload = req.body as {
    resource?: string;
    user_id?: number;
    topic?: string;
  };

  if (!payload.resource || !payload.user_id || !payload.topic) return;

  setImmediate(async () => {
    try {
      const db = getDb();
      const [account] = await db
        .select()
        .from(accountsTable)
        .where(eq(accountsTable.mlUserId, String(payload.user_id)));

      if (!account) {
        logger.warn({ mlUserId: payload.user_id }, "ML webhook: account not found");
        return;
      }

      const topic = payload.topic!;
      const resource = payload.resource!;

      if (topic === "questions") {
        const questionId = resource.split("/").pop();
        if (!questionId) return;

        const q = await ml.get<MlQuestion>(account.id, `/questions/${questionId}`);
        await db
          .insert(questionsTable)
          .values({
            accountId: account.id,
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

        if (q.status.toLowerCase() === "unanswered") {
          await db.insert(notificationsTable).values({
            userId: account.userId,
            accountId: account.id,
            type: "new_question",
            title: "Nova pergunta",
            message: `${q.from?.nickname ?? "Comprador"}: ${q.text?.slice(0, 100) ?? ""}`,
            isRead: false,
            resourceType: "question",
            resourceId: q.id.toString(),
          });
        }
      } else if (topic === "orders_v2") {
        const orderId = resource.split("/").pop();
        if (!orderId) return;

        const order = await ml.get<MlOrder>(account.id, `/orders/${orderId}`);
        const itemsJson = await enrichOrderItemsJson(account.id, order.order_items);

        await db
          .insert(ordersTable)
          .values({
            accountId: account.id,
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

        await db.insert(notificationsTable).values({
          userId: account.userId,
          accountId: account.id,
          type: "new_order",
          title: "Novo pedido",
          message: `Pedido #${order.id} de ${order.buyer.nickname} — R$ ${order.total_amount}`,
          isRead: false,
          resourceType: "order",
          resourceId: order.id.toString(),
        });
      } else if (topic === "items") {
        const itemId = resource.split("/").pop();
        if (!itemId) return;

        const item = await ml.get<MlItem>(account.id, `/items/${itemId}`);
        const isFull = item.shipping?.logistic_type === "fulfillment";
        const isFlex = Array.isArray(item.shipping?.tags) && item.shipping.tags!.includes("self_service_in");
        const logisticType = getMlEffectiveLogisticType(item);

        const hasVariations = Array.isArray(item.variations) && item.variations.length > 0;
        let workItem: MlItem = item;
        if (hasVariations) {
          const detailed = await fetchMlItemVariations(account.id, item.id);
          if (detailed.length > 0) {
            const byId = new Map(detailed.map((d) => [d.id, d]));
            workItem = {
              ...item,
              variations: item.variations!.map((v) => mergeMlVariation(v, byId.get(v.id))),
            };
          }
        } else {
          // The individual fetch already returns attributes, but enrich as safety-net
          // in case the endpoint returns a partial response without attributes.
          workItem = await enrichMlItemForSellerSku(account.id, item);
        }
        const sku = getMlItemRepresentativeSku(workItem);
        const variationsJson = hasVariations
          ? workItem.variations!.map((v) => ({
              id: v.id,
              sku: getMlVariationSku(v),
              price: v.price,
              available_quantity: v.available_quantity,
              sold_quantity: v.sold_quantity,
              attributes: (v.attribute_combinations ?? []).map((a) => ({ name: a.name, value: a.value_name })),
            }))
          : null;
        const originalPrice = getMlOriginalListPrice(item);
        const pricesMap = await fetchMlItemPricesBatch(account.id, [item.id]);
        const itemPrices = pricesMap.get(item.id) ?? { amount: null, regularAmount: null };

        await db
          .insert(productsTable)
          .values({
            accountId: account.id,
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
            thumbnail: item.thumbnail,
            permalink: item.permalink,
            mlCategoryId: item.category_id,
            variationsJson,
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [productsTable.accountId, productsTable.mlItemId],
            set: {
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
              thumbnail: item.thumbnail,
              permalink: item.permalink,
              variationsJson,
              lastSyncedAt: new Date(),
            },
          });

        if (item.available_quantity < 5) {
          await db.insert(notificationsTable).values({
            userId: account.userId,
            accountId: account.id,
            type: "low_stock",
            title: "Estoque crítico",
            message: `"${item.title}" tem apenas ${item.available_quantity} unidade(s)`,
            isRead: false,
            resourceType: "product",
            resourceId: item.id,
          });
        }
      }
    } catch (err) {
      logger.error({ err, payload }, "ML webhook processing failed");
    }
  });
});

router.post("/webhooks/stripe", async (req, res) => {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecret || !webhookSecret) {
    logger.warn("Stripe webhook received but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET not configured");
    res.status(200).json({ received: true });
    return;
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2026-03-25.dahlia" });
  const sig = req.headers["stripe-signature"] as string;

  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody ?? req.body;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  res.status(200).json({ received: true });

  setImmediate(async () => {
    try {
      const db = getDb();

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const userId = session.client_reference_id;

        if (userId) {
          await db
            .update(profilesTable)
            .set({
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              plan: "basic",
              trialEndsAt: null,
            })
            .where(eq(profilesTable.id, userId));
        } else {
          await db
            .update(profilesTable)
            .set({
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              plan: "basic",
              trialEndsAt: null,
            })
            .where(eq(profilesTable.stripeCustomerId, customerId));
        }
      } else if (event.type === "customer.subscription.updated") {
        const subscription = event.data.object as Stripe.Subscription;
        const plan = subscription.status === "active" ? "basic" : "trial";

        await db
          .update(profilesTable)
          .set({ plan, stripeSubscriptionId: subscription.id })
          .where(eq(profilesTable.stripeSubscriptionId, subscription.id));
      } else if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as Stripe.Subscription;
        await db
          .update(profilesTable)
          .set({ plan: "trial", stripeSubscriptionId: null })
          .where(eq(profilesTable.stripeSubscriptionId, subscription.id));
      }
    } catch (err) {
      logger.error({ err, eventType: event.type }, "Stripe webhook processing failed");
    }
  });
});

export default router;
