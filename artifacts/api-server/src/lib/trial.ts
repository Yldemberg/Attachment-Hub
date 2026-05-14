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

    /** Trial expiry by `trial_ends_at` is disabled for now (no 402). */

    next();
  } catch (err) {
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  }
}
