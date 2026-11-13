"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { endpoints } from "@/api/endpoints";
import type { Inbox, InboxItem } from "@/api/types";
import { AccountShell } from "@/components/shell";
import { Async, Button, Chip, Empty, Icon, PageHeader, Panel, Segmented, SkeletonRows } from "@/components/ui";
import { ago, cx } from "@/lib/format";
import { useAcceptInboxInvite } from "./home";

const KIND: Record<InboxItem["kind"], { icon: string; label: string; cta: string }> = {
  approval: { icon: "approvals", label: "Approval", cta: "Review" },
  report: { icon: "file", label: "Report", cta: "Read report" },
  invite: { icon: "members", label: "Invite", cta: "Accept" },
  alert: { icon: "alert", label: "Alert", cta: "Open" },
};

/** Alert links come from the backend as absolute or short paths; keep navigation inside the app when possible. */
function internalPath(url: string): string | null {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin || /builderos/i.test(u.hostname) ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}

export function InboxPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["inbox"], queryFn: endpoints.inbox });
  const accept = useAcceptInboxInvite();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busy, setBusy] = useState<string | null>(null);

  const mark = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => endpoints.markRead(body),
    // optimistic: the badge and the row update at once, then the server confirms
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ["inbox"] });
      const prev = qc.getQueryData<Inbox>(["inbox"]);
      if (prev) {
        const items = prev.items.map((i) => (body.all || body.ids?.includes(i.id) ? { ...i, read: true } : i));
        qc.setQueryData<Inbox>(["inbox"], { items, unread: items.filter((i) => !i.read).length });
      }
      return { prev };
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(["inbox"], ctx.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["inbox"] }),
  });

  const open = async (it: InboxItem) => {
    if (!it.read) mark.mutate({ ids: [it.id] });
    const a = it.action;
    if (!a) return;
    if (a.type === "approve" && it.slug) router.push(`/c/${it.slug}/approvals?card=${encodeURIComponent(a.cardId)}`);
    else if (a.type === "report" && it.slug) router.push(`/c/${it.slug}/reports/${a.reportId}`);
    else if (a.type === "accept_invite") {
      setBusy(it.id);
      await accept(it);
      setBusy(null);
    } else if (a.type === "open") {
      const path = internalPath(a.url);
      if (path) router.push(path);
      else window.open(a.url, "_blank", "noopener,noreferrer");
    }
  };

  // urgent first (approvals, blocked purchases, paused), then newest
  const sorted = useMemo(() => [...(q.data?.items ?? [])].sort((a, b) => Number(b.urgent) - Number(a.urgent) || new Date(b.at).getTime() - new Date(a.at).getTime()), [q.data]);
  const shown = filter === "unread" ? sorted.filter((i) => !i.read) : sorted;
  const unread = q.data?.unread ?? 0;

  return (
    <AccountShell width="max-w-3xl">
      <PageHeader
        title="Inbox"
        sub="Approvals, agent reports, invites and alerts from all your companies."
        actions={
          <>
            <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "unread", label: unread ? `Unread (${unread})` : "Unread" }]} />
            <Button size="sm" icon="check" disabled={!unread} onClick={() => mark.mutate({ all: true })} data-testid="mark-all-read">Mark all read</Button>
          </>
        }
      />
      <Panel aria-label="Inbox items">
        <Async
          q={q}
          skeleton={<div className="p-5"><SkeletonRows rows={5} /></div>}
          empty={(d) => !d.items.length && <Empty icon="inbox" title="Your inbox is empty" body="When an agent needs a decision or finishes work, you'll see it here." />}
        >
          {() =>
            shown.length ? (
              <ul className="divide-y divide-line">
                {shown.map((it) => {
                  const k = KIND[it.kind];
                  return (
                    <li key={it.id} data-testid="inbox-item" data-read={it.read} data-urgent={it.urgent} className={cx("relative flex flex-wrap items-start gap-x-3.5 gap-y-2 px-4 py-4 sm:px-5", it.urgent && !it.read && "bg-amber-wash/40")}>
                      {it.urgent ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-amber" /> : null}
                      <span className={cx("grid size-9 shrink-0 place-items-center rounded-full", it.urgent ? "bg-amber-wash text-amber" : "bg-raised text-ink-2")}><Icon name={k.icon} /></span>
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
                          {it.urgent ? <Chip tone="amber">Needs you</Chip> : null}
                          <span>{k.label}</span>
                          {it.slug ? <span>in {it.slug}</span> : null}
                          <span>{ago(it.at)}</span>
                        </div>
                        <h2 className={cx("font-sans text-[15px] tracking-normal text-pretty", it.read ? "font-medium text-ink-2" : "font-semibold text-ink")}>
                          {!it.read ? <span className="mr-2 inline-block size-2 rounded-full bg-ember align-middle" aria-label="Unread" /> : null}
                          {it.title}
                        </h2>
                        {it.body ? <p className="mt-1 line-clamp-2 text-sm text-ink-2">{it.body}</p> : null}
                      </div>
                      {it.action ? (
                        <Button size="sm" variant={it.urgent || it.kind === "invite" ? "primary" : "secondary"} loading={busy === it.id} onClick={() => void open(it)} data-testid={`inbox-action-${it.kind}`}>
                          {k.cta}
                        </Button>
                      ) : !it.read ? (
                        <Button size="sm" variant="ghost" onClick={() => mark.mutate({ ids: [it.id] })}>Mark read</Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty icon="check" title="You're all caught up" body="Nothing unread." />
            )
          }
        </Async>
      </Panel>
    </AccountShell>
  );
}
