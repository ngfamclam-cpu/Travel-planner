// Single-user auth (spec §4): one long password + signed session cookie. No sign-up.
export const SESSION_COOKIE = "rr_session";
const PAYLOAD = "rave-run-session-v1";

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function authConfigured(): boolean {
  return !!process.env.APP_PASSWORD && !!process.env.SESSION_SECRET;
}

/** In development without APP_PASSWORD the app is open; in production it refuses everyone until set. */
export function authDisabled(): boolean {
  return !authConfigured() && process.env.NODE_ENV !== "production";
}

export async function sessionToken(): Promise<string> {
  return hmac(process.env.SESSION_SECRET!, PAYLOAD);
}

export async function validSession(token: string | undefined): Promise<boolean> {
  if (authDisabled()) return true;
  if (!authConfigured() || !token) return false;
  return timingSafeEqual(token, await sessionToken());
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
