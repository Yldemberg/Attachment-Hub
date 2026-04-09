import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { getDb } from "../lib/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, req.user!.id));

    if (!profile) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Profile not found" },
      });
      return;
    }

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
