import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { getDb } from "../lib/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

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
