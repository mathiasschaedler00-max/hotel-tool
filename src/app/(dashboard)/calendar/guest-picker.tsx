"use client";

import { useEffect, useState } from "react";

export interface GuestOption {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
}

export type GuestSelection =
  | { mode: "none" }
  | { mode: "existing"; guest: GuestOption }
  | { mode: "new"; firstName: string; lastName: string; email: string };

export const NO_GUEST_SELECTED: GuestSelection = { mode: "none" };

/**
 * Löst eine `GuestSelection` in eine echte `guestId` auf — legt bei
 * `mode: "new"` den Gast erst jetzt an (nicht schon bei der Auswahl), damit
 * ein abgebrochenes Formular keine Gast-Leiche hinterlässt. Wiederverwendet
 * zwischen Kontaktgast und den einzelnen Zeilen einer Gruppenbuchung.
 */
export async function resolveGuestId(selection: GuestSelection): Promise<string | null> {
  if (selection.mode === "existing") return selection.guest.id;
  if (selection.mode === "new") {
    if (!selection.firstName.trim() || !selection.lastName.trim()) {
      throw new Error("Vor- und Nachname des neuen Gasts sind erforderlich.");
    }
    const res = await fetch("/api/v1/pms/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: selection.firstName,
        lastName: selection.lastName,
        email: selection.email || undefined,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Fehler beim Gast anlegen");
    return (await res.json()).data.id;
  }
  return null;
}

/** Gastsuche mit Fallback "neuen Gast anlegen" — gleiche Interaktion wie im Einzel-Buchungsformular, hier als eigenständiges Element für Kontaktgast + jede Gruppenzeile. */
export function GuestPicker({ value, onChange }: { value: GuestSelection; onChange: (v: GuestSelection) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GuestOption[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      fetch(`/api/v1/pms/guests/search?q=${encodeURIComponent(query)}`)
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then((body) => {
          if (!cancelled) setResults(body.data ?? []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);
  const visibleResults = query.trim().length >= 2 ? results : [];

  if (value.mode === "existing") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-text">
        <span>
          {value.guest.first_name} {value.guest.last_name}
        </span>
        <button
          type="button"
          onClick={() => onChange(NO_GUEST_SELECTED)}
          className="text-xs text-text-2 underline hover:text-text"
        >
          Ändern
        </button>
      </div>
    );
  }

  if (value.mode === "new") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-2">
        <input
          type="text"
          placeholder="Vorname"
          value={value.firstName}
          onChange={(e) => onChange({ ...value, firstName: e.target.value })}
          className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
        />
        <input
          type="text"
          placeholder="Nachname"
          value={value.lastName}
          onChange={(e) => onChange({ ...value, lastName: e.target.value })}
          className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
        />
        <input
          type="email"
          placeholder="E-Mail (optional)"
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
          className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
        />
        <button
          type="button"
          onClick={() => onChange(NO_GUEST_SELECTED)}
          className="text-left text-xs text-text-2 underline hover:text-text"
        >
          Stattdessen bestehenden Gast suchen
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Name oder E-Mail suchen…"
        className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
      />
      {visibleResults.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-line bg-surface shadow-[var(--shadow-token)]">
          {visibleResults.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ mode: "existing", guest: g });
                  setResults([]);
                  setQuery("");
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
        onClick={() => onChange({ mode: "new", firstName: "", lastName: "", email: "" })}
        className="mt-1 text-xs text-text-2 underline hover:text-text"
      >
        + Neuen Gast anlegen
      </button>
    </div>
  );
}
