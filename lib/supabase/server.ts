import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * SSR-Server-Client (anon key, RLS aktiv, Session aus Cookies).
 * Für Server Components, Route Handler und `getModuleContext()` — überall,
 * wo wir "als der eingeloggte User" lesen/aufrufen wollen (z. B. die
 * `hotel_role()`-RPC, die intern `auth.uid()` auswertet).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — Cookies können hier nicht gesetzt werden,
            // proxy.ts kümmert sich um den Session-Refresh.
          }
        },
      },
    }
  );
}
