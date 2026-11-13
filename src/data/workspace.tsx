"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { endpoints } from "@/api/endpoints";
import type * as T from "@/api/types";
import { NO_ACCESS } from "@/lib/access";
import { teamOf } from "@/lib/format";

/**
 * One data source for the company workspace. The real one calls the API per endpoint; the demo one reads the
 * single /v1/demo payload, whose shapes match. Pages use these hooks and never know which is behind them.
 */
export type Workspace = { slug: string; base: string; demo: boolean; range: string; company: T.CompanyResponse | undefined; access: T.Access; teamNames: string[] };
const Ctx = createContext<Workspace | null>(null);
export const WorkspaceProvider = Ctx.Provider;
export const useWorkspace = () => {
  const w = useContext(Ctx);
  if (!w) throw new Error("Not inside a company workspace");
  return w;
};

const DEMO_STALE = 5 * 60_000;
export const useDemoBundle = (range: string, enabled = true) => useQuery({ queryKey: ["demo", range], queryFn: () => endpoints.demo(range), staleTime: DEMO_STALE, enabled });

/** Builds a hook that reads from the API in a real company and from the demo payload in the demo. */
function source<Args extends unknown[], R>(area: string, real: (slug: string, ...a: Args) => Promise<R>, demo: (b: T.DemoBundle, ...a: Args) => R, opts: { staleTime?: number } = {}) {
  return (...args: Args): UseQueryResult<R> => {
    const w = useWorkspace();
    const d = useQuery({ queryKey: ["demo", w.range], queryFn: () => endpoints.demo(w.range), staleTime: DEMO_STALE, enabled: w.demo, select: (b) => demo(b, ...args) });
    const r = useQuery({ queryKey: ["c", w.slug, area, ...args], queryFn: () => real(w.slug, ...args), enabled: !w.demo, staleTime: opts.staleTime });
    return (w.demo ? d : r) as UseQueryResult<R>;
  };
}

export const demoCompany = (b: T.DemoBundle): T.CompanyResponse => ({ company: b.company, companyId: b.companyId, slug: b.slug, chain: b.chain, access: b.access, departments: b.teams.map((t) => ({ name: t.name, departmentId: t.departmentId })) });

export const useAnalytics = source<[range: string, team: string | undefined], T.Analytics>(
  "analytics",
  (slug, range, team) => endpoints.analytics(slug, range, team),
  (b) => b.analytics,
);
export const useTeams = source<[], T.Team[]>("teams", (slug) => endpoints.teams(slug).then((r) => r.teams), (b) => b.teams);
export const useReports = source<[team: string | undefined, days: number], T.ReportsResponse>(
  "reports",
  (slug, team, days) => endpoints.reports(slug, { team, days }),
  (b, team) => ({ ...b.reports, teams: team ? b.reports.teams.filter((t) => t.team === team) : b.reports.teams }),
);
export const useReport = source<[id: string], T.ReportDetail>(
  "report",
  (_slug, id) => endpoints.report(id),
  (b, id) => {
    const report = b.reports.teams.flatMap((t) => t.reports).find((r) => r.id === id);
    if (!report) throw new Error("This report isn't part of the sample company.");
    return { report, attempts: [{ id: report.id, attempt: report.attempt, outcome: report.outcome, at: report.updatedAt }] };
  },
);
const counts = (tasks: T.Task[]) => tasks.reduce<T.TaskCounts>((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {});
export const usePlans = source<[], T.Plan[]>("plans", (slug) => endpoints.plans(slug).then((r) => r.plans), (b) => [{ ...b.plan, tasks: counts(b.tasks) }]);
export const usePlan = source<[id: string], { plan: T.Plan; tasks: T.Task[] }>("plan", (_s, id) => endpoints.plan(id), (b) => ({ plan: b.plan, tasks: b.tasks }));
export const useTasks = source<[planId: string | undefined], T.Task[]>("tasks", (slug, planId) => endpoints.tasks(slug, planId).then((r) => r.tasks), (b) => b.tasks);
export const useTask = source<[id: string], T.Task>(
  "task",
  (_s, id) => endpoints.task(id).then((r) => r.task),
  (b, id) => {
    const t = b.tasks.find((x) => x.id === id);
    if (!t) throw new Error("This task isn't part of the sample company.");
    return t;
  },
);
export const useApprovals = source<[], T.ApprovalCard[]>("approvals", (slug) => endpoints.approvals(slug).then((r) => r.cards), (b) => b.approvals);
export const useMembers = source<[], { members: T.Member[]; canManage: boolean }>("members", (slug) => endpoints.members(slug), (b) => ({ members: b.members, canManage: false }));
export const useDeposit = source<[], T.Deposit>(
  "deposit",
  (slug) => endpoints.deposit(slug),
  (b) => ({ supported: false, address: null, balance: "0", message: "The sample company has no real funding addresses.", teams: b.teams.map((t) => ({ team: t.name, departmentId: t.departmentId, address: null, chainId: t.chainId, token: "USDC", balance: "0" })) }),
);
export const useLedger = source<[], T.Receipt[]>("ledger", (slug) => endpoints.ledger(slug).then((r) => r.receipts), () => []);

export const useCompany = (slug: string, demo: boolean, range: string) => {
  const d = useQuery({ queryKey: ["demo", range], queryFn: () => endpoints.demo(range), staleTime: DEMO_STALE, enabled: demo, select: demoCompany });
  const r = useQuery({ queryKey: ["c", slug, "company"], queryFn: () => endpoints.company(slug), enabled: !demo });
  return demo ? d : r;
};
export const accessFrom = (c: T.CompanyResponse | undefined) => c?.access ?? NO_ACCESS;
export const teamLabel = (departmentId: string | null | undefined) => teamOf(departmentId) || "company";
