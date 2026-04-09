import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { accountsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { getMlAuthUrl, exchangeCodeForTokens, ml, MlUser } from "../lib/mercadolivre";
import { syncAccount } from "../lib/sync";
import { createOAuthState, consumeOAuthState } from "../lib/oauth-state";

const router = Router();
const auth = [requireAuth, requireActivePlan];

router.get("/accounts", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const accounts = await db
      .select({
        id: accountsTable.id,
        userId: accountsTable.userId,
        mlUserId: accountsTable.mlUserId,
        mlNickname: accountsTable.mlNickname,
        mlEmail: accountsTable.mlEmail,
        isActive: accountsTable.isActive,
        lastSyncAt: accountsTable.lastSyncAt,
        createdAt: accountsTable.createdAt,
        updatedAt: accountsTable.updatedAt,
      })
      .from(accountsTable)
      .where(eq(accountsTable.userId, req.user!.id));

    res.json({ data: accounts });
  } catch (err) {
    req.log.error({ err }, "Failed to list accounts");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.get("/accounts/connect/url", requireAuth, async (req, res) => {
  try {
    const state = createOAuthState(req.user!.id);
    const url = getMlAuthUrl(state);
    res.json({ url, state });
  } catch (err) {
    req.log.error({ err }, "Failed to get connect URL");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.get("/accounts/connect/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    res.redirect("/integrations?error=missing_params");
    return;
  }

  const userId = consumeOAuthState(state);
  if (!userId) {
    res.redirect("/integrations?error=invalid_state");
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const db = getDb();

    const mlUserRes = await fetch(`https://api.mercadolibre.com/users/${tokens.user_id}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const mlUser = (await mlUserRes.json()) as MlUser;

    const [account] = await db
      .insert(accountsTable)
      .values({
        userId,
        mlUserId: String(tokens.user_id),
        mlNickname: mlUser.nickname,
        mlEmail: mlUser.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [accountsTable.mlUserId],
        set: {
          userId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: expiresAt,
          mlNickname: mlUser.nickname,
          mlEmail: mlUser.email,
          isActive: true,
        },
      })
      .returning();

    setImmediate(() => {
      if (account?.id) {
        syncAccount(account.id, userId).catch((err) => {
          console.error({ err, accountId: account.id }, "Background sync failed");
        });
      }
    });

    res.redirect("/integrations?success=true");
  } catch (err) {
    req.log.error({ err }, "OAuth callback failed");
    res.redirect("/integrations?error=oauth_failed");
  }
});

router.get("/accounts/:id", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const [account] = await db
      .select({
        id: accountsTable.id,
        userId: accountsTable.userId,
        mlUserId: accountsTable.mlUserId,
        mlNickname: accountsTable.mlNickname,
        mlEmail: accountsTable.mlEmail,
        isActive: accountsTable.isActive,
        lastSyncAt: accountsTable.lastSyncAt,
        createdAt: accountsTable.createdAt,
        updatedAt: accountsTable.updatedAt,
      })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, req.params.id as string), eq(accountsTable.userId, req.user!.id)));

    if (!account) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    res.json(account);
  } catch (err) {
    req.log.error({ err }, "Failed to get account");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.delete("/accounts/:id", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const deleted = await db
      .delete(accountsTable)
      .where(and(eq(accountsTable.id, req.params.id as string), eq(accountsTable.userId, req.user!.id)))
      .returning({ id: accountsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete account");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.post("/accounts/:id/sync", ...auth, async (req, res) => {
  try {
    res.status(202).json({ message: "Sync initiated" });

    setImmediate(() => {
      syncAccount(req.params.id as string, req.user!.id).catch((err) => {
        req.log.error({ err, accountId: req.params.id }, "Sync failed");
      });
    });
  } catch (err) {
    req.log.error({ err }, "Failed to initiate sync");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
