import { Router } from "express";
import bcrypt from "bcryptjs";
import { requireAuth } from "../lib/auth";
import { getDb } from "../lib/db";
import { profilesTable } from "@workspace/db/schema";
import { signUserToken } from "../lib/token";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
const router = Router();

function parseCredentials(body: unknown): { email: string; password: string } | null {
  if (!body || typeof body !== "object") return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || !email.includes("@")) return null;
  if (typeof password !== "string" || password.length < 6) return null;
  return { email, password };
}

router.post("/auth/register", async (req, res) => {
  const creds = parseCredentials(req.body);
  if (!creds) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Email ou senha inválidos" } });
    return;
  }

  const { email, password } = creds;

  try {
    const db = getDb();
    const passwordHash = await bcrypt.hash(password, 12);
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const existing = await db.select().from(profilesTable).where(eq(profilesTable.email, email)).limit(1);

    let profile;
    if (existing.length > 0) {
      [profile] = await db
        .update(profilesTable)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(profilesTable.email, email))
        .returning();
    } else {
      [profile] = await db
        .insert(profilesTable)
        .values({ id: randomUUID(), email, passwordHash, plan: "trial", trialEndsAt })
        .returning();
    }

    const token = await signUserToken(profile.id, profile.email ?? email);
    res.json({ token, userId: profile.id, email: profile.email ?? email });
  } catch (err) {
    req.log.error({ err }, "Register failed");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  }
});

router.post("/auth/login", async (req, res) => {
  const creds = parseCredentials(req.body);
  if (!creds) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Email ou senha inválidos" } });
    return;
  }

  const { email, password } = creds;

  try {
    const db = getDb();
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.email, email)).limit(1);

    if (!profile || !profile.passwordHash) {
      res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email ou senha incorretos" } });
      return;
    }

    const valid = await bcrypt.compare(password, profile.passwordHash);
    if (!valid) {
      res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email ou senha incorretos" } });
      return;
    }

    const token = await signUserToken(profile.id, profile.email ?? email);
    res.json({ token, userId: profile.id, email: profile.email ?? email });
  } catch (err) {
    req.log.error({ err }, "Login failed");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [profile] = await db
      .insert(profilesTable)
      .values({
        id: req.user!.id,
        email: req.user!.email ?? null,
        plan: "trial",
        trialEndsAt,
      })
      .onConflictDoUpdate({
        target: profilesTable.id,
        set: { updatedAt: new Date() },
      })
      .returning();

    res.json({
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      plan: profile.plan,
      trialEndsAt: profile.trialEndsAt,
      stripeCustomerId: profile.stripeCustomerId,
      stripeSubscriptionId: profile.stripeSubscriptionId,
      createdAt: profile.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch profile");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  }
});

export default router;
