import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-Role-Client (umgeht RLS vollständig). NUR serverseitig verwenden —
 * ausschließlich aus `modules/_shared/write.ts`, `worker/*` und den
 * `lib/hotel-context.ts`-Lookups heraus. Niemals in einer Client-Komponente
 * oder ungeprüft aus einem Route-Handler importieren.
 *
 * Autorisierung passiert VOR jedem Einsatz explizit über
 * `assertModuleEnabled()` + `requirePermission()` (Vorgabe #2) — RLS ist hier
 * bewusst die zweite, nicht die einzige Verteidigungslinie.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
