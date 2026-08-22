"use client";

import { useEffect, useState } from "react";
import { formatDate, formatEuro, formatDateTime } from "@lib/format";
import type { Room } from "@modules/pms/rooms/service";
import type { ReservationWithDetails } from "@modules/pms/reservations/service";
import { RESERVATION_STATUS_LABELS } from "./reservation-status";

interface HistoryEntry {
  action: string;
  description: string;
  createdAt: string;
}

interface DetailData {
  history: HistoryEntry[];
  openBalanceCents: number;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: DetailData };

const STATUS_CHIP_CLASSES: Record<string, string> = {
  confirmed: "border border-blue bg-blue-bg text-blue",
  checked_in: "bg-blue text-white",
  checked_out: "border border-line bg-surface-2 text-text-3",
  cancelled: "border border-red bg-red-bg text-red",
  no_show: "border border-red bg-red-bg text-red",
};

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Detail-Panel rechts (Design-Referenz §5, Screen 2) — V1: NUR Anzeige, keine
 * Aktionsbuttons (Check-in/Verschieben/Stornieren kommen mit Schritt 3/4).
 * Die Fläche dafür ist am Ende des Panels bereits reserviert.
 */
export function ReservationDetailPanel({
  reservation,
  room,
  onClose,
}: {
  reservation: ReservationWithDetails;
  room: Room | null;
  onClose: () => void;
}) {
  const nights = daysBetween(reservation.check_in_date, reservation.check_out_date);
  const rateNightCents = nights > 0 ? Math.round(reservation.rate_cents / nights) : 0;
  const guestName = reservation.guest
    ? `${reservation.guest.first_name} ${reservation.guest.last_name}`
    : "Ohne Gast";
  const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status;
  const chipClass = STATUS_CHIP_CLASSES[reservation.status] ?? "border border-line bg-surface-2 text-text-2";

  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/pms/reservations/${reservation.id}/detail`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? `Status ${res.status}`);
        return body.data as DetailData;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : "Fehler beim Laden" });
      });
    return () => {
      cancelled = true;
    };
  }, [reservation.id]);

  return (
    <aside className="flex w-full min-h-0 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-token)] sm:w-72">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-text">{guestName}</h2>
          <p className="font-mono text-xs text-text-3">{reservation.reservation_no}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Detail-Panel schließen"
          className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-surface-2"
        >
          ×
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className={`inline-block w-fit rounded-full px-2.5 py-1 text-xs font-medium ${chipClass}`}>
          {statusLabel}
        </span>
        {/* Design-Regel §6.4: Beträge nie weglassen, auch 0,00 € zeigen — siehe lib/format.ts. */}
        <span className="text-right text-xs text-text-2">
          Offener Saldo
          <br />
          <span className="font-mono text-sm font-medium text-text">
            {state.status === "ready" ? formatEuro(state.data.openBalanceCents) : "…"}
          </span>
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <dt className="text-text-2">Zimmer</dt>
        <dd className="text-right font-mono text-text">
          {room ? `${room.room_number}${room.floor ? ` · Etage ${room.floor}` : ""}` : "—"}
        </dd>

        <dt className="text-text-2">Nächte</dt>
        <dd className="text-right font-mono text-text">{nights}</dd>

        <dt className="text-text-2">Anreise</dt>
        <dd className="text-right font-mono text-text">{formatDate(reservation.check_in_date)}</dd>

        <dt className="text-text-2">Abreise</dt>
        <dd className="text-right font-mono text-text">{formatDate(reservation.check_out_date)}</dd>

        <dt className="text-text-2">Rate / Nacht</dt>
        <dd className="text-right font-mono text-text">{formatEuro(rateNightCents)}</dd>

        <dt className="font-medium text-text-2">Gesamt</dt>
        <dd className="text-right font-mono font-medium text-text">{formatEuro(reservation.rate_cents)}</dd>
      </dl>

      <div>
        <p className="mb-2 text-xs font-medium text-text-2">Verlauf</p>
        {state.status === "loading" && <p className="text-xs text-text-3">Lädt …</p>}
        {state.status === "error" && <p className="text-xs text-red">{state.message}</p>}
        {state.status === "ready" && state.data.history.length === 0 && (
          <p className="text-xs text-text-3">Kein Verlauf vorhanden.</p>
        )}
        {state.status === "ready" && state.data.history.length > 0 && (
          <ul className="flex flex-col gap-2 text-xs">
            {state.data.history.map((entry, i) => (
              <li key={i} className="flex justify-between gap-2 text-text-2">
                <span>{entry.description}</span>
                <span className="shrink-0 font-mono text-text-3">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        V1-Grenze (Auftrag "Schritt 2 — Buchungskalender / Tape Chart"): keine
        Aktionsbuttons in dieser Ansicht. Check-in starten / Verschieben /
        Stornieren kommen mit Schritt 3/4 — die Fläche dafür ist hier bewusst
        schon vorgesehen, damit das Panel dann nicht neu layoutet werden muss.
      */}
      <div className="mt-auto border-t border-line pt-3" />
    </aside>
  );
}
