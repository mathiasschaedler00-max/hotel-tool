import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, ModuleDisabledError } from "./errors";

export interface ApiSuccessBody<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Erfolgs-Envelope für Route-Handler: `{ data }`. */
export function ok<T>(data: T, init?: { status?: number }): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json({ data }, { status: init?.status ?? 200 });
}

/**
 * Fehler-Envelope für Route-Handler: `{ error: { code, message, details? } }`.
 * Zentrale Übersetzung Fehler → HTTP-Status:
 * `ModuleDisabledError → 404` (bewusst wie NotFoundError, siehe docs/adr/0004
 * — 404-Hiding, nie den `moduleKey` an den Client durchreichen),
 * `ForbiddenError → 403`, `ValidationError → 400`, `ConflictError → 409`,
 * `NotFoundError → 404`, `UnauthorizedError → 401`.
 *
 * Nimmt zusätzlich `ZodError` entgegen (nicht Teil der `AppError`-Hierarchie),
 * damit `schema.parse(...)`-Aufrufe in Route-Handlern nicht separat
 * try/catch-behandelt werden müssen — siehe
 * `src/app/api/v1/pms/reservations/route.ts` für das Muster.
 */
export function err(e: unknown): NextResponse<ApiErrorBody> {
  if (e instanceof ModuleDisabledError) {
    // Log nur server-seitig — die Response bleibt absichtlich generisch.
    console.info("[entitlements] module disabled, hiding as 404", e.details);
    return NextResponse.json<ApiErrorBody>({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  }

  if (e instanceof AppError) {
    return NextResponse.json<ApiErrorBody>(
      { error: { code: e.code, message: e.message, details: e.details } },
      { status: e.status }
    );
  }

  if (e instanceof ZodError) {
    return NextResponse.json<ApiErrorBody>(
      { error: { code: "validation_error", message: "Validation failed", details: e.flatten() } },
      { status: 400 }
    );
  }

  console.error("[api] unhandled error", e);
  return NextResponse.json<ApiErrorBody>(
    { error: { code: "internal_error", message: "Internal Server Error" } },
    { status: 500 }
  );
}
