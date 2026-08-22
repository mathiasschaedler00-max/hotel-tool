"use client";

import { useState } from "react";
import { ROOM_STATUS_META, ROOM_STATUS_ORDER, type RoomStatus } from "./room-status";

interface RoomRow {
  id: string;
  room_number: string;
  floor: string | null;
  status: RoomStatus;
}

const DOT_COLOR_CLASSES: Record<string, string> = {
  green: "bg-green",
  blue: "bg-blue",
  yellow: "bg-yellow",
  red: "bg-red",
};

function StatusDot({ status }: { status: RoomStatus }) {
  const meta = ROOM_STATUS_META[status];
  const colorClass = DOT_COLOR_CLASSES[meta.color];
  return (
    <span
      aria-hidden
      className={
        meta.filled
          ? `inline-block h-3 w-3 rounded-full ${colorClass}`
          : `inline-block h-3 w-3 rounded-full border-2 ${colorClass.replace("bg-", "border-")} bg-transparent`
      }
    />
  );
}

function RoomCard({ room, onStatusChange }: { room: RoomRow; onStatusChange: (id: string, status: RoomStatus) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [localStatus, setLocalStatus] = useState(room.status);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as RoomStatus;
    const previous = localStatus;
    setLocalStatus(next);
    setSaving(true);
    setErrorMsg(null);
    try {
      await onStatusChange(room.id, next);
    } catch (err) {
      setLocalStatus(previous);
      setErrorMsg(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-token)] sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-3 sm:min-w-16 sm:flex-col">
        <span className="font-mono text-2xl font-semibold text-text">{room.room_number}</span>
        {room.floor && <span className="text-xs text-text-3">Etage {room.floor}</span>}
      </div>
      <div className="flex flex-1 items-center gap-2">
        <StatusDot status={localStatus} />
        <span className="text-sm text-text-2">{ROOM_STATUS_META[localStatus].label}</span>
      </div>
      <select
        value={localStatus}
        onChange={handleChange}
        disabled={saving}
        aria-label={`Status für Zimmer ${room.room_number} ändern`}
        className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-3 text-sm text-text disabled:opacity-60 sm:w-auto"
      >
        {ROOM_STATUS_ORDER.map((status) => (
          <option key={status} value={status}>
            {ROOM_STATUS_META[status].label}
          </option>
        ))}
      </select>
      {errorMsg && <span className="text-xs text-red">{errorMsg}</span>}
    </div>
  );
}

export function RoomList({ rooms }: { rooms: RoomRow[] }) {
  async function handleStatusChange(id: string, status: RoomStatus) {
    const res = await fetch(`/api/v1/pms/rooms/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message ?? `Status ${res.status}`);
    }
  }

  if (rooms.length === 0) {
    return <p className="text-text-2">Noch keine Zimmer angelegt.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} onStatusChange={handleStatusChange} />
      ))}
    </div>
  );
}
