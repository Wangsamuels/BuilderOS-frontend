"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useSession, type SignInMethod } from "@/auth/session";
import { Mark, Singularity } from "@/components/singularity";
import { Icon, Skeleton, Spinner } from "@/components/ui";
import { cx } from "@/lib/format";
import { TEST_SIGNER } from "@/lib/config";

const G = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path fill="#f3ebdd" d="M15.500 8.200c0-.500 0-1-.100-1.500H8v2.900h4.200a3.600 3.600 0 0 1-1.600 2.400v2h2.500c1.500-1.400 2.400-3.400 2.400-5.800Z" opacity=".9" />
    <path fill="#f3ebdd" d="M8 15.800c2.100 0 3.900-.700 5.200-1.900l-2.500-2c-.700.500-1.600.800-2.700.800a4.700 4.700 0 0 1-4.400-3.200H1v2c1.300 2.600 4 4.300 7 4.300Z" opacity=".7" />
    <path fill="#f3ebdd" d="M3.600 9.500a4.700 4.700 0 0 1 0-3V4.400H1a7.800 7.800 0 0 0 0 7l2.600-1.900Z" opacity=".5" />
    <path fill="#f3ebdd" d="M8 3.300c1.200 0 2.200.400 3 1.200l2.300-2.200A7.800 7.800 0 0 0 1 4.400l2.600 2.100A4.700 4.700 0 0 1 8 3.300Z" opacity=".8" />
  </svg>
);

/** The three ways in. The challenge is already fetched, so the first click goes straight to the wallet. */
export function SignInButtons({ className }: { className?: string }) {
  const { signIn, signingIn, signInError, privyEnabled, privyReady } = useSession();
  // A button is only enabled once it can act: before the page is interactive a click would be lost, and one click must be enough.
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  // warm the wallet picker while the person reads, so the click opens it instantly
  useEffect(() => {
    if (TEST_SIGNER) return;
    const t = setTimeout(() => void import("@/wallet/near-wallet").then((m) => m.loadNearWallets()).catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, []);
  const row = (method: SignInMethod, label: string, icon: ReactNode, primary?: boolean, disabled?: boolean) => (
    <button
      type="button"
      data-testid={`signin-${method}`}
      onClick={() => void signIn(method)}
      disabled={!live || Boolean(signingIn) || disabled}
      className={cx(
        "flex h-12 w-full items-center justify-center gap-2.5 rounded-full text-[15px] font-medium transition-colors disabled:cursor-default disabled:opacity-80",
        primary ? "bg-ember font-semibold text-[#1a1206] hover:bg-[#ffc37d]" : "border border-line-strong bg-raised/80 text-ink hover:bg-hover",
      )}
    >
      {signingIn === method ? <Spinner /> : icon}
      {label}
    </button>
  );
  return (
    <div className={cx("space-y-2.5", className)}>
      {privyEnabled ? (
        <>
          {row("google", "Continue with Google", <G />, true, !privyReady)}
          {row("email", "Continue with email", <Icon name="inbox" />, false, !privyReady)}
          <div className="flex items-center gap-3 py-1 text-xs text-ink-3">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}
      {row("wallet", "Connect NEAR wallet", <Icon name="key" />, !privyEnabled)}
      {signInError ? (
        <p role="alert" className="pt-1 text-center text-[13px] text-red">
          {signInError}
        </p>
      ) : null}
    </div>
  );
}

/** Shown in place of any signed-in page when there is no session. The URL stays, so signing in returns here. */
export function SignInScreen() {
  return (
    <main id="main" className="relative grid min-h-dvh place-items-center overflow-hidden bg-void px-4 py-10">
      <Singularity className="absolute inset-0 size-full opacity-70" mass={0.5} zoom={0.9} offset={[0, 0.16]} quality="low" />
      <div className="absolute inset-0 bg-gradient-to-t from-void via-void/70 to-transparent" />
      <div className="animate-rise relative w-full max-w-[400px] rounded-[20px] border border-line-strong bg-surface/90 p-6 shadow-[0_30px_120px_#000c,inset_0_1px_0_#ffffff12] backdrop-blur-md sm:p-7">
        <Link href="/" className="mb-5 inline-flex items-center gap-2 font-display text-lg font-semibold">
          <Mark /> BuilderOS
        </Link>
        <h1 className="text-[22px] leading-snug font-semibold">Sign in to continue</h1>
        <p className="mt-1.5 mb-5 text-sm text-ink-2">You'll come straight back to this page.</p>
        <SignInButtons />
        <p className="mt-5 text-center text-[13px] text-ink-3">
          Just looking?{" "}
          <Link href="/demo" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ember">
            See a sample company
          </Link>
        </p>
      </div>
    </main>
  );
}

/** Wraps every signed-in route. Never decides access to a company: only whether there is a session at all. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "loading")
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6" role="status" aria-label="Loading">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (status === "signedOut") return <SignInScreen />;
  return <>{children}</>;
}
