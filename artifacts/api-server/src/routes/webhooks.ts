import express, { Router } from "express";
import Stripe from "stripe";
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
import { ml, MlItem, MlOrder, MlQuestion } from "../lib/mercadolivre";

const router = Router();

router.post("/webhooks/mercadolivre", async (req, res) => {
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

        if (q.status === "unanswered") {
          await db.insert(notificationsTable).values({
            userId: account.userId,
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
        const itemsJson = order.order_items.map((oi) => ({
          item_id: oi.item.id,
          title: oi.item.title,
          quantity: oi.quantity,
          price: oi.unit_price,
        }));

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

        await db
          .insert(productsTable)
          .values({
            accountId: account.id,
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
              availableQuantity: item.available_quantity,
              status: item.status,
              price: item.price.toString(),
              lastSyncedAt: new Date(),
            },
          });

        if (item.available_quantity < 5) {
          await db.insert(notificationsTable).values({
            userId: account.userId,
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
