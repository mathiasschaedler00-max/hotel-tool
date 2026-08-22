/**
 * Zentrale Fehler-Hierarchie für die Modul-Schicht.
 *
 * Jede Modul-Service-Funktion wirft diese Fehler statt HTTP-Status-Codes zu
 * kennen. Die API-Schicht (`modules/_shared/response.ts`, `err()`) übersetzt
 * sie in das JSON-Envelope + den passenden Status-Code. Damit bleibt
 * Geschäftslogik von HTTP entkoppelt (Vorgabe #1 aus dem Architekturplan).
 */

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, opts: { code: string; status: number; details?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

/** Ressource existiert nicht (oder ist soft-deleted). */
export class NotFoundError extends AppError {
  constructor(resource: string, details?: unknown) {
    super(`${resource} not found`, { code: "not_found", status: 404, details });
  }
}

/**
 * Nicht angemeldet / keine gültige Session.
 * Nicht Teil der im Plan explizit gelisteten Fehlerklassen (NotFoundError,
 * ForbiddenError, ModuleDisabledError, ValidationError, ConflictError) —
 * zusätzliche Annahme: `proxy.ts` fängt die meisten anonymen Zugriffe schon
 * ab, `getModuleContext()` braucht aber trotzdem eine explizite Fehlerklasse
 * für den Fall einer abgelaufenen/ungültigen Session zur Laufzeit der API-Route.
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Not authenticated") {
    super(message, { code: "unauthorized", status: 401 });
  }
}

/** Angemeldet, aber die RBAC-Prüfung (`requirePermission`) hat die Aktion abgelehnt. */
export class ForbiddenError extends AppError {
  constructor(permission: string) {
    super(`Missing permission: ${permission}`, {
      code: "forbidden",
      status: 403,
      details: { permission },
    });
  }
}

/**
 * Modul ist für dieses Hotel nicht aktiviert.
 *
 * WICHTIG (siehe docs/adr/0004-entitlements-404-hiding.md): wird bewusst wie
 * "nicht gefunden" behandelt (HTTP 404), nicht wie "verboten" (403) — sonst
 * würde ein 403 verraten, dass der Endpunkt grundsätzlich existiert, obwohl
 * das Modul laut Teil D für dieses Hotel komplett unsichtbar sein soll.
 * Die `moduleKey` in `details` ist nur für Server-seitiges Logging gedacht,
 * niemals für die Client-Antwort (siehe `response.ts#err`).
 */
export class ModuleDisabledError extends AppError {
  constructor(moduleKey: string) {
    super(`Module disabled: ${moduleKey}`, {
      code: "not_found",
      status: 404,
      details: { moduleKey },
    });
  }
}

/** Zod-Validierungsfehler oder sonstige Eingabe-Validierung. */
export class ValidationError extends AppError {
  constructor(details: unknown, message = "Validation failed") {
    super(message, { code: "validation_error", status: 400, details });
  }
}

/** Zustandskonflikt (z. B. Zimmer schon belegt, Reservierung schon eingecheckt). */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "conflict", status: 409, details });
  }
}
