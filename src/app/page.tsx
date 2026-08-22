import { redirect } from "next/navigation";

/**
 * `/` bleibt laut `proxy.ts` bewusst eine öffentliche Route (Platz für eine
 * künftige Marketing-/Landingpage) — das eigentliche Dashboard lebt unter
 * `/rooms`. Unauthentifizierte Besucher landen dort automatisch bei
 * `/login` (proxy.ts greift auf `/rooms`, nicht hier).
 */
export default function RootPage() {
  redirect("/rooms");
}
