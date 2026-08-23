"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomType } from "@modules/pms/room-types/service";
import type { Room } from "@modules/pms/rooms/service";
import { GuestPicker, NO_GUEST_SELECTED, resolveGuestId, type GuestSelection } from "./guest-picker";

function nightsBetween(checkInDate: string, checkOutDate: string): number {
  return Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86_400_000);
}

interface RowState {
  key: string;
  guest: GuestSelection;
  roomTypeId: string;
  checkInDate: string;
  checkOutDate: string;
  roomId: string;
  adults: number;
  children: number;
  priceOverride: string | null;
}

function makeRow(key: string, roomTypes: RoomType[], checkInDate: string, checkOutDate: string): RowState {
  return {
    key,
    guest: NO_GUEST_SELECTED,
    roomTypeId: roomTypes[0]?.id ?? "",
    checkInDate,
    checkOutDate,
    roomId: "",
    adults: 1,
    children: 0,
    priceOverride: null,
  };
}

/** Eine Zimmerzeile einer Gruppenbuchung — eigene Verfügbarkeits-Nachlade-Logik pro Zeile, da jede ihre eigene Kategorie/ihren eigenen Zeitraum haben kann. */
function GroupReservationRow({
  row,
  index,
  roomTypes,
  onChange,
  onRemove,
  removable,
}: {
  row: RowState;
  index: number;
  roomTypes: RoomType[];
  onChange: (next: RowState) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const nights = nightsBetween(row.checkInDate, row.checkOutDate);
  const selectedRoomType = roomTypes.find((rt) => rt.id === row.roomTypeId) ?? null;
  const autoPriceEuro =
    selectedRoomType && nights > 0 ? ((selectedRoomType.base_rate_cents * nights) / 100).toFixed(2) : "";
  const priceEuro = row.priceOverride ?? autoPriceEuro;

  useEffect(() => {
    if (!row.roomTypeId || nights <= 0) return;
    let cancelled = false;
    fetch(`/api/v1/pms/reservations/available-rooms?from=${row.checkInDate}&to=${row.checkOutDate}&roomTypeId=${row.roomTypeId}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => {
        if (cancelled) return;
        const rooms: Room[] = body.data ?? [];
        setAvailableRooms(rooms);
        if (!rooms.some((r) => r.id === row.roomId)) onChange({ ...row, roomId: "" });
      })
      .catch(() => {
        if (!cancelled) setAvailableRooms([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei Kategorie/Zeitraum neu laden, nicht bei jeder Zeilenänderung
  }, [row.roomTypeId, row.checkInDate, row.checkOutDate]);
  const visibleAvailableRooms = row.roomTypeId && nights > 0 ? availableRooms : [];

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-text-2 uppercase">Zimmer {index + 1}</span>
        {removable && (
          <button type="button" onClick={onRemove} className="text-xs text-text-2 underline hover:text-red">
            Entfernen
          </button>
        )}
      </div>

      <GuestPicker value={row.guest} onChange={(guest) => onChange({ ...row, guest })} />

      <label className="flex flex-col gap-1 text-xs text-text-2">
        Kategorie
        <select
          value={row.roomTypeId}
          onChange={(e) => onChange({ ...row, roomTypeId: e.target.value })}
          required
          className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-sm text-text focus:border-focus focus:outline-none"
        >
          {roomTypes.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Anreise
          <input
            type="date"
            value={row.checkInDate}
            onChange={(e) => onChange({ ...row, checkInDate: e.target.value })}
            required
            className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-sm text-text focus:border-focus focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Abreise
          <input
            type="date"
            value={row.checkOutDate}
            onChange={(e) => onChange({ ...row, checkOutDate: e.target.value })}
            required
            className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-sm text-text focus:border-focus focus:outline-none"
          />
        </label>
      </div>
      {nights <= 0 && <p className="text-xs text-red">Abreise muss nach Anreise liegen.</p>}

      <label className="flex flex-col gap-1 text-xs text-text-2">
        Zimmer
        <select
          value={row.roomId}
          onChange={(e) => onChange({ ...row, roomId: e.target.value })}
          className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-sm text-text focus:border-focus focus:outline-none"
        >
          <option value="">Nicht zugewiesen (später zuteilen)</option>
          {visibleAvailableRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.room_number}
              {r.floor ? ` · Etage ${r.floor}` : ""}
            </option>
          ))}
        </select>
        {nights > 0 && visibleAvailableRooms.length === 0 && (
          <span className="text-[11px] text-text-3">Keine freien Zimmer dieser Kategorie im gewählten Zeitraum.</span>
        )}
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Erw.
          <input
            type="number"
            min={1}
            value={row.adults}
            onChange={(e) => onChange({ ...row, adults: Number(e.target.value) })}
            required
            className="min-h-9 rounded-md border border-line bg-surface-3 px-2 font-mono text-sm text-text focus:border-focus focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Kinder
          <input
            type="number"
            min={0}
            value={row.children}
            onChange={(e) => onChange({ ...row, children: Number(e.target.value) })}
            required
            className="min-h-9 rounded-md border border-line bg-surface-3 px-2 font-mono text-sm text-text focus:border-focus focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Preis (€)
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceEuro}
            onChange={(e) => onChange({ ...row, priceOverride: e.target.value })}
            required
            className="min-h-9 rounded-md border border-line bg-surface-3 px-2 font-mono text-sm text-text focus:border-focus focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}

/**
 * "Gruppe anlegen" (Auftrag Schritt 3) — legt mehrere Reservierungen unter
 * einem gemeinsamen `group_bookings`-Datensatz in einem Zug an
 * (`createGroupBooking()`, eine Transaktion: kollidiert ein Zimmer, wird die
 * ganze Gruppe zurückgerollt statt teilweise angelegt). Jede Zeile hat ihre
 * eigene Kategorie/ihren eigenen Zeitraum/Zimmer/Gast — der gemeinsame
 * Zeitraum oben ist nur die Vorbelegung für neue Zeilen, keine Einschränkung.
 */
export function GroupBookingPanel({
  roomTypes,
  defaultCheckIn,
  defaultCheckOut,
  onClose,
}: {
  roomTypes: RoomType[];
  defaultCheckIn: string;
  defaultCheckOut: string;
  onClose: () => void;
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [contactGuest, setContactGuest] = useState<GuestSelection>(NO_GUEST_SELECTED);
  const [groupCheckIn, setGroupCheckIn] = useState(defaultCheckIn);
  const [groupCheckOut, setGroupCheckOut] = useState(defaultCheckOut);
  const [rows, setRows] = useState<RowState[]>([makeRow("row-0", roomTypes, defaultCheckIn, defaultCheckOut)]);
  const [nextRowIndex, setNextRowIndex] = useState(1);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addRow() {
    setRows((prev) => [...prev, makeRow(`row-${nextRowIndex}`, roomTypes, groupCheckIn, groupCheckOut)]);
    setNextRowIndex((n) => n + 1);
  }

  function updateRow(key: string, next: RowState) {
    setRows((prev) => prev.map((r) => (r.key === key ? next : r)));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Gruppenname ist erforderlich.");
      return;
    }
    for (const row of rows) {
      if (row.guest.mode === "none") {
        setError(`Zimmer ${rows.indexOf(row) + 1}: bitte einen Gast auswählen oder anlegen.`);
        return;
      }
      if (nightsBetween(row.checkInDate, row.checkOutDate) <= 0) {
        setError(`Zimmer ${rows.indexOf(row) + 1}: Abreise muss nach Anreise liegen.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const contactGuestId = await resolveGuestId(contactGuest);

      const reservations = [];
      for (const row of rows) {
        const guestId = await resolveGuestId(row.guest);
        if (!guestId) throw new Error("Gast konnte nicht aufgelöst werden.");
        const rateCents = Math.round(parseFloat((row.priceOverride ?? "").replace(",", ".")) * 100);
        reservations.push({
          guestId,
          roomTypeId: row.roomTypeId,
          roomId: row.roomId || undefined,
          checkInDate: row.checkInDate,
          checkOutDate: row.checkOutDate,
          adults: row.adults,
          children: row.children,
          rateCents: Number.isFinite(rateCents) ? rateCents : undefined,
        });
      }

      const res = await fetch("/api/v1/pms/group-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contactGuestId: contactGuestId ?? undefined,
          checkInDate: groupCheckIn || undefined,
          checkOutDate: groupCheckOut || undefined,
          reservations,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen der Gruppe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-token)] sm:w-96">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-text">Gruppe anlegen</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Panel schließen"
          className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-surface-2"
        >
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-text-2">
          Gruppenname
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Hochzeit Müller"
            required
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm text-text-2">
          Kontaktgast (optional)
          <GuestPicker value={contactGuest} onChange={setContactGuest} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-text-2">
            Zeitraum von
            <input
              type="date"
              value={groupCheckIn}
              onChange={(e) => setGroupCheckIn(e.target.value)}
              className="min-h-11 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-2">
            bis
            <input
              type="date"
              value={groupCheckOut}
              onChange={(e) => setGroupCheckOut(e.target.value)}
              className="min-h-11 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
            />
          </label>
        </div>
        <p className="text-[11px] text-text-3">Nur Vorbelegung für neue Zimmerzeilen — jede Zeile hat ihren eigenen Zeitraum.</p>

        <div className="flex flex-col gap-3 border-t border-line pt-3">
          {rows.map((row, i) => (
            <GroupReservationRow
              key={row.key}
              row={row}
              index={i}
              roomTypes={roomTypes}
              onChange={(next) => updateRow(row.key, next)}
              onRemove={() => removeRow(row.key)}
              removable={rows.length > 1}
            />
          ))}
          <button
            type="button"
            onClick={addRow}
            className="min-h-9 rounded-md border border-dashed border-line px-3 text-sm text-text-2 hover:bg-surface-2"
          >
            + Zimmer hinzufügen
          </button>
        </div>

        {error && <p className="text-xs text-red">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-md bg-accent px-3 font-semibold text-on-accent hover:bg-accent-hi disabled:opacity-60"
        >
          {saving ? "Legt an…" : `Gruppe mit ${rows.length} Zimmer${rows.length === 1 ? "" : "n"} anlegen`}
        </button>
      </form>
    </aside>
  );
}
