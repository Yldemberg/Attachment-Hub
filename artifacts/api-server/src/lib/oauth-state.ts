import crypto from "crypto";
import { getDb } from "./db";
import { oauthStatesTable } from "@workspace/db/schema";
import { eq, lt } from "drizzle-orm";

const TTL_MS = 10 * 60 * 1000;

export async function createOAuthState(userId: string): Promise<string> {
  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS);
  const db = getDb();
  await db.insert(oauthStatesTable).values({ state, userId, expiresAt });
  return state;
}

export async function consumeOAuthState(state: string): Promise<string | null> {
  const db = getDb();
  const [entry] = await db
    .delete(oauthStatesTable)
    .where(eq(oauthStatesTable.state, state))
    .returning();

  if (!entry) return null;
  if (new Date() > entry.expiresAt) return null;
  return entry.userId;
}

setInterval(async () => {
  try {
    const db = getDb();
    await db.delete(oauthStatesTable).where(lt(oauthStatesTable.expiresAt, new Date()));
  } catch (err) {
    console.error({ err }, "Failed to clean up expired OAuth states");
  }
}, 60_000).unref();
