/**
 * Zimmerstatus → Farbe/Label, gemäß docs/design/hotel-tool-design-referenz.md
 * §2+§3. Die Referenz definiert vier Farb-"Bedeutungsgruppen" (grün/blau/
 * gelb/rot) für sechs Zustände — reserviert/belegt teilen sich Blau,
 * Wartung/gesperrt teilen sich Rot. Um trotzdem alle sechs unterscheidbar zu
 * halten, ohne die Farbregel zu verletzen ("eine Farbe = eine Bedeutung pro
 * Kontext"), wird innerhalb einer Farbgruppe zusätzlich gefüllt/umrandet
 * unterschieden — genau das Muster, das der Belegungsplan-Prototyp für
 * belegt (gefüllt) vs. reserviert (umrandet/hell) ohnehin schon verwendet.
 */
export const ROOM_STATUS_META = {
  available: { label: "Frei", color: "green", filled: true },
  reserved: { label: "Reserviert", color: "blue", filled: false },
  occupied: { label: "Belegt", color: "blue", filled: true },
  cleaning: { label: "Reinigung", color: "yellow", filled: true },
  maintenance: { label: "Wartung", color: "red", filled: true },
  blocked: { label: "Gesperrt", color: "red", filled: false },
} as const;

export type RoomStatus = keyof typeof ROOM_STATUS_META;

export const ROOM_STATUS_ORDER: RoomStatus[] = [
  "available",
  "reserved",
  "occupied",
  "cleaning",
  "maintenance",
  "blocked",
];
