import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { supabase } from "./supabase";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

async function dynamicTokenGetter(): Promise<string | null> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error("[iHub] getSession error:", error.message);
      return null;
    }

    if (!session) {
      console.warn("[iHub] dynamicTokenGetter: no session in storage");
      return null;
    }

    const expiresAt = session.expires_at ?? 0;
    const isExpiredOrExpiringSoon = expiresAt * 1000 < Date.now() + 60_000;

    if (isExpiredOrExpiringSoon) {
      console.info("[iHub] dynamicTokenGetter: token expiring, refreshing...");
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.error("[iHub] refreshSession error:", refreshError.message);
        return null;
      }
      return refreshed.session?.access_token ?? null;
    }

    return session.access_token;
  } catch (err) {
    console.error("[iHub] dynamicTokenGetter threw:", err);
    return null;
  }
}

export function configureApiClient() {
  setBaseUrl(API_BASE_URL);
  setAuthTokenGetter(dynamicTokenGetter);
  console.info("[iHub] configureApiClient: dynamic token getter registered, BASE_URL =", API_BASE_URL || "(relative)");
}

export function updateApiToken(_token: string | null) {
  // intentional no-op — dynamic getter handles all token lifecycle
}
