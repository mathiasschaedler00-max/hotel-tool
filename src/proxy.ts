import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16: `middleware.ts` heißt jetzt `proxy.ts`.
 *
 * WICHTIG — Abweichung vom Architekturplan: der Plan zeigt die Datei zweimal
 * unter `src/app/proxy.ts`. Laut Next.js-Doku
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:
 * "Create a proxy.ts … in the project root, or inside src if applicable, so
 * that it is located at the SAME LEVEL as pages or app") muss die Datei unter
 * `src/proxy.ts` liegen, NICHT unter `src/app/proxy.ts` — sonst erkennt
 * Next.js sie gar nicht als Proxy. Das Referenzprojekt
 * (`/Users/mathias/Ticketsytem v3/src/proxy.ts`) bestätigt denselben Pfad.
 * Hier deshalb bewusst korrekt platziert statt den (nicht funktionierenden)
 * Plan-Pfad wörtlich zu übernehmen.
 *
 * Auth-Guard: `/api/v1/*` verlangt eine Session (zweite Verteidigungslinie
 * neben `getModuleContext()`s `UnauthorizedError` — spart im Regelfall den
 * DB-Roundtrip, wenn gar keine Session vorliegt). Alles andere abseits
 * `/login`/`/register`/`/` verlangt ebenfalls eine Session, sobald es
 * (in einer späteren Phase) ein `(dashboard)`-Routen-Segment gibt.
 */
export async function proxy(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Kein echtes Supabase-Projekt konfiguriert (Phase 0) — no-op statt zu crashen.
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isApiV1 = pathname.startsWith("/api/v1");
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/register");
  // Annahme: künftige MFA-Enrollment-Route, existiert in Phase 0 noch nicht als UI.
  const isMfaEnrollRoute = pathname.startsWith("/mfa");
  const isPublicRoute = isAuthRoute || pathname === "/";

  if (!user && (isApiV1 || (!isPublicRoute && !isMfaEnrollRoute))) {
    if (isApiV1) {
      return NextResponse.json({ error: { code: "unauthorized", message: "Not authenticated" } }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // AAL2/2FA-Erzwingung für Mitarbeiter-Logins (siehe ARCHITECTURE.md
  // Sicherheitsbasis + docs/adr/0007-security-2fa-backups.md). NICHT für
  // Gäste-Logins gedacht (siehe Architekturplan) — hier noch nicht zwischen
  // beiden unterschieden, da es in Phase 0 noch keine Gäste-App gibt.
  // TODO: gegen aktuelle Supabase-MFA-Doku verifizieren (Methode/Response-Form
  // können sich zwischen @supabase/auth-js-Versionen ändern).
  if (user && !isPublicRoute && !isMfaEnrollRoute) {
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aalError && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
      if (isApiV1) {
        return NextResponse.json(
          { error: { code: "mfa_required", message: "Zweiter Faktor (AAL2) erforderlich" } },
          { status: 401 }
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = "/mfa";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
