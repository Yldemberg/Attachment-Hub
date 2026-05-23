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

function buildRedirectUri(req: import("express").Request): string {
  const forwardedHost = req.headers["x-forwarded-host"] as string | undefined;
  const host = (forwardedHost ? forwardedHost.split(",")[0].trim() : req.headers["host"]) ?? "";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined ?? (req.secure ? "https" : "http")).split(",")[0].trim();
  return `${proto}://${host}/api/callback`;
}

function maskClientId(id: string | null | undefined): string | null {
  if (!id || id.length < 4) return null;
  return "•••" + id.slice(-4);
}

function serializeAccount(row: typeof accountsTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    mlUserId: row.mlUserId,
    mlNickname: row.mlNickname,
    mlEmail: row.mlEmail,
    isActive: row.isActive,
    lastSyncAt: row.lastSyncAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasMpCredentials: !!(row.mpClientId && row.mpAccessToken),
    mpClientIdMasked: maskClientId(row.mpClientId),
  };
}

router.get("/accounts", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.userId, req.user!.id));

    res.json({ data: rows.map(serializeAccount) });
  } catch (err) {
    req.log.error({ err }, "Failed to list accounts");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.get("/accounts/connect/url", ...auth, async (req, res) => {
  try {
    const state = await createOAuthState(req.user!.id);
    const redirectUri = buildRedirectUri(req);
    const url = getMlAuthUrl(state, redirectUri);
    res.json({ url, state });
  } catch (err) {
    req.log.error({ err }, "Failed to get connect URL");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

async function handleOAuthCallback(
  req: import("express").Request,
  res: import("express").Response,
) {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    res.redirect("/integrations?error=missing_params");
    return;
  }

  const userId = await consumeOAuthState(state);
  if (!userId) {
    res.redirect("/integrations?error=invalid_state");
    return;
  }

  try {
    const redirectUri = buildRedirectUri(req);
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const db = getDb();

    const mlUserRes = await fetch(`https://api.mercadolibre.com/users/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const mlUser = (await mlUserRes.json()) as MlUser;

    const mlUserIdStr = String(tokens.user_id);

    const [existing] = await db
      .select({ id: accountsTable.id, userId: accountsTable.userId })
      .from(accountsTable)
      .where(eq(accountsTable.mlUserId, mlUserIdStr));

    if (existing && existing.userId !== userId) {
      res.redirect("/integrations?error=account_already_linked");
      return;
    }

    const [account] = await db
      .insert(accountsTable)
      .values({
        userId,
        mlUserId: mlUserIdStr,
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
}

router.get("/callback", handleOAuthCallback);
router.get("/accounts/connect/callback", handleOAuthCallback);

router.get("/accounts/:id", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.id, req.params.id as string), eq(accountsTable.userId, req.user!.id)));

    if (!row) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    res.json(serializeAccount(row));
  } catch (err) {
    req.log.error({ err }, "Failed to get account");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.put("/accounts/:id/mp-credentials", ...auth, async (req, res) => {
  const { mpClientId, mpClientSecret, mpAccessToken } = req.body as {
    mpClientId?: unknown;
    mpClientSecret?: unknown;
    mpAccessToken?: unknown;
  };

  if (
    typeof mpClientId !== "string" || !mpClientId.trim() ||
    typeof mpClientSecret !== "string" || !mpClientSecret.trim() ||
    typeof mpAccessToken !== "string" || !mpAccessToken.trim()
  ) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "mpClientId, mpClientSecret e mpAccessToken são obrigatórios" } });
    return;
  }

  try {
    const db = getDb();
    const [updated] = await db
      .update(accountsTable)
      .set({
        mpClientId: mpClientId.trim(),
        mpClientSecret: mpClientSecret.trim(),
        mpAccessToken: mpAccessToken.trim(),
        updatedAt: new Date(),
      })
      .where(and(eq(accountsTable.id, req.params.id as string), eq(accountsTable.userId, req.user!.id)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    res.json({
      hasMpCredentials: true,
      mpClientIdMasked: maskClientId(updated.mpClientId),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to save MP credentials");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.delete("/accounts/:id/mp-credentials", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const [updated] = await db
      .update(accountsTable)
      .set({
        mpClientId: null,
        mpClientSecret: null,
        mpAccessToken: null,
        updatedAt: new Date(),
      })
      .where(and(eq(accountsTable.id, req.params.id as string), eq(accountsTable.userId, req.user!.id)))
      .returning({ id: accountsTable.id });

    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    res.json({ hasMpCredentials: false, mpClientIdMasked: null });
  } catch (err) {
    req.log.error({ err }, "Failed to remove MP credentials");
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
    const db = getDb();
    const accountId = req.params.id as string;
    const [account] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, accountId), eq(accountsTable.userId, req.user!.id)));

    if (!account) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    res.status(202).json({ message: "Sync initiated" });

    setImmediate(() => {
      syncAccount(accountId, req.user!.id).catch((err) => {
        req.log.error({ err, accountId }, "Sync failed");
      });
    });
  } catch (err) {
    req.log.error({ err }, "Failed to initiate sync");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
