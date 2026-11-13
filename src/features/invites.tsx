"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { Mark, Singularity } from "@/components/singularity";
import { Button, Dl, ErrorState, LinkButton, Notice, Skeleton } from "@/components/ui";
import { IS_TESTNET, TESTNET_FAUCET_URL } from "@/lib/config";
import { dateTime, titleCase } from "@/lib/format";
import { ChainFailure, SignerUnavailable } from "@/wallet/signer";
import { pollUntil, SignCancelled, useSign } from "@/wallet/signing";
import { gasHelp } from "./gas-help";

/** /invite?code=… — the link in an invite email. Signed-out visitors sign in first and land back here. */
export function InvitePage({ code }: { code: string }) {
  const q = useQuery({ queryKey: ["invite", code], queryFn: () => endpoints.inviteInfo(code), enabled: Boolean(code), retry: false });
  const sign = useSign();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; gas: boolean } | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const { result } = await sign({
        title: "Join the company",
        summary: q.data ? `You join ${q.data.companyName} as ${q.data.role}.` : undefined,
        request: (key) => endpoints.acceptInvite(code, key),
        // the grant is live once the company answers 200 for this account
        confirm: (r) => pollUntil(() => endpoints.company(r.companyId).then(() => true, () => false)),
        doneLabel: "You're in",
        help: gasHelp,
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["overview"] }), qc.invalidateQueries({ queryKey: ["inbox"] })]);
      router.push(`/c/${q.data?.slug ?? result.companyId.split(".")[0]}`);
    } catch (e) {
      if (e instanceof SignCancelled) return;
      const text = e instanceof Error ? e.message : "Couldn't accept the invite.";
      // a brand-new wallet has no NEAR, so it can't pay the small network fee for joining
      const gas = e instanceof ChainFailure || e instanceof SignerUnavailable || /balance|gas|fund|not enough|doesn't exist|does not exist/i.test(text);
      setError({ text, gas });
    } finally {
      setBusy(false);
    }
  };

  const inv = q.data;
  const expired = inv && (inv.status === "expired" || new Date(inv.expiresAt).getTime() < Date.now());
  return (
    <main id="main" className="relative grid min-h-dvh place-items-center overflow-hidden bg-void px-4 py-10">
      <Singularity className="absolute inset-0 size-full opacity-60" mass={0.45} zoom={0.85} offset={[0, 0.2]} quality="low" />
      <div className="absolute inset-0 bg-gradient-to-t from-void via-void/75 to-transparent" />
      <div className="relative w-full max-w-[440px] rounded-[20px] border border-line-strong bg-surface/90 p-6 shadow-[0_30px_120px_#000c,inset_0_1px_0_#ffffff12] backdrop-blur-md sm:p-7" data-testid="invite-card">
        <div className="mb-5 flex items-center gap-2 font-display text-lg font-semibold"><Mark /> BuilderOS</div>
        {!code ? (
          <>
            <h1 className="text-[22px] font-semibold">This invite link is incomplete</h1>
            <p className="mt-2 text-ink-2">Open the link from the invite email again, or ask the founder to send a new one.</p>
            <LinkButton href="/home" className="mt-5">Go to your home</LinkButton>
          </>
        ) : q.error ? (
          isApiError(q.error) && (q.error.status === 404 || q.error.status === 410) ? (
            <>
              <h1 className="text-[22px] font-semibold">This invite isn't valid anymore</h1>
              <p className="mt-2 text-ink-2">It may have expired or been withdrawn. Ask the founder to send a new one.</p>
              <LinkButton href="/home" className="mt-5">Go to your home</LinkButton>
            </>
          ) : (
            <ErrorState error={q.error} retry={() => q.refetch()} />
          )
        ) : !inv ? (
          <div className="space-y-3"><Skeleton className="h-7 w-3/4" /><Skeleton className="h-24" /><Skeleton className="h-11" /></div>
        ) : (
          <>
            <h1 className="text-[22px] leading-snug font-semibold text-balance">You're invited to {inv.companyName}</h1>
            <div className="mt-3">
              <Dl
                rows={[
                  ["Role", titleCase(inv.role)],
                  ["Team", inv.departments.length ? inv.departments.map(titleCase).join(", ") : "All teams"],
                  ["Expires", dateTime(inv.expiresAt)],
                ]}
              />
            </div>
            {inv.status === "accepted" ? (
              <>
                <Notice tone="green" icon="check">You've already joined this company.</Notice>
                <LinkButton href={`/c/${inv.slug}`} variant="primary" size="lg" className="mt-4 w-full">Open {inv.companyName}</LinkButton>
              </>
            ) : expired || !inv.canAccept ? (
              <div className="mt-3"><Notice tone="amber">{expired ? "This invite has expired. Ask the founder to send a new one." : "This invite can't be accepted from this account. Sign in with the account the invite was meant for."}</Notice></div>
            ) : (
              <>
                <Button variant="primary" size="lg" className="mt-4 w-full" loading={busy} onClick={() => void accept()} data-testid="accept-invite">Accept invite</Button>
                <p className="mt-3 text-center text-[13px] text-ink-3">Your wallet signs one transaction to record your access on chain.</p>
              </>
            )}
            {error ? (
              <div className="mt-4 space-y-3" data-testid="invite-error">
                <Notice tone="red">{error.text}</Notice>
                {error.gas ? (
                  <p className="text-[13px] text-ink-2">
                    Joining needs a tiny network fee, and a brand-new wallet holds no NEAR yet. About 0.1 NEAR is plenty.{" "}
                    {IS_TESTNET ? (
                      <a href={TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className="text-ember underline underline-offset-4">Get free testnet NEAR</a>
                    ) : null}
                    {IS_TESTNET ? ", then accept again." : "Add some, then accept again."}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
