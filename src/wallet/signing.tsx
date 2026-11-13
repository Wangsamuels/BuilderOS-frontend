"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { isApiError, newIdempotencyKey } from "@/api/client";
import { txs } from "@/api/endpoints";
import type { Tx, WithTx } from "@/api/types";
import { useSession } from "@/auth/session";
import { Button, Dialog, Icon, Spinner } from "@/components/ui";
import { Mark } from "@/components/singularity";
import { cx } from "@/lib/format";
import { SignerUnavailable, WalletRejected } from "./signer";

/**
 * The signing pattern, once, for every write:
 *   call the API → sign transactions[] in order → wait for the chain → refresh what changed.
 * The backend never moves money; nothing is "done" until the person's wallet has signed and the chain confirmed.
 */
export class SignCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "SignCancelled";
  }
}
type Request<R> = {
  title: string;
  /** What the person is agreeing to, in a sentence. */
  summary?: ReactNode;
  /** Calls the API. Receives the Idempotency-Key for this click; a retry reuses it. */
  request: (idempotencyKey: string) => Promise<R>;
  /** Names for each transaction, when known ahead (company creation: 1 + number of teams). */
  stepLabel?: (tx: Tx, index: number, total: number) => string;
  /** Runs after the last signature: refetch or poll until the change is visible. */
  confirm?: (result: R, hashes: string[]) => Promise<unknown>;
  doneLabel?: string;
  /** Extra guidance under a chain failure, e.g. where to get NEAR for gas. */
  help?: (message: string) => ReactNode;
};
type Phase = "preparing" | "wallet" | "confirming" | "done" | "rejected" | "failed";
type State = { req: Request<any>; phase: Phase; steps: string[]; index: number; error?: string; reconnect?: boolean };

const Ctx = createContext<<R extends WithTx>(req: Request<R>) => Promise<{ result: R; hashes: string[] }>>(() => Promise.reject(new Error("SigningProvider missing")));
export const useSign = () => useContext(Ctx);

const defaultLabel = (tx: Tx) => {
  const m = tx.actions[0]?.params.methodName ?? "transaction";
  const names: Record<string, string> = {
    create_company: "Create the company",
    create_department: `Create the ${String((tx.actions[0]?.params.args as any)?.name ?? "team")} team`,
    approve: "Approve the purchase",
    reject: "Reject the purchase",
    freeze: "Pause all spending",
    unfreeze: "Resume spending",
    invite: "Record the invite",
    revoke: "Remove the member",
    accept_invite: "Join the company",
    set_caps: "Set the daily cap",
    dept_call: "Update team policy",
    register_view_key: "Register this device",
    rotate_code_key: "Rotate the code key",
    register_agent: "Register the agent",
    fire_agent: "Remove the agent",
  };
  return names[m] ?? m.replace(/_/g, " ");
};

export function SigningProvider({ children }: { children: ReactNode }) {
  const { getSigner } = useSession();
  const [state, setState] = useState<State | null>(null);
  const run = useRef<{ key: string; resolve: (v: any) => void; reject: (e: Error) => void; txs: Tx[]; hashes: string[]; result: any } | null>(null);

  const drive = useCallback(
    async (req: Request<any>, from = 0) => {
      const r = run.current!;
      try {
        if (!r.txs.length || from === 0) {
          setState({ req, phase: "preparing", steps: [], index: 0 });
          r.result = await req.request(r.key);
          r.txs = txs(r.result);
          r.hashes = [];
        }
        const steps = r.txs.map((t, i) => (req.stepLabel ?? defaultLabel)(t, i, r.txs.length));
        if (r.txs.length) {
          const signer = await getSigner();
          for (let i = from; i < r.txs.length; i++) {
            setState({ req, phase: "wallet", steps, index: i });
            const { hash } = await signer.signAndSend(r.txs[i]);
            r.hashes[i] = hash;
          }
          setState({ req, phase: "confirming", steps, index: r.txs.length });
        }
        await req.confirm?.(r.result, r.hashes);
        setState({ req, phase: "done", steps, index: r.txs.length });
        r.resolve({ result: r.result, hashes: r.hashes });
        setTimeout(() => setState((s) => (s?.phase === "done" ? null : s)), r.txs.length ? 1100 : 0);
      } catch (e) {
        // API errors (validation, 402, 403, 409…) belong to the screen that asked, not to the sheet.
        if (isApiError(e)) {
          setState(null);
          r.reject(e);
          return;
        }
        setState((s) => ({
          req,
          steps: s?.steps ?? [],
          index: s?.index ?? 0,
          phase: e instanceof WalletRejected ? "rejected" : "failed",
          error: e instanceof Error ? e.message : "Something went wrong while signing.",
          reconnect: e instanceof SignerUnavailable,
        }));
      }
    },
    [getSigner],
  );

  const sign = useCallback(
    <R extends WithTx>(req: Request<R>) =>
      new Promise<{ result: R; hashes: string[] }>((resolve, reject) => {
        run.current = { key: newIdempotencyKey(), resolve, reject, txs: [], hashes: [], result: null };
        void drive(req);
      }),
    [drive],
  );

  const cancel = () => {
    run.current?.reject(new SignCancelled());
    setState(null);
  };
  const s = state;
  const busy = s?.phase === "preparing" || s?.phase === "wallet" || s?.phase === "confirming";

  return (
    <Ctx.Provider value={sign}>
      {children}
      <Dialog open={Boolean(s)} onClose={cancel} title={s?.req.title ?? ""} dismissable={!busy} width={440}>
        {s ? (
          <div data-testid="signing-sheet" data-phase={s.phase}>
            <div className="flex items-center gap-3">
              <span className={cx("grid size-12 shrink-0 place-items-center rounded-full bg-void", busy && "[&>svg]:animate-[orbit_6s_linear_infinite]")}>
                <Mark size={34} paused={s.phase === "rejected" || s.phase === "failed"} />
              </span>
              <p className="text-sm text-ink-2" aria-live="polite">
                {s.phase === "preparing"
                  ? "Preparing the transaction…"
                  : s.phase === "wallet"
                    ? s.steps.length > 1
                      ? `Step ${s.index + 1} of ${s.steps.length}: approve in your wallet`
                      : "Approve in your wallet"
                    : s.phase === "confirming"
                      ? "Signed. Waiting for the chain to confirm…"
                      : s.phase === "done"
                        ? (s.req.doneLabel ?? "Confirmed on chain")
                        : s.phase === "rejected"
                          ? "You declined in your wallet. Nothing changed."
                          : "The transaction didn't go through."}
              </p>
            </div>
            {s.req.summary ? <div className="mt-4 rounded-[12px] border border-line bg-void/50 p-3.5 text-sm text-ink-2">{s.req.summary}</div> : null}
            {s.steps.length > 1 ? (
              <ol className="mt-4 space-y-2">
                {s.steps.map((label, i) => {
                  const done = i < s.index || s.phase === "done" || s.phase === "confirming";
                  const active = i === s.index && s.phase === "wallet";
                  return (
                    <li key={i} className={cx("flex items-center gap-2.5 text-sm", done ? "text-ink-2" : active ? "text-ink" : "text-ink-3")}>
                      <span className={cx("grid size-5 shrink-0 place-items-center rounded-full border text-[11px]", done ? "border-green/50 bg-green-wash text-green" : active ? "border-ember text-ember" : "border-line-strong")}>
                        {done ? <Icon name="check" size={11} /> : active ? <Spinner size={10} /> : i + 1}
                      </span>
                      {label}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {s.error && (s.phase === "failed" || s.phase === "rejected") ? (
              <p role="alert" className={cx("mt-4 text-sm", s.phase === "failed" ? "text-red" : "text-ink-3")}>
                {s.phase === "failed" ? s.error : "You can try again; the same request is safe to repeat."}
              </p>
            ) : null}
            {s.phase === "failed" && s.error ? s.req.help?.(s.error) : null}
            {s.phase === "rejected" || s.phase === "failed" ? (
              <div className="mt-5 flex justify-end gap-2">
                <Button onClick={cancel}>Cancel</Button>
                <Button variant="primary" onClick={() => void drive(s.req, s.phase === "rejected" ? s.index : 0)}>
                  Try again
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </Ctx.Provider>
  );
}

/** Poll until `check` is true (chain reads lag 2–3 s behind a confirmed transaction). */
export async function pollUntil(check: () => Promise<boolean>, { every = 2000, timeout = 20_000 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, every));
  }
}
