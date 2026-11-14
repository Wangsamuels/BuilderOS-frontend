"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BudgetBar, CountByDay, RankBars, seriesColor, SpendByDay, StatusBar } from "@/components/charts";
import { HorizonGauge } from "@/components/singularity";
import { Async, Chip, Empty, Icon, NoAccess, PageHeader, Panel, PanelHeader, Segmented, Select, Skeleton, Stat } from "@/components/ui";
import { useAnalytics, useWorkspace } from "@/data/workspace";
import { ago } from "@/lib/format";
import { ratio, usd } from "@/lib/money";
import { MoneyActions } from "./money";

const RANGES = ["7d", "14d", "30d", "90d"] as const;
export type Range = (typeof RANGES)[number];
export const parseRange = (v: string | null): Range => (RANGES.includes(v as Range) ? (v as Range) : "30d");

export function DashboardPage() {
  const w = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const range = parseRange(params.get("range"));
  // a team-limited member only ever sees their team: no filter, and nothing to ask the server for
  const limited = Boolean(w.access.departmentId);
  const team = limited ? undefined : (params.get("team") ?? undefined);
  const q = useAnalytics(range, team);
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title={w.company?.company.name ?? "Dashboard"}
        sub={team ? `Showing the ${team} team` : undefined}
        actions={
          <>
            {!limited && w.teamNames.length > 1 ? (
              <Select aria-label="Team" value={team ?? ""} onChange={(e) => set("team", e.target.value || null)} className="!h-9 !w-auto min-w-32 !rounded-full text-[13px]">
                <option value="">All teams</option>
                {w.teamNames.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            ) : null}
            <Segmented label="Range" value={range} onChange={(v) => set("range", v === "30d" ? null : v)} options={RANGES.map((r) => ({ value: r, label: r }))} />
            <MoneyActions />
          </>
        }
      />
      <Async q={q} skeleton={<div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-80" /><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div></div>}>
        {(a) => {
          const names = a.teams.map((t) => t.name);
          const palette = w.teamNames.length ? w.teamNames : names;
          if (!a.money && !a.work && !a.control) return <Panel as="div"><NoAccess what="this company's analytics" /></Panel>;
          return (
            <div className="space-y-6">
              {a.control ? (
                <Panel aria-label="Control" data-testid="section-control" className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 lg:grid-cols-4">
                  <Link href={`${w.base}/approvals`} className="group min-w-0">
                    <Stat label="Waiting on you" value={a.control.approvals.pending} tone={a.control.approvals.pending ? "amber" : undefined} sub={a.control.approvals.oldestPendingAt ? `oldest ${ago(a.control.approvals.oldestPendingAt)}` : "nothing pending"} />
                  </Link>
                  <Stat label="Decided in range" value={a.control.approvals.decidedInRange} />
                  <div>
                    <Stat label="Blocked purchases" value={a.control.blockedPurchases} tone={a.control.blockedPurchases ? "red" : undefined} />
                    {a.control.blockedPurchases ? <p className="mt-1 flex items-start gap-1.5 text-[13px] text-red"><Icon name="shield" size={14} className="mt-0.5" />A seller asked to be paid at an address that isn't allowed.</p> : null}
                  </div>
                  <div>
                    <div className="text-[13px] text-ink-3">Paused teams</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {a.control.companyFrozen ? <Chip tone="blue">Everything paused</Chip> : a.control.pausedTeams.length ? a.control.pausedTeams.map((t) => <Chip key={t} tone="blue">{t}</Chip>) : <span className="num text-2xl font-semibold">0</span>}
                    </div>
                  </div>
                </Panel>
              ) : null}

              {a.money ? (
                <div data-testid="section-money" className="space-y-6">
                  <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
                    <Panel aria-label="Spend over time" className="min-w-0">
                      <PanelHeader title="Spend over time" hint={<><span className="num text-ink">{usd(a.money.total)}</span> in the last {a.range.days} days</>} />
                      <div className="px-5 pb-5"><SpendByDay days={a.money.byDay} teams={palette} /></div>
                    </Panel>
                    <Panel aria-label="Daily cap" className="flex flex-col items-center justify-center gap-4 p-5 text-center">
                      <HorizonGauge pct={a.money.dailyCap.usedPct} label={usd(a.money.dailyCap.spentToday)} sub={`of ${usd(a.money.dailyCap.cap)} today`} />
                      <div>
                        <h2 className="text-[15px] font-semibold">Daily cap</h2>
                        <p className="mt-0.5 max-w-[30ch] text-[13px] text-ink-3">{a.money.dailyCap.usedPct >= 100 ? "The cap is reached. New purchases wait for approval." : "Across all teams. Once reached, purchases wait for approval."}</p>
                      </div>
                    </Panel>
                  </div>
                  <Panel aria-label="Team budgets">
                    <PanelHeader title="Team budgets" hint="Spent, reserved for purchases in flight, and what is left." />
                    <ul className="divide-y divide-line border-t border-line">
                      {a.money.byTeam.map((t) => (
                        <li key={t.team} className="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-[140px_1fr_auto] sm:items-center">
                          <Link href={`${w.base}/teams/${t.team}`} className="flex items-center gap-2 font-medium hover:text-ember"><span className="size-2.5 rounded-full" style={{ background: seriesColor(palette, t.team) }} />{t.team}</Link>
                          <div>
                            <BudgetBar spent={t.spent} reserved={t.reserved} budget={t.budget} color={seriesColor(palette, t.team)} />
                            <div className="mt-1.5 text-[13px] text-ink-3"><span className="num text-ink-2">{usd(t.spent)}</span> spent, <span className="num">{usd(t.reserved)}</span> reserved, <span className="num text-ink-2">{usd(t.available)}</span> available of <span className="num">{usd(t.budget)}</span></div>
                          </div>
                          <div className="text-sm sm:text-right">
                            {t.runwayDays === null ? <span className="text-ink-3">No spend yet</span> : <><span className={`num font-semibold ${t.runwayDays < 7 ? "text-red" : t.runwayDays < 21 ? "text-amber" : "text-ink"}`}>{t.runwayDays} days</span><span className="text-ink-3"> of runway</span></>}
                            <div className="text-[13px] text-ink-3"><span className="num">{usd(t.burnPerDay)}</span> per day</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <Panel aria-label="Spend by model"><PanelHeader title="Spend by model" /><div className="px-5 pb-5"><RankBars rows={a.money.byModel.map((m) => ({ label: m.model, amount: m.amount, note: `${m.purchases} purchases` }))} /></div></Panel>
                    <Panel aria-label="Spend by seller"><PanelHeader title="Spend by seller" /><div className="px-5 pb-5"><RankBars color="var(--color-s7)" rows={a.money.bySeller.map((m) => ({ label: m.seller, amount: m.amount, note: `${m.purchases} purchases` }))} /></div></Panel>
                  </div>
                </div>
              ) : null}

              {a.work ? (
                <div data-testid="section-work" className="grid gap-6 lg:grid-cols-2">
                  <Panel aria-label="Tasks by team">
                    <PanelHeader title="Tasks by team" />
                    <ul className="space-y-4 px-5 pb-5">
                      {a.work.tasksByTeam.map((t) => (
                        <li key={t.team}><div className="mb-1.5 text-sm font-medium">{t.team}</div><StatusBar counts={t as Record<string, number | string>} /></li>
                      ))}
                      {!a.work.tasksByTeam.length ? <li className="text-sm text-ink-3">No tasks yet. Approve a plan to start.</li> : null}
                    </ul>
                  </Panel>
                  <Panel aria-label="Finished per day" className="min-w-0">
                    <PanelHeader title="Tasks finished per day" />
                    <div className="px-5 pb-5"><CountByDay days={a.work.completedByDay} noun="Finished" /></div>
                  </Panel>
                  <Panel aria-label="Quality and cost" className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 lg:col-span-2 lg:grid-cols-4">
                    <Stat label="Review pass rate" value={a.work.reviewPassRate === null ? "—" : `${Math.round(a.work.reviewPassRate * 100)}%`} sub={`${a.work.reviewed} reviewed`} />
                    {a.work.costPerDoneTask !== undefined ? <Stat label="Cost per finished task" value={usd(a.work.costPerDoneTask)} /> : null}
                    {a.work.estimateVsActual ? (
                      <>
                        <Stat label="Estimated" value={usd(a.work.estimateVsActual.estimated)} sub={`${a.work.estimateVsActual.tasks} finished tasks`} />
                        <Stat label="Actual" value={usd(a.work.estimateVsActual.actual)} sub={`${Math.round(ratio(a.work.estimateVsActual.actual, a.work.estimateVsActual.estimated) * 100)}% of the estimate`} />
                      </>
                    ) : null}
                  </Panel>
                </div>
              ) : null}
              {!a.money && a.work === null && a.control ? null : null}
              {a.money && !a.money.byDay.some((d) => d.total !== "0") && !a.work?.tasksByTeam.length ? <Panel as="div"><Empty title="Nothing has been spent yet" body="Once the plan is approved and a team is funded, spend and work show up here." /></Panel> : null}
            </div>
          );
        }}
      </Async>
    </>
  );
}
