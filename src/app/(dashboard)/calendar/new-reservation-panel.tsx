"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomType } from "@modules/pms/room-types/service";
import type { Room } from "@modules/pms/rooms/service";

interface GuestOption {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
}

function nightsBetween(checkInDate: string, checkOutDate: string): number {
  return Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86_400_000);
}

/**
 * "Neue Buchung" (Auftrag Schritt 3) — Seiten-Panel, gleiche Sprache wie
 * RoomEditPanel/CategoryEditPanel. Gastsuche mit Fallback "neuen Gast
 * anlegen" (ohne Gastsuche ist keine Buchung am Empfang möglich, siehe
 * Plan). Zimmer-Dropdown zeigt nur tatsächlich freie Zimmer der gewählten
 * Kategorie im gewählten Zeitraum (`listAvailableRooms()`) — "Nicht
 * zugewiesen" bleibt trotzdem wählbar (z. B. spätere Zuteilung).
 */
export function NewReservationPanel({
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

  const [guestQuery, setGuestQuery] = useState("");
  const [guestResults, setGuestResults] = useState<GuestOption[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<GuestOption | null>(null);
  const [isCreatingGuest, setIsCreatingGuest] = useState(false);
  const [newGuestFirstName, setNewGuestFirstName] = useState("");
  const [newGuestLastName, setNewGuestLastName] = useState("");
  const [newGuestEmail, setNewGuestEmail] = useState("");

  const [roomTypeId, setRoomTypeId] = useState(roomTypes[0]?.id ?? "");
  const [checkInDate, setCheckInDate] = useState(defaultCheckIn);
  const [checkOutDate, setCheckOutDate] = useState(defaultCheckOut);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string>("");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [notes, setNotes] = useState("");
  // `null` = folgt automatisch Kategorie × Nächte; ein String, sobald die
  // Nutzerin den Preis manuell angefasst hat. Als abgeleiteter Wert (siehe
  // `priceEuro` unten) statt per Effekt synchronisiert — vermeidet
  // synchrones setState im Effekt-Body (react-hooks/set-state-in-effect).
  const [priceOverride, setPriceOverride] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRoomType = roomTypes.find((rt) => rt.id === roomTypeId) ?? null;
  const nights = nightsBetween(checkInDate, checkOutDate);
  const autoPriceEuro =
    selectedRoomType && nights > 0 ? ((selectedRoomType.base_rate_cents * nights) / 100).toFixed(2) : "";
  const priceEuro = priceOverride ?? autoPriceEuro;

  // Gastsuche, leicht entprellt. Bei zu kurzer Anfrage einfach nicht fetchen
  // — alte Treffer werden über `visibleGuestResults` unten ausgeblendet,
  // statt sie synchron im Effekt zu leeren.
  useEffect(() => {
    if (guestQuery.trim().length < 2) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      fetch(`/api/v1/pms/guests/search?q=${encodeURIComponent(guestQuery)}`)
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then((body) => {
          if (!cancelled) setGuestResults(body.data ?? []);
        })
        .catch(() => {
          if (!cancelled) setGuestResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [guestQuery]);
  const visibleGuestResults = guestQuery.trim().length >= 2 ? guestResults : [];

  // Freie Zimmer der Kategorie im gewählten Zeitraum nachladen — gleiches
  // Muster: kein Fetch bei ungültigem Zeitraum, Anzeige blendet über
  // `visibleAvailableRooms` aus statt synchron zu leeren.
  useEffect(() => {
    if (!roomTypeId || nights <= 0) return;
    let cancelled = false;
    fetch(`/api/v1/pms/reservations/available-rooms?from=${checkInDate}&to=${checkOutDate}&roomTypeId=${roomTypeId}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => {
        if (cancelled) return;
        const rooms: Room[] = body.data ?? [];
        setAvailableRooms(rooms);
        setRoomId((prev) => (rooms.some((r) => r.id === prev) ? prev : ""));
      })
      .catch(() => {
        if (!cancelled) setAvailableRooms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [roomTypeId, checkInDate, checkOutDate, nights]);
  const visibleAvailableRooms = roomTypeId && nights > 0 ? availableRooms : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (nights <= 0) {
      setError("Abreisedatum muss nach dem Anreisedatum liegen.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let guestId = selectedGuest?.id ?? null;
      if (!guestId && isCreatingGuest) {
        if (!newGuestFirstName.trim() || !newGuestLastName.trim()) {
          setError("Vor- und Nachname des neuen Gasts sind erforderlich.");
          setSaving(false);
          return;
        }
        const guestRes = await fetch("/api/v1/pms/guests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: newGuestFirstName,
            lastName: newGuestLastName,
            email: newGuestEmail || undefined,
          }),
        });
        if (!guestRes.ok) {
          throw new Error((await guestRes.json().catch(() => null))?.error?.message ?? "Fehler beim Gast anlegen");
        }
        guestId = (await guestRes.json()).data.id;
      }
      if (!guestId) {
        setError("Bitte einen Gast auswählen oder einen neuen anlegen.");
        setSaving(false);
        return;
      }

      const rateCents = Math.round(parseFloat(priceEuro.replace(",", ".")) * 100);
      const res = await fetch("/api/v1/pms/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestId,
          roomTypeId,
          roomId: roomId || undefined,
          checkInDate,
          checkOutDate,
          adults,
          children,
          source: "direct",
          notes: notes || undefined,
          rateCents: Number.isFinite(rateCents) ? rateCents : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-token)] sm:w-80">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-text">Neue Buchung</h2>
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
        <div className="flex flex-col gap-1 text-sm text-text-2">
          Gast
          {selectedGuest ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-text">
              <span>
                {selectedGuest.first_name} {selectedGuest.last_name}
              </span>
              <button type="button" onClick={() => setSelectedGuest(null)} className="text-xs text-text-2 underline hover:text-text">
                Ändern
              </button>
            </div>
          ) : isCreatingGuest ? (
            <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-2">
              <input
                type="text"
                placeholder="Vorname"
                value={newGuestFirstName}
                onChange={(e) => setNewGuestFirstName(e.target.value)}
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
              />
              <input
                type="text"
                placeholder="Nachname"
                value={newGuestLastName}
                onChange={(e) => setNewGuestLastName(e.target.value)}
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
              />
              <input
                type="email"
                placeholder="E-Mail (optional)"
                value={newGuestEmail}
                onChange={(e) => setNewGuestEmail(e.target.value)}
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setIsCreatingGuest(false)}
                className="text-left text-xs text-text-2 underline hover:text-text"
              >
                Stattdessen bestehenden Gast suchen
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={guestQuery}
                onChange={(e) => setGuestQuery(e.target.value)}
                placeholder="Name oder E-Mail suchen…"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
              />
              {visibleGuestResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-md border border-line bg-surface shadow-[var(--shadow-token)]">
                  {visibleGuestResults.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGuest(g);
                          setGuestResults([]);
                          setGuestQuery("");
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-2"
                      >
                        {g.first_name} {g.last_name}
                        {g.email && <span className="text-text-3"> · {g.email}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setIsCreatingGuest(true)}
                className="mt-1 text-xs text-text-2 underline hover:text-text"
              >
                + Neuen Gast anlegen
              </button>
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm text-text-2">
          Kategorie
          <select
            value={roomTypeId}
            onChange={(e) => setRoomTypeId(e.target.value)}
            required
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
          >
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-text-2">
            Anreise
            <input
              type="date"
              value={checkInDate}
              onChange={(e) => setCheckInDate(e.target.value)}
              required
              className="min-h-11 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-2">
            Abreise
            <input
              type="date"
              value={checkOutDate}
              onChange={(e) => setCheckOutDate(e.target.value)}
              required
              className="min-h-11 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
            />
          </label>
        </div>
        {nights <= 0 && <p className="text-xs text-red">Abreise muss nach Anreise liegen.</p>}

        <label className="flex flex-col gap-1 text-sm text-text-2">
          Zimmer
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
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
            <span className="text-xs text-text-3">Keine freien Zimmer dieser Kategorie im gewählten Zeitraum.</span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-text-2">
            Erwachsene
            <input
              type="number"
              min={1}
              value={adults}
              onChange={(e) => setAdults(Number(e.target.value))}
              required
              className="min-h-11 rounded-md border border-line bg-surface-3 px-2 font-mono text-text focus:border-focus focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-2">
            Kinder
            <input
              type="number"
              min={0}
              value={children}
              onChange={(e) => setChildren(Number(e.target.value))}
              required
              className="min-h-11 rounded-md border border-line bg-surface-3 px-2 font-mono text-text focus:border-focus focus:outline-none"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-text-2">
          Gesamtpreis (€) — {nights > 0 ? `${nights} Nächte` : "…"}
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceEuro}
            onChange={(e) => setPriceOverride(e.target.value)}
            required
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 font-mono text-text focus:border-focus focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-text-2">
          Notiz (optional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded-md border border-line bg-surface-3 px-3 py-2 text-text focus:border-focus focus:outline-none"
          />
        </label>

        {error && <p className="text-xs text-red">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-md bg-accent px-3 font-semibold text-on-accent hover:bg-accent-hi disabled:opacity-60"
        >
          {saving ? "Legt an…" : "Buchung anlegen"}
        </button>
      </form>
    </aside>
  );
}
