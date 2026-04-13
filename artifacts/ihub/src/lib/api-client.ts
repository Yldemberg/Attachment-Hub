import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { supabase } from "./supabase";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

/**
 * Dynamic token getter that always reads the current Supabase session.
 * - Returns null when the user is signed out (getSession returns null).
 * - Auto-refreshes the access token when it is expired or expiring soon.
 * - Set once at startup; never needs to be replaced.
 */
async function dynamicTokenGetter(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const expiresAt = session.expires_at ?? 0;
  const isExpiredOrExpiringSoon = expiresAt * 1000 < Date.now() + 60_000;

  if (isExpiredOrExpiringSoon) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  }

  return session.access_token;
}

/**
 * Call once at app startup (inside AuthProvider).
 * Registers the dynamic getter so every API request always sends the
 * current, valid Supabase access token.
 */
export function configureApiClient() {
  setBaseUrl(API_BASE_URL);
  setAuthTokenGetter(dynamicTokenGetter);
}

/**
 * Kept for API compatibility with auth-context.tsx.
 * The dynamic getter reads from supabase.auth.getSession() on every
 * request, so sign-in and sign-out are handled automatically without
 * needing to push tokens here.
 */
export function updateApiToken(_token: string | null) {
  // intentional no-op — dynamic getter handles all token lifecycle
}
