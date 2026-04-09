import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseKey) {
      console.warn(
        "[iHub] Supabase credentials not configured. " +
        "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.",
      );
      _supabase = createClient("https://placeholder.supabase.co", "placeholder-anon-key");
    } else {
      _supabase = createClient(supabaseUrl, supabaseKey);
    }
  }
  return _supabase;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getSupabase()[prop as keyof SupabaseClient];
  },
});

export const isSupabaseConfigured = () => !!supabaseUrl && !!supabaseKey;
