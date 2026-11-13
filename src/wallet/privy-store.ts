import { PRIVY_APP_ID } from "@/lib/config";
import type { Signer } from "./signer";

/**
 * The seam between the app and the Privy SDK. The SDK is heavy and optional, so it lives in privy.tsx and is
 * only downloaded when NEXT_PUBLIC_PRIVY_APP_ID is set; everything else talks to this small store.
 */
export type PrivyController = {
  ready: boolean;
  authenticated: boolean;
  /** Opens Privy for the chosen method and resolves with a signer for the person's NEAR wallet. */
  signIn(method: "google" | "email"): Promise<Signer>;
  /** A signer for a person Privy already knows in this browser, or null. */
  restore(): Promise<Signer | null>;
  identityToken(): Promise<string | null>;
};

let controller: PrivyController | null = null;
const listeners = new Set<() => void>();
export const privyStore = {
  enabled: Boolean(PRIVY_APP_ID),
  get: () => controller,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  set(c: PrivyController) {
    controller = c;
    listeners.forEach((fn) => fn());
  },
  snapshot: () => `${controller?.ready ? 1 : 0}${controller?.authenticated ? 1 : 0}`,
};

