"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { endpoints } from "@/api/endpoints";
import type { DraftRef, InboxItem, Me, OverviewCompany } from "@/api/types";
import { useSession } from "@/auth/session";
import { StatusBar } from "@/components/charts";
import { AccountShell } from "@/components/shell";
import { Mark, Singularity } from "@/components/singularity";
import { Async, Button, Chip, Empty, Icon, LinkButton, Panel, Skeleton, Stat, useToast } from "@/components/ui";
import { ago, cx, slugOf } from "@/lib/format";
import { ratio, usd } from "@/lib/money";
import { pollUntil, SignCancelled, useSign } from "@/wallet/signing";
import { gasHelp } from "./gas-help";
import { OutcomeChip } from "./teams";

/** Accepting an invite that was sent to the person's verified email (no code needed). */
export function useAcceptInboxInvite() {
  const sign = useSign();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  return async (it: InboxItem) => {
    const id = it.action?.type === "accept_invite" ? (/invites\/([^/]+)\/accept/.exec(it.action.route)?.[1] ?? it.id.replace(/^invite:/, "")) : it.id.replace(/^invite:/, "");
    try {
      const { result } = await sign({
        title: "Join the company",
        summary: it.title,
        request: (key) => endpoints.acceptInboxInvite(id, key),
        confirm: (r) => pollUntil(() => endpoints.company(r.companyId).then(() => true)),
        doneLabel: "You're in",
        help: gasHelp,
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["inbox"] }), qc.invalidateQueries({ queryKey: ["overview"] })]);
      router.push(`/c/${slugOf(result.companyId)}`);
    } catch (e) {
      if (!(e instanceof SignCancelled)) toast(e instanceof Error ? e.message : "Couldn't accept the invite.", "red");
    }
  };
}

export function DraftCards({ drafts }: { drafts: DraftRef[] }) {
  if (!drafts.length) return null;
  return (
    <section aria-labelledby="drafts-title">
      <h2 id="drafts-title" className="mb-3 text-[15px] font-semibold">
        Your drafts
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {drafts.map((d) => (
          <li key={d.id}>
            <Link href={`/drafts/${d.id}`} data-testid="draft-card" className="panel block p-4 transition-colors hover:border-line-strong hover:bg-raised">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-sans text-[15px] font-semibold tracking-normal text-pretty">{d.title}</h3>
                <Icon name="right" className="mt-1 text-ink-3" />
              </div>
              <p className="mt-2 text-[13px] text-ink-3">
                {d.estimate ? (
                  <>
                    Likely <span className="num text-ink-2">{usd(d.estimate.p50)}</span>,{" "}
                  </>
                ) : null}
                edited {ago(d.updatedAt ?? d.createdAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InviteCards() {
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: endpoints.inbox, staleTime: 15_000 });
  const accept = useAcceptInboxInvite();
  const invites = (inbox.data?.items ?? []).filter((i) => i.kind === "invite");
  if (!invites.length) return null;
  return (
    <section aria-label="Invites" className="space-y-3">
      {invites.map((i) => (
        <Panel key={i.id} as="div" className="flex flex-wrap items-center gap-4 border-ember/30 p-4">
          <span className="grid size-10 place-items-center rounded-full bg-ember-wash text-ember">
            <Icon name="members" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{i.title}</div>
            <div className="text-[13px] text-ink-2">{i.body}</div>
          </div>
          <Button variant="primary" onClick={() => void accept(i)} data-testid="accept-invite">
            Accept
          </Button>
        </Panel>
      ))}
    </section>
  );
}

function SetupCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const account = useQuery({ queryKey: ["account"], queryFn: endpoints.account, staleTime: 60_000 });
  const dismiss = useMutation({
    mutationFn: () => endpoints.setPreferences({ dismissed: [...(account.data?.preferences.dismissed ?? []), "setup"] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account"] }),
  });
  if (!me.setup.showBanner || account.data?.preferences.dismissed?.includes("setup") || dismiss.isSuccess) return null;
  const href: Record<string, string> = { email: "/account", describe: "/drafts/new", fund: me.drafts[0] ? `/drafts/${me.drafts[0].id}/launch` : "/drafts/new", launch: me.drafts[0] ? `/drafts/${me.drafts[0].id}` : "/drafts/new", approve: "/home" };
  return (
    <Panel aria-label="Getting set up" data-testid="setup-card" className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Getting set up</h2>
          <p className="text-[13px] text-ink-3">
            {me.setup.completed} of {me.setup.total} done. Nothing here blocks you.
          </p>
        </div>
        <button type="button" onClick={() => dismiss.mutate()} aria-label="Dismiss setup card" className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-raised hover:text-ink">
          <Icon name="x" />
        </button>
      </div>
      <ol className="mt-4 space-y-1">
        {me.setup.steps.map((s) => {
          const next = s.id === me.setup.next;
          const body = (
            <>
              <span className={cx("grid size-5 shrink-0 place-items-center rounded-full border", s.done ? "border-green/50 bg-green-wash text-green" : next ? "border-ember" : "border-line-strong")}>{s.done ? <Icon name="check" size={11} /> : next ? <span className="size-1.5 rounded-full bg-ember" /> : null}</span>
              <span className={cx("flex-1", s.done ? "text-ink-3 line-through decoration-line-strong" : next ? "font-medium text-ink" : "text-ink-2")}>{s.label}</span>
              {next ? <Icon name="right" className="text-ember" /> : null}
            </>
          );
          return (
            <li key={s.id}>
              {next && href[s.id] ? (
                <Link href={href[s.id]} className="flex items-center gap-3 rounded-[10px] bg-raised px-3 py-2.5 text-sm hover:bg-hover">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2 text-sm">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Welcome({ me }: { me: Me }) {
  const progress = me.setup.total ? me.setup.completed / me.setup.total : 0;
  return (
    <div className="space-y-6" data-testid="welcome">
      <section aria-labelledby="welcome-title" className="panel relative isolate overflow-hidden">
        {/* the disk gathers mass as setup progresses: an empty account is a faint ring */}
        <Singularity className="absolute inset-0 -z-10 size-full" mass={0.12 + progress * 0.7} zoom={1.05} offset={[0.42, 0.02]} quality="low" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-surface via-surface/80 to-transparent" />
        <div className="max-w-xl px-5 py-12 sm:px-10 sm:py-16">
          <h1 id="welcome-title" className="text-[32px] leading-[1.08] font-semibold tracking-[-0.025em] text-balance sm:text-[44px]">
            What do you want to build?
          </h1>
          <p className="mt-3 text-ink-2">Describe it in a few sentences. You'll get a plan, a cost estimate and suggested teams before anything is created or paid for.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <LinkButton href="/drafts/new" variant="primary" size="lg" icon="spark">
              Describe your product
            </LinkButton>
            <LinkButton href="/demo" size="lg" icon="play">
              See a demo
            </LinkButton>
          </div>
        </div>
      </section>
      <InviteCards />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-6">
          {me.drafts.length ? <DraftCards drafts={me.drafts} /> : <Panel as="div"><Empty icon="file" title="No drafts yet" body="A draft is a plan for a product. It costs nothing and only you can see it." action={<LinkButton href="/drafts/new" icon="plus">Describe your product</LinkButton>} /></Panel>}
        </div>
        <SetupCard me={me} />
      </div>
    </div>
  );
}

function CompanyCard({ c }: { c: OverviewCompany }) {
  const capPct = c.money ? Math.min(100, ratio(c.money.spentToday, c.money.dailyCap) * 100) : 0;
  return (
    <li>
      <Link href={`/c/${c.slug}`} data-testid="company-card" className="panel flex h-full flex-col gap-4 p-5 transition-colors hover:border-line-strong hover:bg-raised">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-void">
            <Mark size={28} paused={c.frozen} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[17px] font-semibold">{c.name}</h3>
            <div className="text-[13px] text-ink-3">
              {c.teams.length} {c.teams.length === 1 ? "team" : "teams"}
            </div>
          </div>
          {c.frozen ? <Chip tone="blue">Paused</Chip> : null}
          <Chip tone={c.role === "founder" ? "ember" : "neutral"}>{c.role}</Chip>
        </div>
        {c.money ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="text-ink-3">Spent today</span>
              <span className="num">
                {usd(c.money.spentToday)} <span className="text-ink-3">of {usd(c.money.dailyCap)}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className={cx("h-full rounded-full", capPct >= 90 ? "bg-red" : "bg-ember")} style={{ width: `${Math.max(capPct, 1)}%` }} />
            </div>
            <div className="mt-2 text-[13px] text-ink-3">
              <span className="num text-ink-2">{usd(c.money.available)}</span> available of <span className="num">{usd(c.money.budget)}</span> budget
            </div>
          </div>
        ) : null}
        {c.work ? (
          <div className="space-y-3">
            <StatusBar counts={c.work.tasks} />
            {c.work.lastReport ? (
              <div className="rounded-[10px] bg-void/50 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{c.work.lastReport.title}</span>
                  <OutcomeChip outcome={c.work.lastReport.outcome} />
                </div>
                <p className="line-clamp-2 text-[13px] text-ink-3">{c.work.lastReport.summary}</p>
              </div>
            ) : null}
            <div className="text-[13px] text-ink-3">{c.work.reportsThisWeek} reports this week</div>
          </div>
        ) : null}
        {c.approvals?.pending ? (
          <div className="mt-auto flex items-center justify-between gap-2 rounded-[10px] border border-amber/30 bg-amber-wash px-3 py-2 text-sm">
            <span>
              <span className="num font-semibold">{c.approvals.pending}</span> waiting on you
            </span>
            {c.approvals.oldestAt ? <span className="text-[13px] text-ink-2">oldest {ago(c.approvals.oldestAt)}</span> : null}
          </div>
        ) : null}
        {!c.money && !c.work && !c.approvals ? <p className="text-sm text-ink-3">Open to see what your access covers.</p> : null}
      </Link>
    </li>
  );
}

function Overview({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ["overview"], queryFn: () => endpoints.overview(), staleTime: 8_000 });
  const open = me.companies.find((c) => c.companyId === me.home.openCompanyId);
  return (
    <div className="space-y-8" data-testid="overview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold sm:text-[32px]">Your companies</h1>
          {open ? (
            <Link href={`/c/${open.slug}`} className="mt-1 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ember">
              Continue in {open.name} <Icon name="right" size={14} />
            </Link>
          ) : null}
        </div>
        <LinkButton href="/drafts/new" variant="primary" icon="plus">
          Describe a new product
        </LinkButton>
      </div>
      <InviteCards />
      <Async q={q} skeleton={<div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>}>
        {(o) => (
          <>
            <Panel as="div" aria-label="Totals" className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4">
              <Stat label="Spent today" value={usd(o.totals.spentToday)} />
              <Stat label="Waiting on you" value={o.totals.pendingApprovals} tone={o.totals.pendingApprovals ? "amber" : undefined} sub={o.totals.pendingApprovals ? "approvals" : "nothing pending"} />
              <Stat label="Tasks running" value={o.totals.tasksRunning} sub={`${o.totals.tasksDone} done`} />
              <Stat label="Needs attention" value={o.totals.needsAttention} tone={o.totals.needsAttention ? "red" : undefined} />
            </Panel>
            <ul className="grid gap-4 lg:grid-cols-2">
              {o.companies.map((c) => (
                <CompanyCard key={c.companyId} c={c} />
              ))}
            </ul>
            <DraftCards drafts={o.drafts.length ? o.drafts : me.drafts} />
          </>
        )}
      </Async>
    </div>
  );
}

export function Home() {
  const { me } = useSession();
  return (
    <AccountShell width="max-w-6xl">
      <Async q={me} skeleton={<div className="space-y-4"><Skeleton className="h-72" /><Skeleton className="h-40" /></div>}>
        {(m) => (m.home.view === "welcome" ? <Welcome me={m} /> : <Overview me={m} />)}
      </Async>
    </AccountShell>
  );
}
