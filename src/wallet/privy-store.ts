import { PRIVY_APP_ID, TEST_SIGNER } from "@/lib/config";
import { WalletRejected, type Signer } from "./signer";

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
  /** Asks Privy to confirm an email address with its own one-time code; resolves with a fresh identity token. */
  confirmEmail(): Promise<string>;
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


/** The signed-in person's Privy identity token, if Privy has one for them. Null for wallet sign-ins. */
export async function currentIdentityToken(): Promise<string | null> {
  if (TEST_SIGNER) return (window as unknown as { __testWallet?: { identityToken?: string } }).__testWallet?.identityToken ?? null;
  try {
    return (await controller?.identityToken()) ?? null;
  } catch {
    return null;
  }
}

/** Whether Privy can confirm an email in this build (it is optional: no app id, no Privy). */
export const privyCanConfirmEmail = TEST_SIGNER || Boolean(PRIVY_APP_ID);

/**
 * For NEAR wallet sign-ins: prove an email address through Privy instead of a code sent by our own server.
 * Privy sends and checks the one-time code; we only receive its signed statement of the result.
 */
export async function confirmEmailWithPrivy(): Promise<string> {
  if (TEST_SIGNER) {
    const email = (window as unknown as { __testWallet?: { privyEmail?: string } }).__testWallet?.privyEmail;
    if (!email) throw new WalletRejected("Email confirmation was closed.");
    return `test-identity:${email}`;
  }
  if (!controller) throw new Error("Email confirmation is still loading. Try again in a moment.");
  return controller.confirmEmail();
}
