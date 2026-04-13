import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { supabase } from "./supabase";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

/**
 * Configure the API client once at app startup.
 * The auth token getter is dynamic: it always reads the current Supabase
 * session and auto-refreshes if the access token is expired or about to
 * expire (within 60 s). This prevents 401s caused by stale cached tokens.
 */
export function configureApiClient() {
  setBaseUrl(API_BASE_URL);
  setAuthTokenGetter(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const expiresAt = session.expires_at ?? 0;
    const isExpiredOrExpiringSoon = expiresAt * 1000 < Date.now() + 60_000;

    if (isExpiredOrExpiringSoon) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      return refreshed.session?.access_token ?? null;
    }

    return session.access_token;
  });
}

/**
 * Called on sign-out to immediately clear the auth getter so no further
 * authenticated requests are issued before the component tree unmounts.
 */
export function updateApiToken(token: string | null) {
  if (token === null) {
    setAuthTokenGetter(null);
  }
  // When token is non-null we rely on the dynamic getter set in
  // configureApiClient() — no need to update anything.
}
