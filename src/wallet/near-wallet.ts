import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import type { Challenge, Tx } from "@/api/types";
import { NEAR_NETWORK } from "@/lib/config";
import { ChainFailure, looksLikeRejection, outcomeFailure, WalletRejected, type SignedChallenge, type Signer } from "./signer";
import { fromBase64 } from "./nep413";

let setup: Promise<{ selector: WalletSelector; modal: WalletSelectorModal }> | null = null;

/** Loads wallet-selector on demand (it is heavy). Called on idle after the landing renders so the first click is instant. */
export function loadNearWallets() {
  setup ??= (async () => {
    const [{ setupWalletSelector }, { setupModal }, { setupMeteorWallet }, { setupMyNearWallet }] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/modal-ui"),
      import("@near-wallet-selector/meteor-wallet"),
      import("@near-wallet-selector/my-near-wallet"),
      import("@near-wallet-selector/modal-ui/styles.css"),
    ]);
    const selector = await setupWalletSelector({ network: NEAR_NETWORK, modules: [setupMeteorWallet(), setupMyNearWallet()] });
    const modal = setupModal(selector, { theme: "dark", description: "Pick the NEAR wallet you want to sign in with." });
    return { selector, modal };
  })();
  setup.catch(() => (setup = null));
  return setup;
}

class NearWalletSigner implements Signer {
  readonly kind = "wallet" as const;
  constructor(
    private selector: WalletSelector,
    public accountId: string,
  ) {}

  async signChallenge(ch: Challenge): Promise<SignedChallenge> {
    const wallet = await this.selector.wallet();
    try {
      const signed = await wallet.signMessage({ message: ch.message, recipient: ch.recipient, nonce: Buffer.from(fromBase64(ch.nonce)) });
      if (!signed) throw new WalletRejected("The wallet didn't return a signature. Try again.");
      return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature };
    } catch (e) {
      if (e instanceof WalletRejected) throw e;
      throw looksLikeRejection(e) ? new WalletRejected() : e;
    }
  }

  async signAndSend(tx: Tx) {
    const wallet = await this.selector.wallet();
    const { toActions } = await import("./near-tx");
    try {
      const outcome = await wallet.signAndSendTransaction({ signerId: tx.signerId ?? this.accountId, receiverId: tx.receiverId, actions: toActions(tx) });
      const failure = outcomeFailure(outcome);
      if (failure) throw new ChainFailure(failure);
      return { hash: (outcome as any)?.transaction?.hash ?? (outcome as any)?.transaction_outcome?.id ?? "" };
    } catch (e) {
      if (e instanceof ChainFailure) throw e;
      if (looksLikeRejection(e)) throw new WalletRejected();
      throw new ChainFailure((e as Error)?.message ?? "The wallet couldn't send this transaction.");
    }
  }

  async disconnect() {
    try {
      await (await this.selector.wallet()).signOut();
    } catch {
      /* already signed out */
    }
  }
}

/** Opens the wallet picker and resolves once a wallet is connected. Rejects if the person closes the picker. */
export async function connectNearWallet(): Promise<Signer> {
  const { selector, modal } = await loadNearWallets();
  if (selector.isSignedIn()) {
    const acct = selector.store.getState().accounts.find((a) => a.active) ?? selector.store.getState().accounts[0];
    if (acct) return new NearWalletSigner(selector, acct.accountId);
  }
  return new Promise<Signer>((resolve, reject) => {
    const done = selector.on("signedIn", ({ accounts }) => {
      cleanup();
      resolve(new NearWalletSigner(selector, accounts[0].accountId));
    });
    const closed = modal.on("onHide", ({ hideReason }) => {
      if (hideReason === "user-triggered" && !selector.isSignedIn()) {
        cleanup();
        reject(new WalletRejected("Wallet sign-in was closed."));
      }
    });
    const cleanup = () => {
      done.remove();
      closed.remove();
    };
    modal.show();
  });
}

/** Restores the wallet a returning person already connected, without any prompt. */
export async function restoreNearWallet(accountId?: string): Promise<Signer | null> {
  const { selector } = await loadNearWallets();
  if (!selector.isSignedIn()) return null;
  const accounts = selector.store.getState().accounts;
  const acct = accounts.find((a) => a.accountId === accountId) ?? accounts.find((a) => a.active) ?? accounts[0];
  return acct ? new NearWalletSigner(selector, acct.accountId) : null;
}
