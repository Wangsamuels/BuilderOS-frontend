"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ApiError, session } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { Challenge, Me } from "@/api/types";
import { TEST_SIGNER } from "@/lib/config";
import { privyStore as privy } from "@/wallet/privy-store";
import { SignerUnavailable, WalletRejected, type Signer } from "@/wallet/signer";

export type SignInMethod = "google" | "email" | "wallet";
type Ctx = {
  status: "loading" | "signedOut" | "signedIn";
  me: UseQueryResult<Me>;
  signIn: (method: SignInMethod) => Promise<void>;
  signingIn: SignInMethod | null;
  signInError: string | null;
  signOut: () => Promise<void>;
  /** The connected wallet for signing transactions; restores it silently for a returning person. */
  getSigner: () => Promise<Signer>;
  privyEnabled: boolean;
  privyReady: boolean;
};
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("SessionProvider missing");
  return c;
};

const PENDING = "builderos.privy-pending";

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [signingIn, setSigningIn] = useState<SignInMethod | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const signer = useRef<Signer | null>(null);
  const privyState = useSyncExternalStore(privy.subscribe, privy.snapshot, () => "00");
  const privyReady = TEST_SIGNER || privyState[0] === "1";

  useEffect(() => {
    setToken(session.get());
    // Any 401 clears the session; the gate then shows sign-in on the same URL and returns there afterwards.
    session.onUnauthenticated(() => {
      setToken(null);
      qc.clear();
    });
    // another tab signed in or out
    const onStorage = (e: StorageEvent) => {
      if (e.key === "builderos.session") {
        setToken(session.get());
        if (!e.newValue) qc.clear();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [qc]);

  const status: Ctx["status"] = token === undefined ? "loading" : token ? "signedIn" : "signedOut";
  const me = useQuery({ queryKey: ["me"], queryFn: endpoints.me, enabled: status === "signedIn", staleTime: 20_000 });

  // The challenge needs no account, so it is fetched as soon as a sign-in button can be seen: one click is enough.
  const challenge = useQuery({ queryKey: ["challenge"], queryFn: endpoints.challenge, enabled: status === "signedOut", staleTime: 3 * 60_000, refetchInterval: 3 * 60_000, retry: 1 });
  const freshChallenge = useCallback(async (): Promise<Challenge> => {
    const c = challenge.data;
    if (c && new Date(c.expiresAt).getTime() - Date.now() > 20_000) return c;
    return qc.fetchQuery({ queryKey: ["challenge"], queryFn: endpoints.challenge, staleTime: 0 });
  }, [challenge.data, qc]);

  const finish = useCallback(
    async (s: Signer) => {
      const attempt = async (retry: boolean): Promise<void> => {
        const ch = await freshChallenge();
        const signed = await s.signChallenge(ch);
        const privyIdentityToken = s.kind === "privy" && !TEST_SIGNER ? ((await privy.get()?.identityToken()) ?? undefined) : undefined;
        try {
          const res = await endpoints.verify({ ...signed, message: ch.message, nonce: ch.nonce, loginMethod: s.kind, privyIdentityToken });
          session.set(res.token, res.expiresAt);
          signer.current = s;
          qc.removeQueries({ queryKey: ["challenge"] });
          setToken(res.token);
        } catch (e) {
          // a challenge works once and lasts 5 minutes: get a new one silently instead of asking for another click
          qc.removeQueries({ queryKey: ["challenge"] });
          if (retry && e instanceof ApiError && e.status === 401 && e.code !== "bad_privy_token") return attempt(false);
          throw e;
        }
      };
      await attempt(true);
    },
    [freshChallenge, qc],
  );

  const signIn = useCallback(
    async (method: SignInMethod) => {
      setSignInError(null);
      setSigningIn(method);
      try {
        let s: Signer;
        if (TEST_SIGNER) {
          const { TestSigner } = await import("@/wallet/test-signer");
          s = new TestSigner(method === "wallet" ? "wallet" : "privy");
        } else if (method === "wallet") {
          const { connectNearWallet } = await import("@/wallet/near-wallet");
          s = await connectNearWallet();
        } else {
          const c = privy.get();
          if (!c?.ready) throw new Error("Google and email sign-in are still loading. Try again in a moment.");
          window.sessionStorage.setItem(PENDING, method);
          s = await c.signIn(method);
        }
        await finish(s);
        if (pathname === "/") router.push("/home");
      } catch (e) {
        if (!(e instanceof WalletRejected)) setSignInError(e instanceof Error ? e.message : "Sign-in didn't finish. Try again.");
      } finally {
        window.sessionStorage.removeItem(PENDING);
        setSigningIn(null);
      }
    },
    [finish, pathname, router],
  );

  // Google sign-in can leave the page and come back; finish it without another click.
  useEffect(() => {
    if (TEST_SIGNER || status !== "signedOut" || privyState !== "11" || signingIn) return;
    const method = window.sessionStorage.getItem(PENDING) as SignInMethod | null;
    if (!method) return;
    window.sessionStorage.removeItem(PENDING);
    setSigningIn(method);
    privy
      .get()!
      .restore()
      .then((s) => (s ? finish(s) : undefined))
      .then(() => pathname === "/" && router.push("/home"))
      .catch((e) => setSignInError(e instanceof Error ? e.message : "Sign-in didn't finish."))
      .finally(() => setSigningIn(null));
  }, [status, privyState, signingIn, finish, pathname, router]);

  const getSigner = useCallback(async (): Promise<Signer> => {
    const account = me.data?.accountId;
    if (signer.current && (!account || signer.current.accountId === account || signer.current.kind === "wallet")) return signer.current;
    let s: Signer | null = null;
    const kind = me.data?.loginMethod;
    if (TEST_SIGNER) {
      const { TestSigner } = await import("@/wallet/test-signer");
      s = TestSigner.exists() ? new TestSigner(kind === "wallet" ? "wallet" : "privy") : null;
    } else if (kind === "privy") {
      s = (await privy.get()?.restore()) ?? null;
    } else {
      const { restoreNearWallet } = await import("@/wallet/near-wallet");
      s = await restoreNearWallet(account);
    }
    if (!s) throw new SignerUnavailable();
    signer.current = s;
    return s;
  }, [me.data]);

  const signOut = useCallback(async () => {
    await endpoints.logout().catch(() => {});
    await (signer.current ?? (await getSigner().catch(() => null)))?.disconnect().catch(() => {});
    signer.current = null;
    session.clear();
    setToken(null);
    qc.clear();
    router.push("/");
  }, [getSigner, qc, router]);

  const value = useMemo<Ctx>(
    () => ({ status, me, signIn, signingIn, signInError, signOut, getSigner, privyEnabled: TEST_SIGNER || privy.enabled, privyReady }),
    [status, me, signIn, signingIn, signInError, signOut, getSigner, privyReady],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
