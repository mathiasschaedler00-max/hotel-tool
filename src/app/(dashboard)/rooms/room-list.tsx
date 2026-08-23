"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatEuro } from "@lib/format";
import type { RoomType } from "@modules/pms/room-types/service";
import { getRoomDisplayStatus, type RoomStatus } from "./room-status";
import { RoomEditPanel } from "./room-edit-panel";

interface RoomRow {
  id: string;
  room_number: string;
  floor: string | null;
  status: RoomStatus;
  room_type_id: string;
}

const DOT_COLOR_CLASSES: Record<string, string> = {
  green: "bg-green",
  blue: "bg-blue",
  yellow: "bg-yellow",
  red: "bg-red",
};

function StatusDot({ status, isCheckedInToday }: { status: RoomStatus; isCheckedInToday: boolean }) {
  const meta = getRoomDisplayStatus(status, isCheckedInToday);
  const colorClass = DOT_COLOR_CLASSES[meta.color];
  return (
    <span
      aria-hidden
      className={
        meta.filled
          ? `inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colorClass}`
          : `inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-transparent ${colorClass.replace("bg-", "border-")}`
      }
    />
  );
}

function occupancyLabel(rt: RoomType): string {
  return rt.capacity_children > 0 ? `${rt.capacity_adults}+${rt.capacity_children}` : `${rt.capacity_adults}`;
}

const TABLE_COLS = "88px 1fr 72px 100px 84px 1fr";

/**
 * Screen 8 "Zimmerverwaltung (Stammdaten)" — Auftrag 23.08.2026: kompakte,
 * nach Kategorie gruppierte Tabelle statt großer Karten (Stammdatenpflege,
 * nicht Tagesbetrieb — 40 Zimmer sollen überblickbar sein). Preis/Nacht und
 * max. Personen kommen aus der Kategorie (`room_types`), nicht vom Zimmer
 * selbst — siehe Kommentar in `modules/pms/rooms/schema.ts`.
 */
export function RoomList({
  rooms,
  deactivatedRooms,
  roomTypes,
  checkedInTodayRoomIds,
}: {
  rooms: RoomRow[];
  deactivatedRooms: RoomRow[];
  roomTypes: RoomType[];
  checkedInTodayRoomIds: Set<string>;
}) {
  const router = useRouter();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  const roomTypeById = useMemo(() => new Map(roomTypes.map((rt) => [rt.id, rt])), [roomTypes]);

  async function handleReactivate(roomId: string) {
    setReactivatingId(roomId);
    setReactivateError(null);
    try {
      const res = await fetch(`/api/v1/pms/rooms/${roomId}/reactivate`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
    } catch (err) {
      setReactivateError(err instanceof Error ? err.message : "Fehler beim Reaktivieren");
    } finally {
      setReactivatingId(null);
    }
  }

  const roomsByType = useMemo(() => {
    const map = new Map<string, RoomRow[]>();
    for (const room of rooms) {
      const list = map.get(room.room_type_id) ?? [];
      list.push(room);
      map.set(room.room_type_id, list);
    }
    return map;
  }, [rooms]);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
  const panelOpen = selectedRoom !== null || isCreating;

  function closePanel() {
    setSelectedRoomId(null);
    setIsCreating(false);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-text-2">{rooms.length} Zimmer</p>
          <div className="flex items-center gap-3">
            <Link href="/rooms/categories" className="text-sm text-text-2 underline hover:text-text">
              Kategorien verwalten
            </Link>
            <button
              type="button"
              onClick={() => {
                setSelectedRoomId(null);
                setIsCreating(true);
              }}
              disabled={roomTypes.length === 0}
              title={roomTypes.length === 0 ? "Erst eine Kategorie anlegen" : undefined}
              className="min-h-9 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-50"
            >
              Zimmer hinzufügen
            </button>
          </div>
        </div>

        {rooms.length === 0 ? (
          <p className="text-text-2">Noch keine Zimmer angelegt.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <div className="min-w-[560px]">
              <div
                className="grid gap-x-3 border-b border-line bg-surface-2 px-3 py-2 text-[10px] font-medium tracking-wide text-text-3 uppercase"
                style={{ gridTemplateColumns: TABLE_COLS }}
              >
                <span>Nummer</span>
                <span>Kategorie</span>
                <span>Etage</span>
                <span className="text-right">Preis/Nacht</span>
                <span className="text-right">Max. Pers.</span>
                <span>Zustand</span>
              </div>

              {roomTypes.map((rt) => {
                const roomsForType = roomsByType.get(rt.id);
                if (!roomsForType || roomsForType.length === 0) return null;
                return (
                  <div key={rt.id}>
                    <div className="border-b border-line bg-surface-2 px-3 py-1 text-xs font-semibold tracking-wide text-text-2 uppercase">
                      {rt.name} · {roomsForType.length}
                    </div>
                    {roomsForType.map((room) => {
                      const isCheckedInToday = checkedInTodayRoomIds.has(room.id);
                      const meta = getRoomDisplayStatus(room.status, isCheckedInToday);
                      return (
                        <button
                          key={room.id}
                          type="button"
                          onClick={() => {
                            setIsCreating(false);
                            setSelectedRoomId(room.id);
                          }}
                          className={`grid w-full items-center gap-x-3 border-b border-line px-3 py-2.5 text-left text-sm hover:bg-surface-2 ${
                            selectedRoomId === room.id ? "bg-surface-2" : ""
                          }`}
                          style={{ gridTemplateColumns: TABLE_COLS }}
                        >
                          <span className="font-mono font-semibold text-text">{room.room_number}</span>
                          <span className="truncate text-text-2">{rt.name}</span>
                          <span className="text-text-3">{room.floor ?? "—"}</span>
                          <span className="text-right font-mono text-text-2">{formatEuro(rt.base_rate_cents)}</span>
                          <span className="text-right font-mono text-text-2">{occupancyLabel(rt)}</span>
                          <span className="flex items-center gap-2 text-text-2">
                            <StatusDot status={room.status} isCheckedInToday={isCheckedInToday} />
                            {meta.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {deactivatedRooms.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowDeactivated((v) => !v)}
              className="text-sm text-text-2 underline hover:text-text"
            >
              {showDeactivated ? "Außer Betrieb genommene Zimmer verbergen" : `Außer Betrieb genommene Zimmer anzeigen (${deactivatedRooms.length})`}
            </button>

            {showDeactivated && (
              <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
                <div className="min-w-[420px]">
                  {deactivatedRooms.map((room) => {
                    const rt = roomTypeById.get(room.room_type_id);
                    return (
                      <div
                        key={room.id}
                        className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 text-sm last:border-b-0"
                      >
                        <span className="flex items-center gap-3">
                          <span className="font-mono font-semibold text-text-2">{room.room_number}</span>
                          <span className="text-text-3">{rt?.name ?? "—"}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleReactivate(room.id)}
                          disabled={reactivatingId === room.id}
                          className="min-h-8 rounded-md border border-line px-3 text-sm text-text-2 hover:bg-surface-2 disabled:opacity-60"
                        >
                          {reactivatingId === room.id ? "Aktiviert…" : "Wieder aktivieren"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {reactivateError && <p className="mt-2 text-xs text-red">{reactivateError}</p>}
          </div>
        )}
      </div>

      {panelOpen && (
        <RoomEditPanel
          room={selectedRoom}
          roomTypes={roomTypes}
          isCheckedInToday={selectedRoom ? checkedInTodayRoomIds.has(selectedRoom.id) : false}
          onClose={closePanel}
        />
      )}
    </div>
  );
}
