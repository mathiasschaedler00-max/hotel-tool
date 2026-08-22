"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomType } from "@modules/pms/room-types/service";

/**
 * Anlegen/Bearbeiten einer Kategorie (Auftrag 23.08.2026). Preis als
 * EUR-Eingabe (nicht Cent) für die Nutzerin, Umrechnung in `base_rate_cents`
 * beim Absenden — gleiche Rundungslogik wie überall sonst (`Math.round`,
 * keine Fließkommafehler in der DB).
 */
export function CategoryEditPanel({ roomType, onClose }: { roomType: RoomType | null; onClose: () => void }) {
  const router = useRouter();
  const isCreating = roomType === null;

  const [name, setName] = useState(roomType?.name ?? "");
  const [code, setCode] = useState(roomType?.code ?? "");
  const [priceEuro, setPriceEuro] = useState(roomType ? (roomType.base_rate_cents / 100).toFixed(2) : "");
  const [capacityAdults, setCapacityAdults] = useState(roomType?.capacity_adults ?? 2);
  const [capacityChildren, setCapacityChildren] = useState(roomType?.capacity_children ?? 0);
  const [description, setDescription] = useState(roomType?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const baseRateCents = Math.round(parseFloat(priceEuro.replace(",", ".")) * 100);
    const payload = {
      name,
      code: code || null,
      capacityAdults: Number(capacityAdults),
      capacityChildren: Number(capacityChildren),
      baseRateCents: Number.isFinite(baseRateCents) ? baseRateCents : 0,
      description: description || null,
    };
    try {
      const res = isCreating
        ? await fetch("/api/v1/pms/room-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/v1/pms/room-types/${roomType.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Status ${res.status}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-token)] sm:w-80">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-text">{isCreating ? "Kategorie anlegen" : `Kategorie „${roomType.name}“`}</h2>
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
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-text-2">
          Kürzel (optional)
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 font-mono text-text focus:border-focus focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-text-2">
          Basispreis/Nacht (€)
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceEuro}
            onChange={(e) => setPriceEuro(e.target.value)}
            required
            className="min-h-11 rounded-md border border-line bg-surface-3 px-3 font-mono text-text focus:border-focus focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-text-2">
            Max. Erwachsene
            <input
              type="number"
              min="1"
              value={capacityAdults}
              onChange={(e) => setCapacityAdults(Number(e.target.value))}
              required
              className="min-h-11 rounded-md border border-line bg-surface-3 px-3 font-mono text-text focus:border-focus focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-2">
            Max. Kinder
            <input
              type="number"
              min="0"
              value={capacityChildren}
              onChange={(e) => setCapacityChildren(Number(e.target.value))}
              required
              className="min-h-11 rounded-md border border-line bg-surface-3 px-3 font-mono text-text focus:border-focus focus:outline-none"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-text-2">
          Beschreibung (optional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="rounded-md border border-line bg-surface-3 px-3 py-2 text-text focus:border-focus focus:outline-none"
          />
        </label>

        <p className="text-[11px] text-text-3">
          Nur die Basisrate — Saison-/Wochentagspreise kommen mit dem Raten-Management, dynamische Anpassung erst mit
          der Revenue-KI.
        </p>

        {error && <p className="text-xs text-red">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-md bg-accent px-3 font-semibold text-on-accent hover:bg-accent-hi disabled:opacity-60"
        >
          {saving ? "Speichert…" : isCreating ? "Anlegen" : "Speichern"}
        </button>
      </form>
    </aside>
  );
}
