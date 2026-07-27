import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { accountsTable } from "@workspace/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { getMlAuthUrl, exchangeCodeForTokens, ml, MlUser } from "../lib/mercadolivre";
import {
  exchangeRefreshTokenForAccess,
  fetchMarketplaceParticipationsWithToken,
  getAmazonEnvCredentials,
  getAmazonLwaAppCredentials,
  getAmazonMarketplaceId,
} from "../lib/amazon";
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

function maskField(value: string | null | undefined): string | null {
  if (!value || value.length < 4) return null;
  return "•••" + value.slice(-4);
}

function serializeAccount(row: typeof accountsTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    platform: row.platform ?? "mercadolivre",
    mlUserId: row.mlUserId,
    mlNickname: row.mlNickname,
    mlEmail: row.mlEmail,
    amazonSellerId: row.amazonSellerId,
    amazonMarketplaceId: row.amazonMarketplaceId,
    amazonStoreName: row.amazonStoreName,
    isActive: row.isActive,
    lastSyncAt: row.lastSyncAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasMpCredentials: !!(row.mpClientId && row.mpAccessToken),
    mpClientIdMasked: maskField(row.mpClientId),
    mpClientSecretMasked: maskField(row.mpClientSecret),
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

router.post("/accounts/amazon/connect", ...auth, async (req, res) => {
  try {
    const lwa = getAmazonLwaAppCredentials();
    const body = (req.body ?? {}) as {
      sellerId?: string;
      refreshToken?: string;
      marketplaceId?: string;
      storeName?: string;
    };

    const bodyRefresh =
      typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
    const bodySellerId = typeof body.sellerId === "string" ? body.sellerId.trim() : "";
    const bodyStoreName =
      typeof body.storeName === "string" ? body.storeName.trim() : "";
    const bodyMarketplaceId =
      typeof body.marketplaceId === "string" ? body.marketplaceId.trim() : "";

    if ((bodyRefresh && !bodySellerId) || (!bodyRefresh && bodySellerId)) {
      res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message: "Informe sellerId e refreshToken juntos (ou omita ambos para usar o env do servidor).",
        },
      });
      return;
    }

    let refreshToken = bodyRefresh;
    let sellerId = bodySellerId;

    // Sem token no body: usa env legado (1ª loja / setup privado único).
    if (!refreshToken || !sellerId) {
      const env = getAmazonEnvCredentials();
      if (!refreshToken) refreshToken = env.refreshToken;
      if (!sellerId) sellerId = env.sellerId;
    }

    if (!refreshToken || !sellerId) {
      res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message:
            "Informe sellerId e refreshToken da loja Amazon (ou configure AMAZON_SELLER_ID / AMAZON_REFRESH_TOKEN no servidor).",
        },
      });
      return;
    }

    const tokenData = await exchangeRefreshTokenForAccess(
      refreshToken,
      lwa.clientId,
      lwa.clientSecret,
    );
    const participations = await fetchMarketplaceParticipationsWithToken(tokenData.access_token);
    const marketplaceId = bodyMarketplaceId || getAmazonMarketplaceId();
    const br = participations.find((p) => p.marketplace.id === marketplaceId) ?? participations[0];

    if (!br?.participation?.isParticipating) {
      res.status(400).json({
        error: {
          code: "AMAZON_NOT_PARTICIPATING",
          message: "Conta Amazon sem participação ativa no marketplace configurado",
        },
      });
      return;
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    const db = getDb();
    const userId = req.user!.id;
    const storedRefresh = tokenData.refresh_token ?? refreshToken;
    const storeName = bodyStoreName || br.storeName || "Amazon";

    // Mesmo Seller ID não pode pertencer a outro usuário iHub
    const [linkedElsewhere] = await db
      .select({ id: accountsTable.id, userId: accountsTable.userId })
      .from(accountsTable)
      .where(
        and(eq(accountsTable.platform, "amazon"), eq(accountsTable.amazonSellerId, sellerId)),
      );

    if (linkedElsewhere && linkedElsewhere.userId !== userId) {
      res.status(409).json({
        error: {
          code: "ACCOUNT_ALREADY_LINKED",
          message: "Este Seller ID Amazon já está vinculado a outra conta iHub.",
        },
      });
      return;
    }

    // Upsert por seller (permite várias lojas/CNPJs no mesmo usuário, mesmo app LWA)
    const [existingBySeller] = await db
      .select()
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.userId, userId),
          eq(accountsTable.platform, "amazon"),
          eq(accountsTable.amazonSellerId, sellerId),
        ),
      );

    // Legado: uma linha amazon sem seller id — atualiza em vez de duplicar
    let existing = existingBySeller;
    if (!existing) {
      const [orphan] = await db
        .select()
        .from(accountsTable)
        .where(
          and(
            eq(accountsTable.userId, userId),
            eq(accountsTable.platform, "amazon"),
            or(isNull(accountsTable.amazonSellerId), eq(accountsTable.amazonSellerId, "")),
          ),
        );
      existing = orphan;
    }

    let account: typeof accountsTable.$inferSelect;
    if (existing) {
      const [updated] = await db
        .update(accountsTable)
        .set({
          amazonSellerId: sellerId,
          amazonMarketplaceId: br.marketplace.id,
          amazonStoreName: storeName,
          accessToken: tokenData.access_token,
          refreshToken: storedRefresh,
          tokenExpiresAt: expiresAt,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(accountsTable.id, existing.id))
        .returning();
      account = updated;
    } else {
      const [inserted] = await db
        .insert(accountsTable)
        .values({
          userId,
          platform: "amazon",
          amazonSellerId: sellerId,
          amazonMarketplaceId: br.marketplace.id,
          amazonStoreName: storeName,
          accessToken: tokenData.access_token,
          refreshToken: storedRefresh,
          tokenExpiresAt: expiresAt,
          isActive: true,
        })
        .returning();
      account = inserted;
    }

    setImmediate(() => {
      syncAccount(account.id, userId).catch((err) => {
        console.error({ err, accountId: account.id }, "Background Amazon sync failed");
      });
    });

    res.status(201).json(serializeAccount(account));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao conectar Amazon";
    req.log.error({ err }, "Amazon connect failed");
    if (message.includes("não configurada") || message.includes("AMAZON_")) {
      res.status(503).json({ error: { code: "AMAZON_NOT_CONFIGURED", message } });
      return;
    }
    res.status(502).json({ error: { code: "AMAZON_API_ERROR", message } });
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
        platform: "mercadolivre",
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
          platform: "mercadolivre",
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
  const body = req.body as Record<string, unknown>;
  const mpClientId = typeof body.mpClientId === "string" ? body.mpClientId.trim() : "";
  const mpClientSecret = typeof body.mpClientSecret === "string" ? body.mpClientSecret.trim() : "";
  const mpAccessToken = typeof body.mpAccessToken === "string" ? body.mpAccessToken.trim() : "";

  const missing = [
    !mpClientId && "mpClientId",
    !mpClientSecret && "mpClientSecret",
    !mpAccessToken && "mpAccessToken",
  ].filter(Boolean);

  if (missing.length > 0) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Campos obrigatórios: ${missing.join(", ")}` } });
    return;
  }

  try {
    const db = getDb();
    const [updated] = await db
      .update(accountsTable)
      .set({ mpClientId, mpClientSecret, mpAccessToken, updatedAt: new Date() })
      .where(and(eq(accountsTable.id, req.params.id as string), eq(accountsTable.userId, req.user!.id)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    res.json({
      hasMpCredentials: true,
      mpClientIdMasked: maskField(updated.mpClientId),
      mpClientSecretMasked: maskField(updated.mpClientSecret),
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
      .set({ mpClientId: null, mpClientSecret: null, mpAccessToken: null, updatedAt: new Date() })
      .where(and(eq(accountsTable.id, req.params.id as string), eq(accountsTable.userId, req.user!.id)))
      .returning({ id: accountsTable.id });

    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    res.json({ hasMpCredentials: false, mpClientIdMasked: null, mpClientSecretMasked: null });
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
