import { KNOWN_KEYS } from "@rave-run/providers";

/** Which API keys are present in the server env (values are never sent to the browser). */
export function keyStatus(): Record<string, boolean> {
  return Object.fromEntries(KNOWN_KEYS.map((k) => [k.env, !!process.env[k.env]]));
}
