import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { questionsTable, accountsTable, productsTable } from "@workspace/db/schema";
import { eq, and, inArray, or, sql } from "drizzle-orm";
import { ml } from "../lib/mercadolivre";
import { getUserAccountIds } from "../lib/account-scope";

const router = Router();
const auth = [requireAuth, requireActivePlan];

router.get("/questions", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { account_id, status, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const accountIds = await getUserAccountIds(req.user!.id, account_id);
    if (accountIds.length === 0) {
      res.json({ data: [], pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 } });
      return;
    }

    const conditions = [inArray(questionsTable.accountId, accountIds)];
    if (status) conditions.push(eq(questionsTable.status, status));

    const where = and(...conditions);

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as int)` }).from(questionsTable).where(where),
      db.select().from(questionsTable).where(where)
        .orderBy(sql`${questionsTable.dateCreated} desc nulls last`)
        .limit(limitNum).offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    const accounts = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(inArray(accountsTable.id, accountIds));
    const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

    const pairs = rows.filter((r) => r.mlItemId != null && String(r.mlItemId).length > 0);
    const listingByKey: Record<string, { listingThumbnailUrl: string | null; listingPermalink: string | null }> = {};
    if (pairs.length > 0) {
      const prods = await db
        .select({
          accountId: productsTable.accountId,
          mlItemId: productsTable.mlItemId,
          thumbnail: productsTable.thumbnail,
          permalink: productsTable.permalink,
        })
        .from(productsTable)
        .where(
          or(
            ...pairs.map((r) =>
              and(eq(productsTable.accountId, r.accountId), eq(productsTable.mlItemId, String(r.mlItemId))),
            ),
          )!,
        );
      for (const p of prods) {
        listingByKey[`${p.accountId}:${p.mlItemId}`] = {
          listingThumbnailUrl: p.thumbnail,
          listingPermalink: p.permalink,
        };
      }
    }

    res.json({
      data: rows.map((q) => {
        const key = q.mlItemId ? `${q.accountId}:${q.mlItemId}` : "";
        const listing = key ? listingByKey[key] : undefined;
        return {
          ...q,
          mlQuestionId: q.mlQuestionId !== null ? Number(q.mlQuestionId) : null,
          fromUserId: q.fromUserId !== null ? Number(q.fromUserId) : null,
          listingThumbnailUrl: listing?.listingThumbnailUrl ?? null,
          listingPermalink: listing?.listingPermalink ?? null,
          account: accountMap[q.accountId] ?? null,
        };
      }),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list questions");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.get("/questions/:id", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Question not found" } });
      return;
    }

    const [question] = await db
      .select()
      .from(questionsTable)
      .where(and(eq(questionsTable.id, req.params.id as string), inArray(questionsTable.accountId, accountIds)));

    if (!question) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Question not found" } });
      return;
    }

    const [account] = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(eq(accountsTable.id, question.accountId));

    let listingThumbnailUrl: string | null = null;
    let listingPermalink: string | null = null;
    if (question.mlItemId) {
      const [p] = await db
        .select({ thumbnail: productsTable.thumbnail, permalink: productsTable.permalink })
        .from(productsTable)
        .where(
          and(eq(productsTable.accountId, question.accountId), eq(productsTable.mlItemId, question.mlItemId)),
        )
        .limit(1);
      listingThumbnailUrl = p?.thumbnail ?? null;
      listingPermalink = p?.permalink ?? null;
    }

    res.json({
      ...question,
      mlQuestionId: question.mlQuestionId !== null ? Number(question.mlQuestionId) : null,
      fromUserId: question.fromUserId !== null ? Number(question.fromUserId) : null,
      listingThumbnailUrl,
      listingPermalink,
      account: account ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get question");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.post("/questions/:id/answer", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { text } = req.body as { text: string };

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Answer text is required" } });
      return;
    }

    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Question not found" } });
      return;
    }

    const [question] = await db
      .select()
      .from(questionsTable)
      .where(and(eq(questionsTable.id, req.params.id as string), inArray(questionsTable.accountId, accountIds)));

    if (!question) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Question not found" } });
      return;
    }

    if (question.status === "answered") {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Question already answered" } });
      return;
    }

    await ml.post(question.accountId, "/answers", {
      question_id: Number(question.mlQuestionId),
      text: text.trim(),
    });

    const now = new Date();
    const [updated] = await db
      .update(questionsTable)
      .set({ answerText: text.trim(), answerDate: now, status: "answered" })
      .where(eq(questionsTable.id, question.id))
      .returning();

    res.json({
      ...updated,
      mlQuestionId: updated.mlQuestionId !== null ? Number(updated.mlQuestionId) : null,
      fromUserId: updated.fromUserId !== null ? Number(updated.fromUserId) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to answer question");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
