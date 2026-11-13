"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type ReactNode } from "react";
import { isApiError } from "@/api/client";
import type { Tx, WithTx } from "@/api/types";
import { Notice, NotAvailable, useToast } from "@/components/ui";
import { useWorkspace } from "@/data/workspace";
import { SignCancelled, useSign } from "@/wallet/signing";

type WriteOpts<R> = {
  title: string;
  summary?: ReactNode;
  request: (key: string) => Promise<R>;
  /** Cache areas of this company to refresh once the chain confirms. */
  areas: string[];
  done: string;
  /** Wait until the change is readable (chain reads lag 2–3 s). Defaults to a short pause before refetching. */
  confirm?: (result: R, hashes: string[]) => Promise<unknown>;
  stepLabel?: (tx: Tx, i: number, total: number) => string;
};

/** Every write in the workspace: signing sheet → sign in order → confirm → refresh → say what happened. */
export function useWrite() {
  const sign = useSign();
  const qc = useQueryClient();
  const toast = useToast();
  const w = useWorkspace();
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(
    async <R extends WithTx>(opts: WriteOpts<R>, id = opts.title): Promise<{ result: R; hashes: string[] } | null> => {
      setError(null);
      setPending(id);
      const refresh = () => {
        for (const a of opts.areas) void qc.invalidateQueries({ queryKey: ["c", w.slug, a] });
        void qc.invalidateQueries({ queryKey: ["overview"] });
        void qc.invalidateQueries({ queryKey: ["inbox"] });
      };
      try {
        const out = await sign({ title: opts.title, summary: opts.summary, request: opts.request, stepLabel: opts.stepLabel, confirm: opts.confirm ?? (() => new Promise((r) => setTimeout(r, 1800))), doneLabel: opts.done });
        refresh();
        setTimeout(refresh, 3000); // finality lag: read once more after the chain has settled
        toast(opts.done, "green");
        return out;
      } catch (e) {
        if (e instanceof SignCancelled) return null;
        if (isApiError(e) && e.status === 403) {
          // access changed since the page loaded: say so, then re-read what the server allows now
          toast("Your access doesn't cover this. Ask the founder.", "red");
          void qc.invalidateQueries({ queryKey: ["me"] });
          void qc.invalidateQueries({ queryKey: ["c", w.slug, "company"] });
        } else if (isApiError(e, "contract_upgrade_required") || isApiError(e, "not_implemented") || isApiError(e, "budget_decrease_unsupported")) {
          setError(e);
        } else toast(e instanceof Error ? e.message : "That didn't work. Try again.", "red");
        if (!(isApiError(e) && e.status === 403)) setError(e);
        return null;
      } finally {
        setPending(null);
      }
    },
    [sign, qc, toast, w.slug],
  );
  return { run, error, pending, clearError: () => setError(null) };
}

/** Inline explanation for the failures that need more than a toast. */
export function WriteError({ error, feature }: { error: unknown; feature: string }) {
  if (!error) return null;
  if (isApiError(error, "not_implemented")) return <NotAvailable error={error} title={feature} />;
  if (isApiError(error, "contract_upgrade_required"))
    return (
      <Notice tone="amber">
        <strong className="font-semibold">This company needs a contract upgrade for this feature.</strong>
        <span className="mt-1 block text-ink-2">{String(error.details.how ?? error.message)}</span>
      </Notice>
    );
  return <Notice tone="red">{error instanceof Error ? error.message : "That didn't work."}</Notice>;
}
