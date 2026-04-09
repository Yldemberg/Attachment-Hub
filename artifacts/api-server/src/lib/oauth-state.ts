import crypto from "crypto";

interface StateEntry {
  userId: string;
  expiresAt: number;
}

const store = new Map<string, StateEntry>();
const TTL_MS = 10 * 60 * 1000;

export function createOAuthState(userId: string): string {
  const state = crypto.randomUUID();
  store.set(state, { userId, expiresAt: Date.now() + TTL_MS });
  return state;
}

export function consumeOAuthState(state: string): string | null {
  const entry = store.get(state);
  if (!entry) return null;
  store.delete(state);
  if (Date.now() > entry.expiresAt) return null;
  return entry.userId;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 60_000).unref();
