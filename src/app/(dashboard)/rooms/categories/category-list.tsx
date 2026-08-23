"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatEuro } from "@lib/format";
import type { RoomType } from "@modules/pms/room-types/service";
import { CategoryEditPanel } from "./category-edit-panel";

const TABLE_COLS = "1fr 100px 120px 90px";

/** Gleiches Tabellenmuster wie Screen 8 (Zimmerverwaltung) — Auftrag 23.08.2026. */
export function CategoryList({
  roomTypes,
  deactivatedRoomTypes,
  roomCountByType,
}: {
  roomTypes: RoomType[];
  deactivatedRoomTypes: RoomType[];
  roomCountByType: Record<string, number>;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function handleReactivate(roomTypeId: string) {
    setReactivatingId(roomTypeId);
    setReactivateError(null);
    try {
      const res = await fetch(`/api/v1/pms/room-types/${roomTypeId}/reactivate`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
    } catch (err) {
      setReactivateError(err instanceof Error ? err.message : "Fehler beim Reaktivieren");
    } finally {
      setReactivatingId(null);
    }
  }

  const selected = roomTypes.find((rt) => rt.id === selectedId) ?? null;
  const panelOpen = selected !== null || isCreating;

  function closePanel() {
    setSelectedId(null);
    setIsCreating(false);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-text-2">{roomTypes.length} Kategorien</p>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setIsCreating(true);
            }}
            className="min-h-9 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hi"
          >
            Kategorie anlegen
          </button>
        </div>

        {roomTypes.length === 0 ? (
          <p className="text-text-2">Noch keine Kategorien angelegt.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <div className="min-w-[440px]">
              <div
                className="grid gap-x-3 border-b border-line bg-surface-2 px-3 py-2 text-[10px] font-medium tracking-wide text-text-3 uppercase"
                style={{ gridTemplateColumns: TABLE_COLS }}
              >
                <span>Name</span>
                <span className="text-right">Preis/Nacht</span>
                <span className="text-right">Max. Pers.</span>
                <span className="text-right">Zimmer</span>
              </div>
              {roomTypes.map((rt) => (
                <button
                  key={rt.id}
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setSelectedId(rt.id);
                  }}
                  className={`grid w-full items-center gap-x-3 border-b border-line px-3 py-2.5 text-left text-sm hover:bg-surface-2 ${
                    selectedId === rt.id ? "bg-surface-2" : ""
                  }`}
                  style={{ gridTemplateColumns: TABLE_COLS }}
                >
                  <span className="truncate text-text">{rt.name}</span>
                  <span className="text-right font-mono text-text-2">{formatEuro(rt.base_rate_cents)}</span>
                  <span className="text-right font-mono text-text-2">
                    {rt.capacity_children > 0 ? `${rt.capacity_adults}+${rt.capacity_children}` : rt.capacity_adults}
                  </span>
                  <span className="text-right font-mono text-text-3">{roomCountByType[rt.id] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {deactivatedRoomTypes.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowDeactivated((v) => !v)}
              className="text-sm text-text-2 underline hover:text-text"
            >
              {showDeactivated
                ? "Außer Betrieb genommene Kategorien verbergen"
                : `Außer Betrieb genommene Kategorien anzeigen (${deactivatedRoomTypes.length})`}
            </button>

            {showDeactivated && (
              <div className="mt-2 rounded-lg border border-line bg-surface">
                {deactivatedRoomTypes.map((rt) => (
                  <div
                    key={rt.id}
                    className="flex flex-col gap-2 border-b border-line px-3 py-2.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-text-2">{rt.name}</span>
                      <span className="font-mono text-text-3">{formatEuro(rt.base_rate_cents)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleReactivate(rt.id)}
                      disabled={reactivatingId === rt.id}
                      className="min-h-9 rounded-md border border-line px-3 text-sm text-text-2 hover:bg-surface-2 disabled:opacity-60"
                    >
                      {reactivatingId === rt.id ? "Aktiviert…" : "Wieder aktivieren"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {reactivateError && <p className="mt-2 text-xs text-red">{reactivateError}</p>}
          </div>
        )}
      </div>

      {panelOpen && (
        <CategoryEditPanel
          roomType={selected}
          roomCount={selected ? (roomCountByType[selected.id] ?? 0) : 0}
          onClose={closePanel}
        />
      )}
    </div>
  );
}
