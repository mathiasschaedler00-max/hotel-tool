"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatEuro } from "@lib/format";
import type { RoomType } from "@modules/pms/room-types/service";
import { ROOM_STATUS_META, ROOM_STATUS_ORDER, getRoomDisplayStatus, type RoomStatus } from "./room-status";

interface RoomRow {
  id: string;
  room_number: string;
  floor: string | null;
  status: RoomStatus;
  room_type_id: string;
}

/**
 * Seiten-Panel zum Anlegen/Bearbeiten eines Zimmers (Screen 8
 * "Zimmerverwaltung", Auftrag 23.08.2026). Stammdaten (Nummer/Etage/
 * Kategorie) laufen über `PATCH /rooms/[id]`, der Zimmer-Zustand weiterhin
 * über den bestehenden `PATCH /rooms/[id]/status` — zwei Endpunkte, weil es
 * fachlich zwei getrennte Dinge sind (§3.1 vs. Stammdaten).
 *
 * Rückfrage-Dialog (Auftrag): wird der Zustand eines aktuell belegten
 * Zimmers auf Wartung/Gesperrt gesetzt, zeigt das Panel zunächst nur eine
 * Warnung mit Bestätigen/Abbrechen — kein natives `confirm()` (Design-System
 * nutzt durchgängig eigene UI, keine Browser-Dialoge).
 */
export function RoomEditPanel({
  room,
  roomTypes,
  isCheckedInToday,
  onClose,
}: {
  room: RoomRow | null;
  roomTypes: RoomType[];
  isCheckedInToday: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const isCreating = room === null;

  const [roomNumber, setRoomNumber] = useState(room?.room_number ?? "");
  const [floor, setFloor] = useState(room?.floor ?? "");
  const [roomTypeId, setRoomTypeId] = useState(room?.room_type_id ?? roomTypes[0]?.id ?? "");
  const [status, setStatus] = useState<RoomStatus>(room?.status ?? "available");
  const [needsOccupiedConfirm, setNeedsOccupiedConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const selectedRoomType = roomTypes.find((rt) => rt.id === roomTypeId) ?? null;
  const statusChangedToOutOfService =
    room !== null && status !== room.status && (status === "maintenance" || status === "blocked");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (statusChangedToOutOfService && isCheckedInToday && !needsOccupiedConfirm) {
      setNeedsOccupiedConfirm(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (isCreating) {
        const res = await fetch("/api/v1/pms/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomNumber, floor: floor || null, roomTypeId }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      } else {
        const masterDataRes = await fetch(`/api/v1/pms/rooms/${room.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomNumber, floor: floor || null, roomTypeId }),
        });
        if (!masterDataRes.ok) {
          throw new Error(
            (await masterDataRes.json().catch(() => null))?.error?.message ?? `Status ${masterDataRes.status}`
          );
        }
        if (status !== room.status) {
          const statusRes = await fetch(`/api/v1/pms/rooms/${room.id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          });
          if (!statusRes.ok) {
            throw new Error(
              (await statusRes.json().catch(() => null))?.error?.message ?? `Status ${statusRes.status}`
            );
          }
        }
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!room) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/pms/rooms/${room.id}/deactivate`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Außer-Betrieb-Nehmen");
      setSaving(false);
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-token)] sm:w-80">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-text">{isCreating ? "Zimmer hinzufügen" : `Zimmer ${room.room_number}`}</h2>
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
          Zimmernummer
          <input
            type="text"
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            required
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 font-mono text-text focus:border-focus focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-text-2">
          Etage
          <input
            type="text"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
          />
        </label>

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

        {/* Preis/max. Personen sind reine Info aus der gewählten Kategorie —
         * bewusst nicht editierbar am Zimmer selbst (siehe schema.ts). */}
        {selectedRoomType && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-surface-2 px-3 py-2 text-xs">
            <dt className="text-text-3">Preis/Nacht</dt>
            <dd className="text-right font-mono text-text-2">{formatEuro(selectedRoomType.base_rate_cents)}</dd>
            <dt className="text-text-3">Max. Personen</dt>
            <dd className="text-right font-mono text-text-2">
              {selectedRoomType.capacity_children > 0
                ? `${selectedRoomType.capacity_adults}+${selectedRoomType.capacity_children}`
                : selectedRoomType.capacity_adults}
            </dd>
          </dl>
        )}

        {!isCreating && (
          <label className="flex flex-col gap-1 text-sm text-text-2">
            Zimmerzustand
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as RoomStatus);
                setNeedsOccupiedConfirm(false);
              }}
              className="min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
            >
              {ROOM_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {ROOM_STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
        )}

        {!isCreating && isCheckedInToday && (
          <p className="text-xs text-text-2">{getRoomDisplayStatus(room.status, true).label} · Gast im Haus</p>
        )}

        {needsOccupiedConfirm && (
          <div className="flex flex-col gap-2 rounded-md border border-red bg-red-bg p-3 text-xs text-red">
            <p>Dieses Zimmer ist aktuell belegt (Gast im Haus). Zustand trotzdem ändern?</p>
            <div className="flex gap-2">
              <button
                type="submit"
                className="min-h-8 rounded-md bg-red px-3 font-semibold text-white hover:opacity-90"
              >
                Ja, trotzdem
              </button>
              <button
                type="button"
                onClick={() => {
                  setNeedsOccupiedConfirm(false);
                  setStatus(room!.status);
                }}
                className="min-h-8 rounded-md border border-line px-3 text-text-2 hover:bg-surface-2"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red">{error}</p>}

        {!needsOccupiedConfirm && (
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-md bg-accent px-3 font-semibold text-on-accent hover:bg-accent-hi disabled:opacity-60"
          >
            {saving ? "Speichert…" : isCreating ? "Anlegen" : "Speichern"}
          </button>
        )}
      </form>

      {!isCreating && (
        <div className="border-t border-line pt-3">
          {!confirmingDeactivate ? (
            <button
              type="button"
              onClick={() => setConfirmingDeactivate(true)}
              className="min-h-9 w-full rounded-md border border-line px-3 text-sm text-text-2 hover:bg-surface-2"
            >
              Außer Betrieb nehmen
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-red bg-red-bg p-3 text-xs text-red">
              <p>
                Zimmer {room.room_number} verschwindet aus Belegungsplan und Buchbarkeit, bleibt aber in Historie und
                Auswertungen erhalten. Fortfahren?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={saving}
                  className="min-h-8 rounded-md bg-red px-3 font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  Ja, außer Betrieb nehmen
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDeactivate(false)}
                  className="min-h-8 rounded-md border border-line px-3 text-text-2 hover:bg-surface-2"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
