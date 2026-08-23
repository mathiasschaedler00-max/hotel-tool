"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatEuro } from "@lib/format";
import type { Room } from "@modules/pms/rooms/service";
import type { RoomType } from "@modules/pms/room-types/service";
import type { ReservationWithDetails } from "@modules/pms/reservations/service";

/**
 * Check-in-Ablauf, Design-Referenz Screen 3 — Vollseiten-Modal mit fünf
 * Stationen, Fortschrittsanzeige oben, Timer rechts, "Abbrechen" jederzeit.
 *
 * Bewusst NICHT gebaut, weil die Datenbasis fehlt (statt eine Attrappe zu
 * zeigen — Regel "keine erfundenen Inhalte"):
 *  - Station 2: Geburtsdatum (kein Feld in `guests`), der Zustand "Ausweis
 *    vorab online gescannt" (nichts speichert das) und die Anzeige einer
 *    bereits hinterlegten Ausweisnummer (der autorisierte Reveal-Flow ist
 *    noch nicht gebaut — die Nummer ist verschlüsselt und wird nirgends
 *    entschlüsselt). Eintragen einer NEUEN Nummer geht, das Feld existiert.
 *  - Station 3: die violette KI-Vorschlagskarte — es gibt keine KI.
 *  - Station 4: Kaution/Vorautorisierung, "Bereits bezahlt · [Kanal]" und
 *    Kartenzahlung — alles Schritt 6 (PSP). Der Aufenthaltsbetrag ist echt,
 *    der offene Saldo ist bis Schritt 5 (Folio-Positionen) immer 0,00 €.
 *  - Station 5: WLAN-Zugangsdaten und Frühstückszeiten für die
 *    Gast-Zusammenfassung — dafür gibt es keine Felder am Hotel.
 */
const STATIONS = ["Gast", "Meldedaten", "Zimmer", "Zahlung", "Schlüssel"] as const;

interface ConflictDetails {
  requiresOverride?: boolean;
  roomNumber?: string;
  roomStatus?: string;
}

const ROOM_STATUS_LABELS: Record<string, string> = {
  available: "Frei",
  cleaning: "Reinigung",
  maintenance: "Wartung",
  blocked: "Gesperrt",
};

/** Buchungskanal lesbar machen — `reservations.source` speichert Slugs. */
const SOURCE_LABELS: Record<string, string> = {
  direct: "Direktbuchung",
  channel_manager: "Channel-Manager",
  phone: "Telefon",
  walk_in: "Walk-in",
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CheckInModal({
  reservation,
  roomTypes,
  rooms,
  onClose,
}: {
  reservation: ReservationWithDetails;
  roomTypes: RoomType[];
  rooms: Room[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [station, setStation] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Station 2 — nur echte Felder aus `guests`
  const [nationality, setNationality] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [guestLoaded, setGuestLoaded] = useState(false);

  // Station 3
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(reservation.room_id);
  const [roomConflict, setRoomConflict] = useState<{ message: string; details: ConflictDetails } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);

  // Station 4
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "later">("later");

  // Station 5
  const [keyCards, setKeyCards] = useState(0);
  const [done, setDone] = useState(false);

  // Startzeit erst im Effekt festhalten — `Date.now()` im Render-Pfad wäre
  // unrein und liefert bei einem Re-Render einen anderen Wert.
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    startedAt.current = Date.now();
    const t = setInterval(() => {
      if (startedAt.current !== null) setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !done) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, done]);

  // Gast-Stammdaten laden (Nationalität vorbelegen)
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/pms/guests/${reservation.guest_id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.data) return;
        setNationality(body.data.nationality ?? "");
        setGuestLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setGuestLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reservation.guest_id]);

  // Freie Zimmer der Kategorie für die Alternativen-Liste
  useEffect(() => {
    const cancelled = { current: false };
    fetch(
      `/api/v1/pms/reservations/available-rooms?from=${reservation.check_in_date}&to=${reservation.check_out_date}&roomTypeId=${reservation.room_type_id}`
    )
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => {
        if (!cancelled.current) setAvailableRooms(body.data ?? []);
      })
      .catch(() => {
        if (!cancelled.current) setAvailableRooms([]);
      });
    return () => {
      cancelled.current = true;
    };
  }, [reservation.check_in_date, reservation.check_out_date, reservation.room_type_id]);

  const guestName = reservation.guest
    ? `${reservation.guest.first_name} ${reservation.guest.last_name}`
    : "Ohne Gast";
  const roomType = roomTypes.find((rt) => rt.id === reservation.room_type_id);
  const nights = Math.round(
    (Date.parse(`${reservation.check_out_date}T00:00:00Z`) - Date.parse(`${reservation.check_in_date}T00:00:00Z`)) /
      86_400_000
  );
  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId]
  );

  async function saveGuestData() {
    // Nur schreiben, wenn sich wirklich etwas geändert hat
    if (!nationality.trim() && !documentNumber.trim()) return;
    const res = await fetch(`/api/v1/pms/guests/${reservation.guest_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: reservation.guest?.first_name,
        lastName: reservation.guest?.last_name,
        email: null,
        phone: null,
        nationality: nationality.trim() || null,
        ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error((await res.json().catch(() => null))?.error?.message ?? "Meldedaten konnten nicht gespeichert werden");
    }
  }

  /** Station 3 → 4: prüft die Zimmerzuweisung serverseitig, ohne schon einzuchecken. */
  async function verifyRoomAssignment(): Promise<boolean> {
    if (!selectedRoomId) {
      setError("Bitte ein Zimmer auswählen.");
      return false;
    }
    // Ist das Zimmer bereits zugewiesen und bezugsfertig, ist nichts zu tun.
    if (selectedRoomId === reservation.room_id && selectedRoom?.status === "available") {
      setRoomConflict(null);
      return true;
    }
    const res = await fetch(`/api/v1/pms/reservations/${reservation.id}/assign-room`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: selectedRoomId,
        overrideRoomStatus: Boolean(roomConflict && overrideReason.trim()),
        ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
      }),
    });
    if (res.ok) {
      setRoomConflict(null);
      router.refresh();
      return true;
    }
    const body = await res.json().catch(() => null);
    const details = (body?.error?.details ?? {}) as ConflictDetails;
    if (details.requiresOverride) {
      setRoomConflict({ message: body?.error?.message ?? "Zimmer nicht bezugsfertig", details });
      return false;
    }
    setError(body?.error?.message ?? `Status ${res.status}`);
    return false;
  }

  async function handleNext() {
    setError(null);
    setSaving(true);
    try {
      if (station === 1) await saveGuestData();
      if (station === 2) {
        const ok = await verifyRoomAssignment();
        if (!ok) return;
      }
      setStation((s) => Math.min(s + 1, STATIONS.length - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unerwarteter Fehler");
    } finally {
      setSaving(false);
    }
  }

  /** Station 5 → Abschluss: der eigentliche Check-in. */
  async function completeCheckIn() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/pms/reservations/${reservation.id}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: selectedRoomId ?? undefined,
          overrideRoomStatus: Boolean(roomConflict && overrideReason.trim()),
          ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      }
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check-in fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      {/* ── Kopf: Fortschritt + Timer + Abbrechen ── */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-line bg-surface px-4 py-3 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-text">Check-in · {guestName}</h1>
            <p className="truncate text-sm text-text-2">
              {reservation.reservation_no} · {formatDate(reservation.check_in_date)}–
              {formatDate(reservation.check_out_date)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="font-mono text-sm text-text-2" title="Dauer dieses Check-ins">
              {formatElapsed(elapsed)}
            </span>
            {!done && (
              <button
                type="button"
                onClick={onClose}
                className="min-h-9 rounded-md border border-line px-3 text-sm text-text-2 hover:bg-surface-2"
              >
                Abbrechen
              </button>
            )}
          </div>
        </div>

        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {STATIONS.map((label, i) => {
            const state = done || i < station ? "done" : i === station ? "current" : "todo";
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                    state === "done"
                      ? "bg-green text-white"
                      : state === "current"
                        ? "bg-accent text-on-accent"
                        : "bg-surface-2 text-text-3"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className={`text-xs ${state === "todo" ? "text-text-3" : "text-text"}`}>{label}</span>
                {i < STATIONS.length - 1 && <span aria-hidden className="mx-1 text-text-3">›</span>}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── Inhalt ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-2xl">
          {done ? (
            <div className="flex flex-col gap-5 rounded-lg border border-green bg-green-bg p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green text-xl text-white">
                  ✓
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-text">Check-in abgeschlossen</h2>
                  <p className="text-sm text-text-2">{guestName} ist eingecheckt.</p>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-surface p-4 text-sm">
                <dt className="text-text-2">Zimmer</dt>
                <dd className="text-right font-mono text-text">
                  {selectedRoom ? selectedRoom.room_number : "—"}
                  {selectedRoom?.floor ? ` · Etage ${selectedRoom.floor}` : ""}
                </dd>
                <dt className="text-text-2">Zeitraum</dt>
                <dd className="text-right text-text">
                  {formatDate(reservation.check_in_date)}–{formatDate(reservation.check_out_date)}
                </dd>
                <dt className="text-text-2">Nächte</dt>
                <dd className="text-right font-mono text-text">{nights}</dd>
                <dt className="text-text-2">Schlüsselkarten</dt>
                <dd className="text-right font-mono text-text">{keyCards}</dd>
              </dl>

              <p className="text-xs text-text-3">
                WLAN-Zugangsdaten und Frühstückszeiten für den Gast fehlen hier bewusst — dafür gibt es noch keine
                Felder am Hotel.
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hi"
                >
                  Zum Belegungsplan
                </button>
                <button
                  type="button"
                  disabled
                  title="Gast-Profil-Seite kommt mit einem späteren Schritt"
                  className="min-h-11 cursor-not-allowed rounded-md border border-line px-4 text-sm text-text-3 opacity-60"
                >
                  Zum Gast-Profil
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Station 1: Gast bestätigen ── */}
              {station === 0 && (
                <section className="flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-text">Gast bestätigen</h2>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm">
                    <dt className="text-text-2">Gast</dt>
                    <dd className="text-right text-text">{guestName}</dd>
                    <dt className="text-text-2">Buchungsnr.</dt>
                    <dd className="text-right font-mono text-text">{reservation.reservation_no}</dd>
                    <dt className="text-text-2">Kategorie</dt>
                    <dd className="text-right text-text">{roomType?.name ?? "—"}</dd>
                    <dt className="text-text-2">Nächte</dt>
                    <dd className="text-right font-mono text-text">{nights}</dd>
                    <dt className="text-text-2">Erwachsene</dt>
                    <dd className="text-right font-mono text-text">{reservation.adults}</dd>
                    {reservation.children > 0 && (
                      <>
                        <dt className="text-text-2">Kinder</dt>
                        <dd className="text-right font-mono text-text">{reservation.children}</dd>
                      </>
                    )}
                    <dt className="text-text-2">Kanal</dt>
                    <dd className="text-right text-text">
                      {SOURCE_LABELS[reservation.source] ?? reservation.source}
                    </dd>
                  </dl>
                </section>
              )}

              {/* ── Station 2: Meldedaten ── */}
              {station === 1 && (
                <section className="flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-text">Meldedaten</h2>
                  <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                    <label className="flex flex-col gap-1 text-sm text-text-2">
                      Nationalität
                      <input
                        type="text"
                        value={nationality}
                        onChange={(e) => setNationality(e.target.value)}
                        placeholder={guestLoaded ? "z. B. Österreich" : "lädt…"}
                        className="min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-text-2">
                      Ausweis-/Passnummer
                      <input
                        type="text"
                        value={documentNumber}
                        onChange={(e) => setDocumentNumber(e.target.value)}
                        placeholder="leer lassen, wenn unverändert"
                        className="min-h-11 rounded-md border border-line bg-surface-3 px-3 font-mono text-text focus:border-focus focus:outline-none"
                      />
                      <span className="text-xs text-text-3">
                        Wird verschlüsselt gespeichert. Eine bereits hinterlegte Nummer kann nicht angezeigt werden —
                        der autorisierte Anzeige-Vorgang ist noch nicht gebaut.
                      </span>
                    </label>
                  </div>
                  <p className="rounded-md bg-surface-2 p-3 text-xs text-text-2">
                    Die Meldedaten werden zur Erfüllung der gesetzlichen Meldepflicht erhoben und gespeichert. Die
                    Ausweisnummer wird verschlüsselt abgelegt und ist nur für berechtigte Rollen einsehbar.
                  </p>
                  <p className="text-xs text-text-3">
                    Geburtsdatum und der Zustand „Ausweis vorab online gescannt&ldquo; aus der Design-Vorgabe fehlen hier —
                    für beides gibt es noch keine Felder im Datenmodell.
                  </p>
                </section>
              )}

              {/* ── Station 3: Zimmer zuweisen ── */}
              {station === 2 && (
                <section className="flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-text">Zimmer zuweisen</h2>

                  {selectedRoom && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
                      <div>
                        <p className="font-mono text-lg font-semibold text-text">
                          {selectedRoom.room_number}
                          {selectedRoom.floor ? <span className="ml-2 text-sm text-text-3">Etage {selectedRoom.floor}</span> : null}
                        </p>
                        <p className="text-sm text-text-2">{roomType?.name ?? "—"}</p>
                      </div>
                      <span className="text-sm text-text-2">
                        {ROOM_STATUS_LABELS[selectedRoom.status] ?? selectedRoom.status}
                      </span>
                    </div>
                  )}

                  {roomConflict && (
                    <div className="flex flex-col gap-3 rounded-lg border-2 border-red bg-red-bg p-4">
                      <p className="text-sm font-semibold text-red">{roomConflict.message}</p>

                      {availableRooms.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs font-medium text-text-2">Freie Alternativen dieser Kategorie:</p>
                          <div className="flex flex-wrap gap-2">
                            {availableRooms.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => {
                                  setSelectedRoomId(r.id);
                                  setRoomConflict(null);
                                  setOverrideReason("");
                                }}
                                className="min-h-9 rounded-md border border-line bg-surface px-3 font-mono text-sm text-text hover:bg-surface-2"
                              >
                                {r.room_number}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-2 border-t border-red pt-3">
                        <label className="flex flex-col gap-1 text-xs text-text-2">
                          Trotzdem zuweisen — Begründung (Pflicht)
                          <input
                            type="text"
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value)}
                            placeholder="z. B. Zimmer vor Ort geprüft, ist sauber"
                            className="min-h-9 rounded-md border border-line bg-surface px-3 text-sm text-text focus:border-focus focus:outline-none"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleNext}
                          disabled={!overrideReason.trim() || saving}
                          className="min-h-9 self-start rounded-md bg-red px-3 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Trotzdem zuweisen (geprüft)
                        </button>
                        <p className="text-xs text-text-2">
                          Setzt den Zimmerstatus mit auf „Frei&ldquo; — sonst laufen Belegungsplan und Housekeeping
                          auseinander.
                        </p>
                      </div>
                    </div>
                  )}

                  {!roomConflict && (
                    <label className="flex flex-col gap-1 text-sm text-text-2">
                      Anderes Zimmer wählen
                      <select
                        value={selectedRoomId ?? ""}
                        onChange={(e) => setSelectedRoomId(e.target.value || null)}
                        className="min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
                      >
                        {selectedRoom && !availableRooms.some((r) => r.id === selectedRoom.id) && (
                          <option value={selectedRoom.id}>{selectedRoom.room_number} (aktuell)</option>
                        )}
                        {availableRooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.room_number}
                            {r.floor ? ` · Etage ${r.floor}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </section>
              )}

              {/* ── Station 4: Zahlung ── */}
              {station === 3 && (
                <section className="flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-text">Zahlung</h2>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm">
                    <dt className="text-text-2">Aufenthalt gesamt</dt>
                    <dd className="text-right font-mono text-text">{formatEuro(reservation.rate_cents)}</dd>
                    <dt className="text-text-2">Offener Saldo</dt>
                    <dd className="text-right font-mono text-text">{formatEuro(0)}</dd>
                  </dl>
                  <p className="text-xs text-text-3">
                    Der offene Saldo ist bis auf Weiteres 0,00 € — Leistungen aufs Zimmer buchen kommt erst mit dem
                    Folio (Schritt 5). Kaution/Vorautorisierung, Kartenzahlung und „Bereits bezahlt über OTA&ldquo; fehlen
                    hier bewusst, sie hängen am Zahlungsanbieter (Schritt 6).
                  </p>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-text-2">Zahlungsart</p>
                    <div className="flex gap-2">
                      {(
                        [
                          ["later", "Bei Abreise"],
                          ["cash", "Bar"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPaymentMethod(value)}
                          className={`min-h-11 rounded-md border px-4 text-sm ${
                            paymentMethod === value
                              ? "border-accent bg-accent text-on-accent"
                              : "border-line bg-surface text-text-2 hover:bg-surface-2"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {/* ── Station 5: Schlüssel ── */}
              {station === 4 && (
                <section className="flex flex-col gap-4">
                  <h2 className="text-base font-semibold text-text">Schlüssel</h2>
                  <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                    <p className="text-sm text-text-2">
                      Karte auf den Kodierer legen und kodieren. Für Begleitpersonen weitere Karten hinzufügen.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setKeyCards((n) => n + 1)}
                        className="min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hi"
                      >
                        Karte kodieren
                      </button>
                      <span className="font-mono text-sm text-text-2">{keyCards}× kodiert</span>
                    </div>
                    <p className="text-xs text-text-3">
                      Reine Oberfläche — es ist keine Kartenleser-Hardware angebunden.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setKeyCards(0)}
                    className="self-start text-xs text-text-2 underline hover:text-text"
                  >
                    Kein Kartenleser verfügbar – ohne Kodierung abschließen
                  </button>
                </section>
              )}

              {error && <p className="mt-4 rounded-md bg-red-bg p-3 text-sm text-red">{error}</p>}
            </>
          )}
        </div>
      </div>

      {/* ── Fuß: Navigation ── */}
      {!done && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 sm:px-8">
          <button
            type="button"
            onClick={() => setStation((s) => Math.max(s - 1, 0))}
            disabled={station === 0 || saving}
            className="min-h-11 rounded-md border border-line px-4 text-sm text-text-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Zurück
          </button>
          {station < STATIONS.length - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={saving || Boolean(roomConflict)}
              title={roomConflict ? "Erst die Warnung oben auflösen" : undefined}
              className="min-h-11 rounded-md bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Prüft…" : "Weiter"}
            </button>
          ) : (
            <button
              type="button"
              onClick={completeCheckIn}
              disabled={saving}
              className="min-h-11 rounded-md bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hi disabled:opacity-60"
            >
              {saving ? "Checkt ein…" : "Check-in abschließen"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
