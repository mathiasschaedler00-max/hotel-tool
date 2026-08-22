"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatEuro, formatDateTime } from "@lib/format";
import type { Room } from "@modules/pms/rooms/service";
import type { RoomType } from "@modules/pms/room-types/service";
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

type Mode = "view" | "edit" | "move" | "cancel";

const STATUS_CHIP_CLASSES: Record<string, string> = {
  confirmed: "border border-blue bg-blue-bg text-blue",
  checked_in: "bg-blue text-white",
  checked_out: "border border-line bg-surface-2 text-text-3",
  cancelled: "border border-red bg-red-bg text-red",
  no_show: "border border-red bg-red-bg text-red",
};

/** Status, in denen eine Reservierung noch bearbeitet/verschoben/storniert werden kann. */
const EDITABLE_STATUSES = new Set(["confirmed", "checked_in"]);

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Detail-Panel rechts (Design-Referenz §5, Screen 2) — Auftrag Schritt 3:
 * Bearbeiten (Personenzahl/Notiz/Preis), Verschieben (Zimmer/Zeitraum) und
 * Stornieren (mit Pflicht-Grund + Bestätigung, Design-Regel §6.5) ergänzt.
 * Nur sichtbar, solange die Reservierung noch aktiv ist (confirmed/
 * checked_in) — bei stornierten/abgereisten Buchungen gibt es nichts mehr
 * zu tun. Check-in-Start bleibt Schritt 4.
 */
export function ReservationDetailPanel({
  reservation,
  room,
  roomTypes,
  onClose,
}: {
  reservation: ReservationWithDetails;
  room: Room | null;
  roomTypes: RoomType[];
  onClose: () => void;
}) {
  const router = useRouter();
  const nights = daysBetween(reservation.check_in_date, reservation.check_out_date);
  const rateNightCents = nights > 0 ? Math.round(reservation.rate_cents / nights) : 0;
  const guestName = reservation.guest
    ? `${reservation.guest.first_name} ${reservation.guest.last_name}`
    : "Ohne Gast";
  const statusLabel = RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status;
  const chipClass = STATUS_CHIP_CLASSES[reservation.status] ?? "border border-line bg-surface-2 text-text-2";
  const roomType = roomTypes.find((rt) => rt.id === reservation.room_type_id) ?? null;
  const canEdit = EDITABLE_STATUSES.has(reservation.status);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [mode, setMode] = useState<Mode>("view");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bearbeiten
  const [editAdults, setEditAdults] = useState(reservation.adults);
  const [editChildren, setEditChildren] = useState(reservation.children);
  const [editNotes, setEditNotes] = useState(reservation.notes ?? "");
  const [editPriceEuro, setEditPriceEuro] = useState((reservation.rate_cents / 100).toFixed(2));

  // Verschieben
  const [moveCheckIn, setMoveCheckIn] = useState(reservation.check_in_date);
  const [moveCheckOut, setMoveCheckOut] = useState(reservation.check_out_date);
  const [moveRoomId, setMoveRoomId] = useState(reservation.room_id ?? "");
  const [moveAvailableRooms, setMoveAvailableRooms] = useState<Room[]>([]);

  // Stornieren
  const [cancelReason, setCancelReason] = useState("");

  // Als Funktion statt nur in einem einmaligen Mount-Effekt: `reservation.id`
  // ändert sich nach Bearbeiten/Verschieben/Stornieren NICHT (dieselbe
  // Reservierung), ein reiner `[reservation.id]`-Effekt würde die neuen
  // Verlaufs-Einträge deshalb nie nachladen (Review-Fund, 23.08.2026) — nach
  // jeder erfolgreichen Aktion wird `loadDetail()` deshalb explizit erneut
  // aufgerufen (siehe handle*Submit unten).
  function loadDetail() {
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
  }

  useEffect(loadDetail, [reservation.id]);

  // Freie Zimmer der EIGENEN Kategorie im (ggf. geänderten) Zeitraum fürs Verschieben nachladen.
  useEffect(() => {
    if (mode !== "move" || !moveCheckIn || !moveCheckOut || !(moveCheckOut > moveCheckIn)) return;
    let cancelled = false;
    fetch(`/api/v1/pms/reservations/available-rooms?from=${moveCheckIn}&to=${moveCheckOut}&roomTypeId=${reservation.room_type_id}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => {
        if (!cancelled) setMoveAvailableRooms(body.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setMoveAvailableRooms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, moveCheckIn, moveCheckOut, reservation.room_type_id]);

  function resetToView() {
    setMode("view");
    setError(null);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const rateCents = Math.round(parseFloat(editPriceEuro.replace(",", ".")) * 100);
    try {
      const res = await fetch(`/api/v1/pms/reservations/${reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adults: editAdults,
          children: editChildren,
          notes: editNotes || null,
          rateCents: Number.isFinite(rateCents) ? rateCents : reservation.rate_cents,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
      loadDetail();
      resetToView();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/pms/reservations/${reservation.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: moveRoomId || null,
          checkInDate: moveCheckIn,
          checkOutDate: moveCheckOut,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
      loadDetail();
      resetToView();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Verschieben");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelReason.trim()) {
      setError("Bitte einen Grund angeben.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/pms/reservations/${reservation.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
      loadDetail();
      resetToView();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Stornieren");
    } finally {
      setSaving(false);
    }
  }

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
        <dt className="text-text-2">Kategorie</dt>
        <dd className="text-right text-text">{roomType?.name ?? "—"}</dd>

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

        <dt className="text-text-2">Personen</dt>
        <dd className="text-right font-mono text-text">
          {reservation.adults}
          {reservation.children > 0 ? `+${reservation.children}` : ""}
        </dd>

        <dt className="text-text-2">Rate / Nacht</dt>
        <dd className="text-right font-mono text-text">{formatEuro(rateNightCents)}</dd>

        <dt className="font-medium text-text-2">Gesamt</dt>
        <dd className="text-right font-mono font-medium text-text">{formatEuro(reservation.rate_cents)}</dd>
      </dl>

      {reservation.notes && mode === "view" && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-text-2">{reservation.notes}</p>
      )}

      {mode === "view" && canEdit && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className="min-h-9 flex-1 rounded-md border border-line px-3 text-xs font-medium text-text-2 hover:bg-surface-2"
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={() => setMode("move")}
            className="min-h-9 flex-1 rounded-md border border-line px-3 text-xs font-medium text-text-2 hover:bg-surface-2"
          >
            Verschieben
          </button>
          <button
            type="button"
            onClick={() => setMode("cancel")}
            className="min-h-9 flex-1 rounded-md border border-red px-3 text-xs font-medium text-red hover:bg-red-bg"
          >
            Stornieren
          </button>
        </div>
      )}

      {mode === "edit" && (
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3">
          <p className="text-xs font-semibold text-text-2 uppercase">Bearbeiten</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-2">
              Erwachsene
              <input
                type="number"
                min={1}
                value={editAdults}
                onChange={(e) => setEditAdults(Number(e.target.value))}
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 font-mono text-text focus:border-focus focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-2">
              Kinder
              <input
                type="number"
                min={0}
                value={editChildren}
                onChange={(e) => setEditChildren(Number(e.target.value))}
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 font-mono text-text focus:border-focus focus:outline-none"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-text-2">
            Gesamtpreis (€)
            <input
              type="number"
              step="0.01"
              min="0"
              value={editPriceEuro}
              onChange={(e) => setEditPriceEuro(e.target.value)}
              className="min-h-9 rounded-md border border-line bg-surface-3 px-2 font-mono text-text focus:border-focus focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-2">
            Notiz
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={2}
              className="rounded-md border border-line bg-surface-3 px-2 py-1 text-text focus:border-focus focus:outline-none"
            />
          </label>
          {error && <p className="text-xs text-red">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="min-h-9 flex-1 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hi disabled:opacity-60"
            >
              {saving ? "Speichert…" : "Speichern"}
            </button>
            <button
              type="button"
              onClick={resetToView}
              className="min-h-9 rounded-md border border-line px-3 text-xs text-text-2 hover:bg-surface-3"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {mode === "move" && (
        <form onSubmit={handleMoveSubmit} className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3">
          <p className="text-xs font-semibold text-text-2 uppercase">Verschieben</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-2">
              Anreise
              <input
                type="date"
                value={moveCheckIn}
                onChange={(e) => setMoveCheckIn(e.target.value)}
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-2">
              Abreise
              <input
                type="date"
                value={moveCheckOut}
                onChange={(e) => setMoveCheckOut(e.target.value)}
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-text-2">
            Zimmer ({roomType?.name ?? "gleiche Kategorie"})
            <select
              value={moveRoomId}
              onChange={(e) => setMoveRoomId(e.target.value)}
              className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
            >
              <option value="">Nicht zugewiesen</option>
              {room && !moveAvailableRooms.some((r) => r.id === room.id) && (
                <option value={room.id}>
                  {room.room_number} (aktuell)
                </option>
              )}
              {moveAvailableRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_number}
                  {r.floor ? ` · Etage ${r.floor}` : ""}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-xs text-red">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="min-h-9 flex-1 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hi disabled:opacity-60"
            >
              {saving ? "Verschiebt…" : "Verschieben"}
            </button>
            <button
              type="button"
              onClick={resetToView}
              className="min-h-9 rounded-md border border-line px-3 text-xs text-text-2 hover:bg-surface-3"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {mode === "cancel" && (
        <form onSubmit={handleCancelSubmit} className="flex flex-col gap-2 rounded-md border border-red bg-red-bg p-3">
          <p className="text-xs font-semibold text-red uppercase">Stornieren</p>
          <label className="flex flex-col gap-1 text-xs text-red">
            Grund (Pflicht)
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
              required
              className="rounded-md border border-red bg-surface px-2 py-1 text-text focus:outline-none"
            />
          </label>
          {error && <p className="text-xs text-red">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="min-h-9 flex-1 rounded-md bg-red px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Storniert…" : "Ja, stornieren"}
            </button>
            <button
              type="button"
              onClick={resetToView}
              className="min-h-9 rounded-md border border-line px-3 text-xs text-text-2 hover:bg-surface-2"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

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
    </aside>
  );
}
