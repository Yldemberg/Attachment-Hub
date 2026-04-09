import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { supabase } from "./supabase";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

export function configureApiClient() {
  setBaseUrl(API_BASE_URL);
  
  setAuthTokenGetter(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  });
}