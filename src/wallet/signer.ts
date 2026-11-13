import type { Challenge, Tx } from "@/api/types";

export type SignedChallenge = { accountId: string; publicKey: string; signature: string };

/**
 * One signer interface, three implementations: the Privy embedded wallet, a NEAR wallet (wallet-selector),
 * and a local test key used only by the end-to-end tests. Screens never know which one is in use.
 */
export interface Signer {
  readonly kind: "privy" | "wallet";
  readonly accountId: string;
  signChallenge(ch: Challenge): Promise<SignedChallenge>;
  /** Signs and broadcasts one transaction; resolves once the chain has executed it. */
  signAndSend(tx: Tx): Promise<{ hash: string }>;
  disconnect(): Promise<void>;
}

/** The person closed or declined the wallet prompt. Nothing changed on chain. */
export class WalletRejected extends Error {
  constructor(message = "You declined the request in your wallet.") {
    super(message);
    this.name = "WalletRejected";
  }
}
/** The transaction reached the chain and failed there. */
export class ChainFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainFailure";
  }
}
export class SignerUnavailable extends Error {
  constructor(message = "Your wallet isn't connected in this browser. Reconnect it to sign.") {
    super(message);
    this.name = "SignerUnavailable";
  }
}

export function looksLikeRejection(e: unknown) {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return /reject|denied|cancel|closed|declin|user abort|couldn't open popup/.test(m);
}

/** Pulls a readable failure out of a NEAR execution outcome, or null when it succeeded. */
export function outcomeFailure(outcome: any): string | null {
  const status = outcome?.status ?? outcome?.final_execution_status;
  const failure = status?.Failure ?? outcome?.transaction_outcome?.outcome?.status?.Failure;
  const receiptFailure = (outcome?.receipts_outcome ?? []).map((r: any) => r?.outcome?.status?.Failure).find(Boolean);
  const f = failure ?? receiptFailure;
  if (!f) return null;
  const text = JSON.stringify(f);
  const panic = /Smart contract panicked: ([^"\\]+)/.exec(text)?.[1];
  if (panic) return panic;
  if (/NotEnoughBalance|LackBalanceForState/.test(text)) return "Your wallet doesn't hold enough NEAR for this transaction.";
  return `The chain rejected this transaction: ${text.slice(0, 200)}`;
}
