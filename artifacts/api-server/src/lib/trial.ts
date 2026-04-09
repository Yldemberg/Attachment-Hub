import { Request, Response, NextFunction } from "express";
import { getDb } from "./db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export async function requireActivePlan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const db = getDb();
    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, req.user!.id));

    if (!profile) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Profile not found" },
      });
      return;
    }

    if (profile.plan === "trial" && profile.trialEndsAt) {
      if (new Date() > profile.trialEndsAt) {
        res.status(402).json({
          error: {
            code: "TRIAL_EXPIRED",
            message: "Your trial has expired. Please upgrade to continue.",
          },
        });
        return;
      }
    }

    next();
  } catch (err) {
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  }
}
