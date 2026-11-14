"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiUrl } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { StreamEvent } from "@/api/types";
import { useSession } from "@/auth/session";
import { slugOf } from "@/lib/format";

/** Which cached areas each event makes stale. The stream is only a hint to refetch; the API stays the source of truth. */
const AREAS: Record<string, string[]> = {
  task_reported: ["reports", "report", "analytics", "teams"],
  task_assigned: ["plans", "plan", "tasks", "task", "teams", "analytics"],
  purchase_yielded: ["approvals", "analytics"],
  purchase_approved: ["approvals", "analytics", "reports"],
  purchase_rejected: ["approvals", "analytics", "reports"],
  payment_signed: ["analytics", "ledger", "teams"],
  receipt: ["analytics", "ledger", "teams"],
  frozen: ["company", "teams", "analytics"],
  unfrozen: ["company", "teams", "analytics"],
  deposit_received: ["deposit", "teams"],
  withdrawal_requested: ["deposit", "ledger"],
  withdrawal_recorded: ["deposit", "ledger", "teams"],
  grant_set: ["members", "company"],
  grant_revoked: ["members", "company"],
  company_created: ["company", "teams"],
  department_created: ["teams", "company"],
  agent_registered: ["teams"],
};
const ACCOUNT_LEVEL: Record<string, string[][]> = {
  task_reported: [["inbox"], ["overview"]],
  purchase_yielded: [["inbox"], ["overview"]],
  purchase_approved: [["inbox"], ["overview"]],
  purchase_rejected: [["inbox"], ["overview"]],
  payment_signed: [["overview"]],
  frozen: [["overview"], ["inbox"]],
  unfrozen: [["overview"]],
  grant_set: [["me"], ["overview"], ["inbox"]],
  grant_revoked: [["me"], ["overview"]],
  company_created: [["me"], ["overview"]],
  department_created: [["me"], ["overview"]],
};

export function applyEvent(qc: QueryClient, ev: Pick<StreamEvent, "event" | "companyId">) {
  const slug = ev.companyId ? slugOf(ev.companyId) : null;
  if (slug) for (const area of AREAS[ev.event] ?? []) void qc.invalidateQueries({ queryKey: ["c", slug, area] });
  for (const key of ACCOUNT_LEVEL[ev.event] ?? []) void qc.invalidateQueries({ queryKey: key });
}

const StreamCtx = createContext<{ syncing: boolean; connected: boolean }>({ syncing: false, connected: false });
export const useStreamStatus = () => useContext(StreamCtx);

/** One Server-Sent Events connection per signed-in tab, resumed from the last event id. */
export function StreamProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const qc = useQueryClient();
  const [state, setState] = useState({ syncing: false, connected: false });

  useEffect(() => {
    if (status !== "signedIn") return;
    let es: EventSource | null = null;
    let lastEventId: string | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;

    const connect = async () => {
      if (closed) return;
      try {
        const { token } = await endpoints.streamToken();
        if (closed) return;
        es = new EventSource(apiUrl("/v1/stream", { token, lastEventId }));
        es.addEventListener("ready", () => {
          backoff = 1000;
          setState((s) => ({ ...s, connected: true }));
        });
        es.addEventListener("status", (e) => {
          const d = JSON.parse((e as MessageEvent).data) as { catchingUp: boolean };
          setState((s) => ({ ...s, syncing: Boolean(d.catchingUp) }));
        });
        es.addEventListener("reauth", () => {
          es?.close();
          void connect();
        });
        const onEvent = (e: Event) => {
          const m = e as MessageEvent;
          if (m.lastEventId) lastEventId = m.lastEventId;
          try {
            applyEvent(qc, { ...(JSON.parse(m.data) as StreamEvent), event: m.type });
          } catch {
            /* ignore malformed frame */
          }
        };
        for (const name of new Set([...Object.keys(AREAS), ...Object.keys(ACCOUNT_LEVEL)])) es.addEventListener(name, onEvent);
        es.onerror = () => {
          es?.close();
          setState((s) => ({ ...s, connected: false }));
          if (!closed) timer = setTimeout(connect, (backoff = Math.min(backoff * 2, 30_000)));
        };
      } catch {
        if (!closed) timer = setTimeout(connect, (backoff = Math.min(backoff * 2, 30_000)));
      }
    };
    void connect();
    const onFocus = () => void qc.invalidateQueries({ queryKey: ["inbox"] });
    window.addEventListener("focus", onFocus);
    return () => {
      closed = true;
      clearTimeout(timer);
      es?.close();
      window.removeEventListener("focus", onFocus);
      setState({ syncing: false, connected: false });
    };
  }, [status, qc]);

  return <StreamCtx.Provider value={state}>{children}</StreamCtx.Provider>;
}
