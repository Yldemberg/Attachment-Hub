import { getDb } from "./db";
import {
  fullSettingsTable,
  fullAlertLogTable,
  accountsTable,
} from "@workspace/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { logger } from "./logger";
import { buildFullOverviewForAccount } from "./full-overview";
import type { FullSkuStatus } from "./full-engine";

const N8N_DISPATCH_TIMEOUT_MS = 30_000;

export type FullAlertPayloadItem = {
  type: FullSkuStatus;
  sku: string;
  title: string;
  stockFull: number;
  salesPerDay: number;
  suggestedQty: number;
  sendBy: string | null;
  coverageDays: number | null;
};

export type FullAlertWebhookPayload = {
  kind?: "full";
  accountId: string;
  accountNickname: string | null;
  phone: string;
  alerts: FullAlertPayloadItem[];
  generatedAt: string;
};

export type QuestionAlertWebhookPayload = {
  kind: "question";
  accountId: string;
  accountNickname: string | null;
  phone: string;
  generatedAt: string;
  question: {
    id: string;
    fromNickname: string | null;
    text: string;
    itemId: string | null;
    permalink: string | null;
  };
};

export type WhatsAppN8nPayload = FullAlertWebhookPayload | QuestionAlertWebhookPayload;

async function wasAlertedRecently(
  userId: string,
  accountId: string,
  sku: string,
  alertType: string,
  cooldownHours: number,
): Promise<boolean> {
  const since = new Date(Date.now() - Math.max(1, cooldownHours) * 60 * 60 * 1000);
  const db = getDb();
  const [row] = await db
    .select({ id: fullAlertLogTable.id })
    .from(fullAlertLogTable)
    .where(
      and(
        eq(fullAlertLogTable.userId, userId),
        eq(fullAlertLogTable.accountId, accountId),
        eq(fullAlertLogTable.sku, sku),
        eq(fullAlertLogTable.alertType, alertType),
        gte(fullAlertLogTable.sentAt, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** POST para o mesmo webhook N8N da Gestão Full (Evolution sendText). */
export async function dispatchWhatsAppAlertToN8n(payload: WhatsAppN8nPayload): Promise<boolean> {
  const url = process.env.N8N_FULL_ALERTS_WEBHOOK_URL?.trim();
  if (!url) {
    logger.warn("N8N_FULL_ALERTS_WEBHOOK_URL not set — skipping WhatsApp alert");
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), N8N_DISPATCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { "X-N8N-Secret": process.env.N8N_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, text, kind: payload.kind ?? "full" }, "N8N WhatsApp webhook failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, kind: payload.kind ?? "full" }, "N8N WhatsApp webhook error");
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Quando chega notificação de nova pergunta: envia WhatsApp se a conta tiver
 * telefone + alertQuestions (mesmo número / workflow N8N da Gestão Full).
 */
export async function notifyNewQuestionWhatsApp(opts: {
  userId: string;
  accountId: string;
  accountNickname: string | null;
  question: {
    id: string;
    fromNickname: string | null;
    text: string;
    itemId: string | null;
    permalink: string | null;
  };
}): Promise<boolean> {
  const db = getDb();
  const [settings] = await db
    .select()
    .from(fullSettingsTable)
    .where(
      and(
        eq(fullSettingsTable.userId, opts.userId),
        eq(fullSettingsTable.accountId, opts.accountId),
      ),
    )
    .limit(1);

  if (!settings?.alertQuestions) return false;

  const phone = settings.whatsappPhone?.replace(/\D/g, "") ?? "";
  if (phone.length < 10) {
    logger.info(
      { accountId: opts.accountId },
      "Question WhatsApp skipped — no valid phone in Full settings",
    );
    return false;
  }

  const questionKey = opts.question.id;
  const recent = await wasAlertedRecently(
    opts.userId,
    opts.accountId,
    questionKey,
    "question",
    Math.min(settings.alertCooldownHours, 6),
  );
  if (recent) return false;

  const ok = await dispatchWhatsAppAlertToN8n({
    kind: "question",
    accountId: opts.accountId,
    accountNickname: opts.accountNickname,
    phone,
    generatedAt: new Date().toISOString(),
    question: {
      id: opts.question.id,
      fromNickname: opts.question.fromNickname,
      text: opts.question.text.slice(0, 500),
      itemId: opts.question.itemId,
      permalink: opts.question.permalink,
    },
  });

  if (!ok) return false;

  await db.insert(fullAlertLogTable).values({
    userId: opts.userId,
    accountId: opts.accountId,
    sku: questionKey,
    alertType: "question",
    sentAt: new Date(),
  });

  return true;
}

/**
 * Processa alertas para todas as settings com WhatsApp habilitado.
 */
export async function runFullAlertsJob(): Promise<{ accounts: number; alertsSent: number }> {
  const db = getDb();
  const settingsRows = await db
    .select()
    .from(fullSettingsTable)
    .where(eq(fullSettingsTable.alertsEnabled, true));

  let accounts = 0;
  let alertsSent = 0;

  for (const settings of settingsRows) {
    const phone = settings.whatsappPhone?.replace(/\D/g, "") ?? "";
    if (phone.length < 10) continue;

    accounts += 1;
    try {
      const overview = await buildFullOverviewForAccount({
        userId: settings.userId,
        accountId: settings.accountId,
        settingsOverride: settings,
      });

      const enabledTypes = new Set<FullSkuStatus>();
      if (settings.alertRuptura) enabledTypes.add("ruptura");
      if (settings.alertCritico) enabledTypes.add("critico");
      if (settings.alertParado) enabledTypes.add("parado");

      const candidates = overview.items.filter((it) => enabledTypes.has(it.status));
      const toSend: FullAlertPayloadItem[] = [];

      for (const it of candidates) {
        const recent = await wasAlertedRecently(
          settings.userId,
          settings.accountId,
          it.sku,
          it.status,
          settings.alertCooldownHours,
        );
        if (recent) continue;
        toSend.push({
          type: it.status,
          sku: it.sku,
          title: it.title,
          stockFull: it.stockFull,
          salesPerDay: it.salesPerDay,
          suggestedQty: it.suggestedQty,
          sendBy: it.sendBy,
          coverageDays: it.coverageDays,
        });
      }

      if (toSend.length === 0) continue;

      const [account] = await db
        .select({ mlNickname: accountsTable.mlNickname })
        .from(accountsTable)
        .where(eq(accountsTable.id, settings.accountId))
        .limit(1);

      const ok = await dispatchWhatsAppAlertToN8n({
        kind: "full",
        accountId: settings.accountId,
        accountNickname: account?.mlNickname ?? null,
        phone,
        alerts: toSend.slice(0, 40),
        generatedAt: new Date().toISOString(),
      });

      if (!ok) continue;

      const now = new Date();
      for (const a of toSend.slice(0, 40)) {
        await db.insert(fullAlertLogTable).values({
          userId: settings.userId,
          accountId: settings.accountId,
          sku: a.sku,
          alertType: a.type,
          sentAt: now,
        });
        alertsSent += 1;
      }
    } catch (err) {
      logger.error({ err, accountId: settings.accountId }, "Full alerts job account failed");
    }
  }

  return { accounts, alertsSent };
}

let alertsInterval: ReturnType<typeof setInterval> | null = null;

export function startFullAlertsScheduler(): void {
  if (alertsInterval) return;
  const raw = process.env.FULL_ALERTS_INTERVAL_MS?.trim();
  const intervalMs = raw ? Number(raw) : 60 * 60 * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
    logger.warn({ intervalMs }, "Invalid FULL_ALERTS_INTERVAL_MS — scheduler not started");
    return;
  }

  const tick = async () => {
    try {
      const result = await runFullAlertsJob();
      if (result.alertsSent > 0) {
        logger.info(result, "Full alerts job completed");
      }
    } catch (err) {
      logger.error({ err }, "Full alerts job failed");
    }
  };

  // Primeira execução após 2 min (deixar o server aquecer)
  setTimeout(() => {
    void tick();
  }, 120_000).unref();

  alertsInterval = setInterval(() => {
    void tick();
  }, intervalMs);
  alertsInterval.unref();

  logger.info({ intervalMs }, "Full alerts scheduler started");
}

/** Últimos alertas (debug / UI futura). */
export async function listRecentFullAlerts(userId: string, accountId: string, limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(fullAlertLogTable)
    .where(and(eq(fullAlertLogTable.userId, userId), eq(fullAlertLogTable.accountId, accountId)))
    .orderBy(desc(fullAlertLogTable.sentAt))
    .limit(limit);
}
