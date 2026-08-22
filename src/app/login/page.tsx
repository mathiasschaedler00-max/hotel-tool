"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@lib/supabase/client";

/**
 * Minimaler Login — kein Bestandteil der 8 Design-Prototyp-Screens (die
 * gehen alle von einer bereits eingeloggten Session aus), aber Voraussetzung
 * dafür, dass irgendeine der Dashboard-Seiten in einem echten Browser
 * überhaupt erreichbar ist (proxy.ts verlangt eine Session).
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-[var(--shadow-token)]"
      >
        <h1 className="mb-6 text-lg font-semibold text-text">Hotel Tool — Anmeldung</h1>
        <label className="mb-3 block text-sm text-text-2">
          E-Mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
          />
        </label>
        <label className="mb-4 block text-sm text-text-2">
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 block w-full min-h-11 rounded-md border border-line bg-surface-3 px-3 text-text focus:border-focus focus:outline-none"
          />
        </label>
        {error && <p className="mb-4 text-sm text-red">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="min-h-11 w-full rounded-md bg-accent px-4 font-medium text-on-accent hover:bg-accent-hi disabled:opacity-60"
        >
          {loading ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
