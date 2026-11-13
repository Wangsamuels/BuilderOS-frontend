"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { endpoints } from "@/api/endpoints";
import type { ApprovalCard } from "@/api/types";
import { Async, Button, Chip, Empty, Icon, PageHeader, Panel, Skeleton } from "@/components/ui";
import { useApprovals, useWorkspace } from "@/data/workspace";
import { can } from "@/lib/access";
import { ago, cx, teamOf } from "@/lib/format";
import { usd } from "@/lib/money";
import { pollUntil } from "@/wallet/signing";
import { useWrite, WriteError } from "./write";

const REASON: Record<string, string> = { over_limit: "Over the team's per-purchase limit", new_seller: "First purchase from this seller", unassigned: "Not tied to a task", daily_cap: "The daily cap is reached" };

function describe(c: ApprovalCard) {
  const p = c.payload ?? {};
  if (p.type === "task_review") return { kind: "Task review", icon: "work", title: p.title ?? "A task failed review twice", why: "An agent failed review twice. Approve to accept the work as is, or reject to stop the task." };
  if (c.kind === "daily-cap") return { kind: "Daily cap", icon: "clock", title: "Daily spending cap reached", why: `${p.count ?? c.requestIds.length} purchases are waiting because today's cap is used up. Approving lets them through today.` };
  if (c.kind === "seller") return { kind: "New seller", icon: "shield", title: p.title ?? `${p.seller_id} wants to be paid`, why: "This seller hasn't been paid before. Check the address before approving." };
  return { kind: "Purchase", icon: "money", title: p.title ?? "Purchase", why: REASON[p.reason ?? ""] ?? "Needs your decision" };
}

function Card({ c, focus }: { c: ApprovalCard; focus: boolean }) {
  const w = useWorkspace();
  const { run, error, pending } = useWrite();
  const [always, setAlways] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);
  const d = describe(c);
  const p = c.payload ?? {};
  const decide = (decision: "approve" | "reject") =>
    run(
      {
        title: decision === "approve" ? "Approve" : "Reject",
        summary: (
          <>
            {d.title}
            {c.amount ? <span className="num text-ink"> · {usd(c.amount)}</span> : null}
            {always && decision === "approve" ? <span className="mt-1 block">This seller will be allowed from now on for the {teamOf(p.department_id)} team.</span> : null}
          </>
        ),
        request: (key) => endpoints.decide(c.id, { decision, alwaysAllow: decision === "approve" && always ? true : undefined }, key),
        areas: ["approvals", "analytics", "reports", "teams"],
        done: decision === "approve" ? "Approved" : "Rejected",
        // the card clears once the chain confirms the decision
        confirm: () => pollUntil(async () => !(await endpoints.approvals(w.slug)).cards.some((x) => x.id === c.id), { timeout: 15_000 }),
      },
      decision,
    );
  return (
    <li ref={ref} data-testid="approval-card" className={cx("panel p-5", focus && "border-ember/60 shadow-[0_0_0_1px_#ffb35a55]")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-wash text-amber"><Icon name={d.icon} /></span>
        <div className="min-w-0 flex-1 basis-60">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
            <Chip tone="amber">{d.kind}</Chip>
            {p.department_id ? <span>{teamOf(p.department_id)} team</span> : null}
            <span>{ago(c.createdAt)}</span>
          </div>
          <h2 className="font-sans text-base font-semibold tracking-normal text-pretty">{d.title}</h2>
          <p className="mt-1 text-sm text-ink-2">{d.why}</p>
          {p.seller_id ? <p className="mt-2 text-sm text-ink-2">Seller: <span className="text-ink">{p.seller_id}</span></p> : null}
          {p.pay_to ? <p className="mt-1 text-sm text-ink-2">Pays to: <span className="num break-all text-ink">{p.pay_to}</span></p> : null}
        </div>
        {c.amount ? <div className="num text-2xl font-semibold">{usd(c.amount)}</div> : null}
      </div>
      {error ? <div className="mt-4"><WriteError error={error} feature="Always allow this seller" /></div> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {can.admin(w.access) && p.seller_id && c.kind !== "daily-cap" && p.type !== "task_review" ? (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="size-4 accent-[#ffb35a]" />
            Always allow this seller
          </label>
        ) : <span />}
        <div className="flex gap-2">
          <Button action variant="danger" loading={pending === "reject"} disabled={Boolean(pending)} onClick={() => void decide("reject")}>Reject</Button>
          <Button action variant="primary" loading={pending === "approve"} disabled={Boolean(pending)} onClick={() => void decide("approve")}>Approve</Button>
        </div>
      </div>
    </li>
  );
}

export function ApprovalsPage() {
  const q = useApprovals();
  const focus = useSearchParams().get("card");
  return (
    <>
      <PageHeader title="Approvals" sub="Purchases that went past a limit, came from a new seller, or hit the daily cap. Agents wait until you decide." />
      <Async q={q} skeleton={<div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>} empty={(cards) => !cards.length && <Panel as="div"><Empty icon="check" title="Nothing is waiting on you" body="When an agent needs a decision, it shows up here and in your inbox." /></Panel>}>
        {(cards) => (
          <ul className="space-y-4">
            {cards.map((c) => <Card key={c.id} c={c} focus={focus === c.id} />)}
          </ul>
        )}
      </Async>
    </>
  );
}
