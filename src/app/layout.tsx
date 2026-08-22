import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/* IBM Plex Sans/Mono laut docs/design/hotel-tool-design-referenz.md §1
 * ("Basis-Font: IBM Plex Sans (Text), IBM Plex Mono (Zahlen/Preise/Codes,
 * tabellarisch ausgerichtet)") — ersetzt die create-next-app-Standardfonts. */
const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Hotel Tool",
  description: "Hotel Tool — Property Management System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      {/* h-full + overflow-hidden statt min-h-full: die Seite selbst
       * scrollt NIE — jede Route bestimmt ihre eigene(n) Scroll-Region(en)
       * (siehe (dashboard)/layout.tsx#main). Grund: eine feste vh-Schätzung
       * fürs Belegungsplan-Gitter war fragil und je nach Fensterhöhe
       * unzuverlässig (Review-Fund, 22.08.2026) — "die verfügbare Höhe
       * exakt ausfüllen" braucht einen durchgängig gefüllten Eltern-Baum. */}
      <body className="flex h-full flex-col overflow-hidden">{children}</body>
    </html>
  );
}
