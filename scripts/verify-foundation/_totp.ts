/**
 * Minimaler RFC-6238-TOTP-Generator (HMAC-SHA1, 30s-Schritt, 6 Stellen) —
 * nur für Punkt 6 (2FA) der Abnahme gebraucht: damit wir einen echten
 * Supabase-MFA-Faktor (`auth.mfa.enroll`) nicht nur anlegen, sondern auch
 * tatsächlich verifizieren können (`auth.mfa.verify`), brauchen wir einen
 * echten, zum Secret passenden Code — ohne externe TOTP-Library, da keine
 * im Projekt installiert ist (kein zusätzlicher Dependency nur für einen
 * Testlauf).
 */
import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = "";
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) throw new Error(`Ungueltiges Base32-Zeichen: ${char}`);
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** Erzeugt den aktuell gültigen 6-stelligen TOTP-Code für ein Base32-Secret. */
export function generateTotp(base32Secret: string, stepSeconds = 30, digits = 6): string {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = (binCode % 10 ** digits).toString().padStart(digits, "0");
  return code;
}
