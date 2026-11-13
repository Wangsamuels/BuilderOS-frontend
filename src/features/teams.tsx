"use client";

import Link from "next/link";
import type { Outcome, Report, Team } from "@/api/types";
import { BudgetBar, seriesColor, StatusBar } from "@/components/charts";
import { Async, Chip, Dl, Empty, Icon, PageHeader, Panel, PanelHeader, Skeleton } from "@/components/ui";
import { useReport, useReports, useTeams, useWorkspace } from "@/data/workspace";
import { can } from "@/lib/access";
import { ago, cx, dateTime, duration, shortAccount, titleCase } from "@/lib/format";
import { usd } from "@/lib/money";

const OUTCOME: Record<Outcome, { label: string; tone: "green" | "blue" | "amber" | "red" }> = {
  done: { label: "Done", tone: "green" },
  needs_review: { label: "In review", tone: "blue" },
  retrying: { label: "Retrying", tone: "amber" },
  paused: { label: "Waiting on you", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
};
export const OutcomeChip = ({ outcome }: { outcome: Outcome }) => {
  const o = OUTCOME[outcome] ?? { label: titleCase(outcome), tone: "blue" as const };
  return (
    <Chip tone={o.tone} dot>
      {o.label}
    </Chip>
  );
};

export function ReportCard({ r, base, showApprovals }: { r: Report; base: string; showApprovals: boolean }) {
  return (
    <li className="panel relative transition-colors hover:border-line-strong hover:bg-raised" data-testid="report-card">
      <Link href={`${base}/reports/${r.id}`} className="block p-4 after:absolute after:inset-0 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <h3 className="min-w-0 flex-1 font-sans text-[15px] font-semibold tracking-normal text-pretty">{r.title}</h3>
          <OutcomeChip outcome={r.outcome} />
        </div>
        <p className="mt-2.5 text-[13px] text-ink-3">Agent's summary</p>
        <p className="mt-0.5 line-clamp-3 max-w-[78ch] text-sm text-ink-2">{r.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
          {r.cost !== null && r.cost !== undefined ? <span className="num text-ink-2">{usd(r.cost)}</span> : null}
          <span>{ago(r.updatedAt)}</span>
          {r.attempt > 1 ? <span>Attempt {r.attempt}</span> : null}
          <span>{r.tag}</span>
        </div>
      </Link>
      {r.outcome === "paused" && showApprovals ? (
        <Link href={`${base}/approvals`} className="relative z-10 mx-4 mb-4 flex items-center justify-between gap-2 rounded-[10px] border border-amber/30 bg-amber-wash px-3 py-2 text-sm hover:bg-amber/20 sm:mx-5">
          Waiting on you: open Approvals <Icon name="right" size={14} />
        </Link>
      ) : null}
    </li>
  );
}

function TeamCard({ t, base, color, showMoney }: { t: Team; base: string; color: string; showMoney: boolean }) {
  return (
    <li>
      <Link href={`${base}/teams/${t.name}`} data-testid="team-card" className="panel flex h-full flex-col gap-4 p-5 transition-colors hover:border-line-strong hover:bg-raised">
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full" style={{ background: color }} />
          <h2 className="flex-1 text-[17px] font-semibold">{t.name}</h2>
          {t.frozen ? <Chip tone="blue">Paused</Chip> : null}
          <Icon name="right" className="text-ink-3" />
        </div>
        {showMoney ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="num">
                {usd(t.spent)} <span className="text-ink-3">of {usd(t.budget)}</span>
              </span>
              <span className="text-[13px] text-ink-3">
                <span className="num text-ink-2">{usd(t.available)}</span> left
              </span>
            </div>
            <BudgetBar spent={t.spent} reserved={t.reserved} budget={t.budget} color={color} />
            <div className="mt-2 text-[13px] text-ink-3">
              Up to <span className="num">{usd(t.perTxLimit)}</span> per purchase without asking
            </div>
          </div>
        ) : null}
        <StatusBar counts={t.tasks} />
        <div className="mt-auto flex flex-wrap gap-1.5">
          {t.agents.length ? (
            t.agents.map((a) => (
              <Chip key={a.publicKey} dot tone={a.status === "paused" ? "amber" : "neutral"}>
                {a.role} agent
              </Chip>
            ))
          ) : (
            <span className="text-[13px] text-ink-3">No agents registered yet</span>
          )}
        </div>
      </Link>
    </li>
  );
}

export function TeamsPage() {
  const w = useWorkspace();
  const teams = useTeams();
  const reports = useReports(undefined, 7);
  return (
    <>
      <PageHeader title="Teams" sub="Each team has its own budget and agents. Open one to read what its agents did." />
      <Async q={teams} skeleton={<div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-52" /><Skeleton className="h-52" /></div>} empty={(t) => !t.length && <Panel as="div"><Empty icon="teams" title="No teams yet" body="Teams are created when the company launches." /></Panel>}>
        {(ts) => (
          <ul className="grid gap-4 lg:grid-cols-2">
            {ts.map((t) => (
              <TeamCard key={t.departmentId} t={t} base={w.base} color={seriesColor(w.teamNames, t.name)} showMoney={can.money(w.access)} />
            ))}
          </ul>
        )}
      </Async>
      <section aria-labelledby="latest-title" className="mt-10">
        <h2 id="latest-title" className="mb-1 text-lg font-semibold">
          Latest reports
        </h2>
        <p className="mb-4 text-sm text-ink-3">The last 7 days, grouped by team.</p>
        <Async q={reports} empty={(r) => !r.teams.some((t) => t.reports.length) && <Panel as="div"><Empty icon="file" title="No reports yet" body="Agents write a report after every attempt at a task. They appear once a team is funded and has agents." /></Panel>}>
          {(r) => (
            <div className="space-y-8">
              {r.teams
                .filter((t) => t.reports.length)
                .map((t) => (
                  <div key={t.team} data-testid="team-report-group">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-base font-semibold">
                        <span className="size-2 rounded-full" style={{ background: seriesColor(w.teamNames, t.team) }} />
                        {t.team}
                      </h3>
                      <Link href={`${w.base}/teams/${t.team}`} className="text-[13px] text-ink-3 hover:text-ember">
                        {t.summary.headline}
                      </Link>
                    </div>
                    <ul className="grid gap-3 lg:grid-cols-2">
                      {t.reports.slice(0, 2).map((rep) => (
                        <ReportCard key={rep.id} r={rep} base={w.base} showApprovals={can.approve(w.access)} />
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </Async>
      </section>
    </>
  );
}

export function TeamPage({ team }: { team: string }) {
  const w = useWorkspace();
  const teams = useTeams();
  const reports = useReports(team, 30);
  const t = teams.data?.find((x) => x.name === team);
  const color = seriesColor(w.teamNames, team);
  return (
    <>
      <PageHeader
        back={{ href: `${w.base}/teams`, label: "Teams" }}
        title={
          <span className="flex items-center gap-3">
            <span className="size-3 rounded-full" style={{ background: color }} />
            {team}
            {t?.frozen ? <Chip tone="blue">Paused</Chip> : null}
          </span>
        }
        sub={reports.data?.teams[0]?.summary.headline}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <section aria-label="Reports" className="min-w-0">
          <Async q={reports} empty={(r) => !r.teams[0]?.reports.length && <Panel as="div"><Empty icon="file" title="No reports from this team yet" body="A report appears after each attempt an agent makes at a task." /></Panel>}>
            {(r) => {
              const g = r.teams[0];
              return (
                <>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {g.summary.done ? <Chip tone="green">{g.summary.done} done</Chip> : null}
                    {g.summary.needsReview ? <Chip tone="blue">{g.summary.needsReview} in review</Chip> : null}
                    {g.summary.retrying ? <Chip tone="amber">{g.summary.retrying} retrying</Chip> : null}
                    {g.summary.paused ? <Chip tone="amber">{g.summary.paused} waiting on you</Chip> : null}
                    {g.summary.failed ? <Chip tone="red">{g.summary.failed} failed</Chip> : null}
                  </div>
                  <ul className="space-y-3">
                    {g.reports.map((rep) => (
                      <ReportCard key={rep.id} r={rep} base={w.base} showApprovals={can.approve(w.access)} />
                    ))}
                  </ul>
                </>
              );
            }}
          </Async>
        </section>
        <aside className="space-y-4">
          {teams.data === undefined ? (
            <Skeleton className="h-56" />
          ) : t ? (
            <>
              {can.money(w.access) ? (
                <Panel className="p-5" aria-label="Budget">
                  <h2 className="mb-3 text-[15px] font-semibold">Budget</h2>
                  <BudgetBar spent={t.spent} reserved={t.reserved} budget={t.budget} color={color} />
                  <Dl rows={[["Monthly budget", <span key="b" className="num">{usd(t.budget)}</span>], ["Spent", <span key="s" className="num">{usd(t.spent)}</span>], ["Reserved", <span key="r" className="num">{usd(t.reserved)}</span>], ["Available", <span key="a" className="num">{usd(t.available)}</span>], ["Per purchase", <span key="p" className="num">{usd(t.perTxLimit)}</span>]]} />
                </Panel>
              ) : null}
              <Panel className="p-5" aria-label="Tasks">
                <h2 className="mb-3 text-[15px] font-semibold">Tasks</h2>
                <StatusBar counts={t.tasks} />
              </Panel>
              <Panel className="p-5" aria-label="Agents">
                <h2 className="mb-3 text-[15px] font-semibold">Agents</h2>
                {t.agents.length ? (
                  <ul className="space-y-2.5">
                    {t.agents.map((a) => (
                      <li key={a.publicKey} className="flex items-center justify-between gap-2 text-sm">
                        <span>{titleCase(a.role)}</span>
                        <Chip dot tone={a.status === "paused" ? "amber" : a.status === "fired" ? "red" : "green"}>
                          {a.status === "active" ? "running" : a.status}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">No agents registered yet.</p>
                )}
              </Panel>
            </>
          ) : (
            <Panel as="div"><Empty icon="teams" title="Team not found" body="It may have been renamed, or your access doesn't cover it." /></Panel>
          )}
        </aside>
      </div>
    </>
  );
}

export function ReportPage({ id }: { id: string }) {
  const w = useWorkspace();
  const q = useReport(id);
  return (
    <Async q={q} skeleton={<div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>}>
      {({ report: r, attempts }) => {
        const f = r.facts ?? {};
        return (
          <>
            <PageHeader back={{ href: `${w.base}/teams/${r.team}`, label: `${r.team} team` }} title={r.title} actions={<OutcomeChip outcome={r.outcome} />} sub={`${titleCase(r.tag)} task, attempt ${r.attempt}, ${dateTime(r.updatedAt)}`} />
            <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
              <div className="min-w-0 space-y-6">
                {/* What the agent says, kept visibly apart from what was recorded. */}
                <Panel className="border-l-2 border-l-ink-3 p-5" aria-label="Agent's summary" data-testid="agent-summary">
                  <h2 className="text-[15px] font-semibold">Agent's summary</h2>
                  <p className="mb-3 text-[13px] text-ink-3">Written by {shortAccount(r.agent)}. This is the agent's own account of its work.</p>
                  <p className="max-w-[75ch] leading-relaxed text-ink">{r.summary}</p>
                  {f.reason ? <p className="mt-3 text-sm text-amber">Stopped because: {f.reason}</p> : null}
                  {r.outcome === "paused" && can.approve(w.access) ? (
                    <Link href={`${w.base}/approvals`} className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber/30 bg-amber-wash px-3.5 py-2 text-sm hover:bg-amber/20">
                      Waiting on you: open Approvals <Icon name="right" size={14} />
                    </Link>
                  ) : null}
                </Panel>
                <Panel aria-label="Recorded facts" data-testid="recorded-facts">
                  <PanelHeader title="Recorded facts" hint="From the records: model calls, checks, the review and the commit. Not from the agent." />
                  <div className="divide-y divide-line border-t border-line">
                    {f.checks !== undefined ? (
                      <div className="p-5">
                        <h3 className="mb-2 font-sans text-sm font-semibold tracking-normal">Checks</h3>
                        {f.checks ? (
                          <>
                            <Chip tone={f.checks.passed ? "green" : "red"} dot>{f.checks.passed ? "Passed" : "Failed"}</Chip>
                            {f.checks.errors.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red">{f.checks.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
                          </>
                        ) : (
                          <p className="text-sm text-ink-3">Checks didn't run for this attempt.</p>
                        )}
                      </div>
                    ) : null}
                    {f.review !== undefined ? (
                      <div className="p-5">
                        <h3 className="mb-2 font-sans text-sm font-semibold tracking-normal">Review</h3>
                        {f.review ? (
                          <>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <Chip tone={f.review.verdict === "pass" ? "green" : "red"} dot>{titleCase(f.review.verdict)}</Chip>
                              <span className="text-ink-3">reviewed by {f.review.model}</span>
                            </div>
                            {f.review.reasons.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">{f.review.reasons.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
                          </>
                        ) : (
                          <p className="text-sm text-ink-3">Not reviewed yet.</p>
                        )}
                      </div>
                    ) : null}
                    {f.files !== undefined ? (
                      <div className="p-5">
                        <h3 className="mb-2 font-sans text-sm font-semibold tracking-normal">Files changed{f.files.length ? ` (${f.files.length})` : ""}</h3>
                        {f.files.length ? (
                          <ul className="space-y-1 text-sm text-ink-2">
                            {f.files.map((file) => (
                              <li key={file} className="flex items-center gap-2 break-all"><Icon name="file" size={14} className="text-ink-3" />{file}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-ink-3">No files were changed.</p>
                        )}
                        {f.commitSha ? <p className="mt-3 text-[13px] text-ink-3">Commit <span className="num text-ink-2">{f.commitSha}</span></p> : null}
                      </div>
                    ) : null}
                    {f.models?.length ? (
                      <div className="overflow-x-auto p-5">
                        <h3 className="mb-2 font-sans text-sm font-semibold tracking-normal">Models used</h3>
                        <table className="w-full min-w-[420px] text-left text-sm">
                          <thead className="text-[13px] text-ink-3">
                            <tr><th className="py-1.5 font-medium">Model</th><th className="py-1.5 text-right font-medium">Calls</th><th className="py-1.5 text-right font-medium">Tokens in / out</th><th className="py-1.5 text-right font-medium">Cost</th></tr>
                          </thead>
                          <tbody>
                            {f.models.map((m) => (
                              <tr key={m.model} className="border-t border-line/60">
                                <td className="py-2">{m.model}<span className="ml-2 text-[13px] text-ink-3">{m.provider}</span></td>
                                <td className="num py-2 text-right">{m.calls}{m.failed ? <span className="text-red"> ({m.failed} failed)</span> : null}</td>
                                <td className="num py-2 text-right text-ink-2">{m.tokensIn.toLocaleString()} / {m.tokensOut.toLocaleString()}</td>
                                <td className="num py-2 text-right">{usd(m.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {f.receipts?.length ? (
                      <div className="p-5">
                        <h3 className="mb-2 font-sans text-sm font-semibold tracking-normal">Receipts</h3>
                        <ul className="space-y-1.5 text-sm">
                          {f.receipts.map((rc) => (
                            <li key={rc.id} className="flex justify-between gap-3"><span className="text-ink-2">{rc.seller ?? rc.id}</span><span className="num">{usd(rc.amount)}</span></li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </Panel>
              </div>
              <aside className="space-y-4">
                <Panel className="p-5" aria-label="Cost and time">
                  <Dl
                    rows={[
                      ...(r.cost !== null && r.cost !== undefined ? ([["Cost of this attempt", <span key="c" className="num">{usd(r.cost)}</span>]] as [string, React.ReactNode][]) : []),
                      ...(f.estimate ? ([["Estimate (likely / high)", <span key="e" className="num">{usd(f.estimate.p50)} / {usd(f.estimate.p90)}</span>], ["Hard cap", <span key="h" className="num">{usd(f.estimate.cap)}</span>]] as [string, React.ReactNode][]) : []),
                      ...(f.taskCostSoFar ? ([["Task cost so far", <span key="t" className="num">{usd(f.taskCostSoFar)}</span>]] as [string, React.ReactNode][]) : []),
                      ["Duration", duration(f.durationMs)],
                      ...(f.tier ? ([["Tier", titleCase(f.tier)]] as [string, React.ReactNode][]) : []),
                      ...(f.generator ? ([["Written by", f.generator.model]] as [string, React.ReactNode][]) : []),
                    ]}
                  />
                </Panel>
                <Panel className="p-5" aria-label="Attempts">
                  <h2 className="mb-3 text-[15px] font-semibold">Attempts</h2>
                  <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-line-strong">
                    {attempts.map((a) => (
                      <li key={a.id} className="relative pl-6">
                        <span className={cx("absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-surface", a.id === r.id ? "bg-ember" : "bg-ink-3")} />
                        {a.id === r.id ? (
                          <span className="text-sm font-medium">Attempt {a.attempt} (this one)</span>
                        ) : (
                          <Link href={`${w.base}/reports/${a.id}`} className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">Attempt {a.attempt}</Link>
                        )}
                        <div className="mt-1 flex items-center gap-2 text-[13px] text-ink-3"><OutcomeChip outcome={a.outcome} />{ago(a.at)}</div>
                      </li>
                    ))}
                  </ol>
                </Panel>
              </aside>
            </div>
          </>
        );
      }}
    </Async>
  );
}
