import { ed25519 } from "@noble/curves/ed25519.js";
import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

export const API = "http://localhost:4010";
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** A throwaway wallet. The account id is the hex of its public key, like a NEAR implicit account. */
export type Identity = { secret: string; accountId: string };
export function newIdentity(): Identity {
  const secret = randomBytes(32);
  return { secret: hex(secret), accountId: hex(ed25519.getPublicKey(secret)) };
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}
export const seed = {
  reset: () => api("/__test/reset", {}),
  company: (slug: string, founder: string, opts: { name?: string; filled?: boolean; version?: number; frozen?: boolean } = {}) => api("/__test/company", { slug, founder, ...opts }),
  grant: (slug: string, accountId: string, g: { scopes?: string[]; admin?: boolean; team?: string }) => api("/__test/grant", { slug, accountId, ...g }),
  revoke: (slug: string, accountId: string) => api("/__test/revoke", { slug, accountId }),
  balance: (accountId: string, near: number) => api("/__test/balance", { accountId, near }),
  quotes: (o: { down?: boolean; ttlMs?: number }) => api("/__test/quotes", o),
  privyEmailOff: (accountId: string) => api("/__test/privy-email-off", { accountId }),
  email: (accountId: string, email: string) => api("/__test/email", { accountId, email }),
  approval: (slug: string, opts: { title?: string; amount?: number; team?: string; kind?: string } = {}) => api<{ id: string }>("/__test/approval", { slug, ...opts }),
  report: (slug: string, opts: { title?: string; team?: string; outcome?: string } = {}) => api<{ id: string }>("/__test/report", { slug, ...opts }),
  deposit: (slug: string, team: string, amount: number) => api("/__test/deposit", { slug, team, amount }),
  expireSessions: (accountId?: string) => api("/__test/expire-sessions", { accountId }),
  dropStreams: () => api<{ dropped: number }>("/__test/drop-streams", {}),
  streamStatus: (catchingUp: boolean) => api("/__test/stream-status", { catchingUp }),
  state: () => api<any>("/__test/state"),
};

/** Puts the wallet's key in the browser before any page script runs. */
export async function useIdentity(page: Page, id: Identity) {
  await page.addInitScript((secret) => {
    if (!window.sessionStorage.getItem("test.signed-out")) window.localStorage.setItem("builderos.test-key", secret);
  }, id.secret);
}

/** Signs in from the landing with one click and waits for the app to leave it. */
export async function signIn(page: Page, method: "google" | "email" | "wallet" = "google") {
  await page.goto("/");
  await page.getByTestId(`signin-${method}`).first().click();
  await page.waitForURL(/\/(home|c\/)/);
}

/** Waits for the signing sheet to walk through every step and close. */
export async function signed(page: Page) {
  const sheet = page.getByTestId("signing-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toBeHidden({ timeout: 30_000 });
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}
