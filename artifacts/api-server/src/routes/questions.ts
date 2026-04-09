import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { questionsTable, accountsTable } from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { ml } from "../lib/mercadolivre";

const router = Router();
const auth = [requireAuth, requireActivePlan];

async function getUserAccountIds(userId: string, filterAccountId?: string): Promise<string[]> {
  const db = getDb();
  const conditions = [eq(accountsTable.userId, userId), eq(accountsTable.isActive, true)];
  if (filterAccountId) conditions.push(eq(accountsTable.id, filterAccountId));
  const accounts = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(...conditions));
  return accounts.map((a) => a.id);
}

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

    res.json({
      data: rows.map((q) => ({ ...q, account: accountMap[q.accountId] ?? null })),
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

    res.json(question);
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

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to answer question");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
