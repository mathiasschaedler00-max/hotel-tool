import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-Client (anon key, RLS aktiv). Nur für lesende Realtime-/Dashboard-
 * Queries verwenden — RLS ist hier die EINZIGE Schranke (siehe ARCHITECTURE.md).
 * Kritische Schreibzugriffe laufen NIE über diesen Client (Vorgabe #2), immer
 * über `src/app/api/v1/...` → `modules/*`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
