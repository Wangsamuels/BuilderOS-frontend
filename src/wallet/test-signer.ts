import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import type { Challenge, Tx } from "@/api/types";
import { API_URL } from "@/lib/config";
import { ChainFailure, WalletRejected, type SignedChallenge, type Signer } from "./signer";
import { fromBase64, fromHex, nep413Hash, toBase64, toHex } from "./nep413";

/**
 * End-to-end tests only (NEXT_PUBLIC_TEST_SIGNER=1). A throwaway in-browser ed25519 key signs real NEP-413
 * challenges and "broadcasts" to the simulated chain in tests/mock-api. Never compiled into a production build.
 */
const KEY = "builderos.test-key";
type Hooks = { rejectNext?: boolean; failNext?: string };
const hooks = (): Hooks => ((window as any).__testWallet ??= {});

export class TestSigner implements Signer {
  readonly accountId: string;
  private secret: Uint8Array;
  private publicKey: string;
  constructor(
    readonly kind: "privy" | "wallet",
    secretHex?: string,
  ) {
    const stored = secretHex ?? window.localStorage.getItem(KEY);
    this.secret = stored ? fromHex(stored) : ed25519.utils.randomSecretKey();
    window.localStorage.setItem(KEY, toHex(this.secret));
    const pub = ed25519.getPublicKey(this.secret);
    this.publicKey = `ed25519:${bs58.encode(pub)}`;
    this.accountId = toHex(pub);
  }
  static exists() {
    return Boolean(window.localStorage.getItem(KEY));
  }
  async signChallenge(ch: Challenge): Promise<SignedChallenge> {
    const hash = nep413Hash({ message: ch.message, nonce: fromBase64(ch.nonce), recipient: ch.recipient });
    return { accountId: this.accountId, publicKey: this.publicKey, signature: toBase64(ed25519.sign(hash, this.secret)) };
  }
  async signAndSend(tx: Tx) {
    const h = hooks();
    if (h.rejectNext) {
      h.rejectNext = false;
      throw new WalletRejected();
    }
    const res = await fetch(`${API_URL}/__sim/tx`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: this.accountId, transaction: tx, fail: h.failNext }) });
    h.failNext = undefined;
    const json = await res.json();
    if (!res.ok) throw new ChainFailure(json.message ?? "Simulated chain failure");
    return { hash: json.hash as string };
  }
  async disconnect() {
    window.localStorage.removeItem(KEY);
  }
}
