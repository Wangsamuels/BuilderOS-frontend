"use client";

import { getIdentityToken, PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { useEffect, useRef, type ReactNode } from "react";
import type { Challenge, Tx } from "@/api/types";
import { PRIVY_APP_ID } from "@/lib/config";
import { fromBase64, fromHex, implicitToPublicKey, nep413Hash, toHex } from "./nep413";
import { privyStore, type PrivyController } from "./privy-store";
import { looksLikeRejection, WalletRejected, type SignedChallenge, type Signer } from "./signer";

/**
 * Privy (Google / email). The embedded wallet is a NEAR implicit account: its address is the hex of its
 * ed25519 key, and it signs raw hashes. This file is only loaded when NEXT_PUBLIC_PRIVY_APP_ID is set.
 */
type RawSign = (hash: Uint8Array) => Promise<Uint8Array>;

class PrivySigner implements Signer {
  readonly kind = "privy" as const;
  constructor(
    readonly accountId: string,
    private sign: RawSign,
    private logoutFn: () => Promise<void>,
  ) {}
  get publicKey() {
    return implicitToPublicKey(this.accountId);
  }
  async signChallenge(ch: Challenge): Promise<SignedChallenge> {
    const sig = await this.sign(nep413Hash({ message: ch.message, nonce: fromBase64(ch.nonce), recipient: ch.recipient }));
    return { accountId: this.accountId, publicKey: this.publicKey, signature: toHex(sig) };
  }
  async signAndSend(tx: Tx) {
    const { sendWithRawSigner } = await import("./near-tx");
    return sendWithRawSigner(tx, this.accountId, this.publicKey, this.sign);
  }
  disconnect() {
    return this.logoutFn();
  }
}

type LinkedNear = { type: string; chainType?: string; address?: string };
const nearAddress = (user: { linkedAccounts?: unknown[] } | null | undefined) => (user?.linkedAccounts as LinkedNear[] | undefined)?.find((a) => a.type === "wallet" && a.chainType === "near")?.address ?? null;

function Bridge() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const pending = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  const { login } = useLogin({
    onComplete: () => pending.current?.resolve(),
    onError: (e) => pending.current?.reject(new WalletRejected(String(e) === "exited_auth_flow" ? "The Privy window was closed." : `Sign-in didn't finish (${String(e)}).`)),
  });
  const latest = useRef({ ready, authenticated, user, login, logout, createWallet, signRawHash });
  latest.current = { ready, authenticated, user, login, logout, createWallet, signRawHash };

  useEffect(() => {
    const signerFor = (address: string) =>
      new PrivySigner(
        address,
        async (hash) => {
          try {
            const { signature } = await latest.current.signRawHash({ address, chainType: "near", hash: `0x${toHex(hash)}` });
            return fromHex(signature);
          } catch (e) {
            throw looksLikeRejection(e) ? new WalletRejected() : e;
          }
        },
        () => latest.current.logout(),
      );
    const ensureWallet = async () => {
      const existing = nearAddress(latest.current.user);
      if (existing) return signerFor(existing);
      const { wallet } = await latest.current.createWallet({ chainType: "near" });
      return signerFor(wallet.address);
    };
    const controller: PrivyController = {
      ready,
      authenticated,
      async signIn(method) {
        if (!latest.current.authenticated) {
          await new Promise<void>((resolve, reject) => {
            pending.current = { resolve, reject };
            latest.current.login({ loginMethods: [method] });
          });
          pending.current = null;
          // the user object lands one render after onComplete
          for (let i = 0; i < 40 && !latest.current.user; i++) await new Promise((r) => setTimeout(r, 50));
        }
        return ensureWallet();
      },
      async restore() {
        if (!latest.current.authenticated) return null;
        return ensureWallet();
      },
      identityToken: () => getIdentityToken(),
      async confirmEmail() {
        const settle = async (want: boolean) => {
          for (let i = 0; i < 60 && latest.current.authenticated !== want; i++) await new Promise((r) => setTimeout(r, 50));
        };
        // Start from a clean slate so the token is issued now, for the address confirmed now.
        if (latest.current.authenticated) {
          await latest.current.logout();
          await settle(false);
        }
        await new Promise<void>((resolve, reject) => {
          pending.current = { resolve, reject };
          latest.current.login({ loginMethods: ["email"] });
        });
        pending.current = null;
        await settle(true);
        let token: string | null = null;
        for (let i = 0; i < 20 && !token; i++) {
          token = await getIdentityToken().catch(() => null);
          if (!token) await new Promise((r) => setTimeout(r, 150));
        }
        // The Privy session existed only to prove the address; the person stays signed in with their NEAR wallet.
        await latest.current.logout().catch(() => undefined);
        if (!token) throw new Error("Privy confirmed the address but returned no identity token. Identity tokens need to be switched on for this app in Privy.");
        return token;
      },
    };
    privyStore.set(controller);
  }, [ready, authenticated]);
  return null;
}

export default function PrivyRoot({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={{ loginMethods: ["google", "email"], appearance: { theme: "dark", accentColor: "#ffb35a" }, embeddedWallets: { ethereum: { createOnLogin: "off" } } }}>
      <Bridge />
      {children}
    </PrivyProvider>
  );
}
