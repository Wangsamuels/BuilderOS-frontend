"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { endpoints } from "@/api/endpoints";
import type { Task } from "@/api/types";
import { STATUS, StatusBar } from "@/components/charts";
import { Async, Button, Chip, Dialog, Dl, Empty, Icon, Input, PageHeader, Panel, PanelHeader, Select, Skeleton, useToast } from "@/components/ui";
import { usePlan, usePlans, useTask, useTasks, useWorkspace } from "@/data/workspace";
import { can } from "@/lib/access";
import { ago, teamOf, titleCase } from "@/lib/format";
import { usd } from "@/lib/money";
import { pollUntil } from "@/wallet/signing";
import { DescribeForm, EstimateStrip, TIERS } from "./drafts";
import { useWrite, WriteError } from "./write";

export const TaskStatus = ({ status }: { status: string }) => {
  const tone = status === "done" ? "green" : status === "review" ? "blue" : status === "failed" ? "red" : status === "paused" ? "amber" : status === "running" ? "ember" : "neutral";
  return <Chip tone={tone} dot>{STATUS[status]?.label ?? titleCase(status)}</Chip>;
};

function TaskTable({ tasks, base }: { tasks: Task[]; base: string }) {
  if (!tasks.length) return <Empty icon="work" title="No tasks yet" body="Tasks are created when a plan is approved." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-[13px] text-ink-3">
          <tr className="border-b border-line">
            <th scope="col" className="px-5 py-2.5 font-medium">Task</th><th scope="col" className="px-3 py-2.5 font-medium">Team</th><th scope="col" className="px-3 py-2.5 font-medium">Status</th><th scope="col" className="px-3 py-2.5 font-medium">Tier</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Estimate / cap</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} data-testid="task-row" className="relative border-b border-line/60 last:border-0 hover:bg-raised/60">
              <td className="px-5 py-3"><Link href={`${base}/work/tasks/${encodeURIComponent(t.id)}`} className="font-medium after:absolute after:inset-0">{t.title}</Link><div className="text-[13px] text-ink-3">{titleCase(t.tag)}</div></td>
              <td className="px-3 py-3 text-ink-2">{teamOf(t.departmentId) || "—"}</td>
              <td className="px-3 py-3"><TaskStatus status={t.status} /></td>
              <td className="px-3 py-3 text-ink-2">{titleCase(t.tier)}</td>
              <td className="num px-5 py-3 text-right">{t.estP50 ? usd(t.estP50) : "—"}<span className="text-ink-3"> / {t.cap ? usd(t.cap) : "—"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkPage() {
  const w = useWorkspace();
  const plans = usePlans();
  const tasks = useTasks(undefined);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const create = useMutation({
    mutationFn: (v: { what: string; who?: string; howTheyPay?: string; private?: boolean }) => endpoints.createPlan({ companyId: w.slug, description: [v.what, v.who && `Who it's for: ${v.who}`, v.howTheyPay && `How they pay: ${v.howTheyPay}`].filter(Boolean).join("\n"), tier: v.private ? "private" : undefined }),
    onSuccess: ({ plan }) => {
      void qc.invalidateQueries({ queryKey: ["c", w.slug, "plans"] });
      setOpen(false);
      router.push(`${w.base}/work/plans/${plan.id}`);
    },
  });
  return (
    <>
      <PageHeader title="Work" sub="Plans are what you asked for. Tasks are the steps agents carry out." actions={<Button action variant="primary" icon="plus" onClick={() => setOpen(true)}>New plan</Button>} />
      <section aria-labelledby="plans-title" className="mb-8">
        <h2 id="plans-title" className="mb-3 text-lg font-semibold">Plans</h2>
        <Async q={plans} skeleton={<Skeleton className="h-28" />} empty={(p) => !p.length && <Panel as="div"><Empty icon="file" title="No plans yet" body="Describe something to build and it becomes a plan here." action={<Button action icon="plus" onClick={() => setOpen(true)}>New plan</Button>} /></Panel>}>
          {(ps) => (
            <ul className="grid gap-4 lg:grid-cols-2">
              {ps.map((p) => (
                <li key={p.id}>
                  <Link href={`${w.base}/work/plans/${p.id}`} data-testid="plan-card" className="panel flex h-full flex-col gap-3 p-5 transition-colors hover:border-line-strong hover:bg-raised">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[17px] font-semibold text-pretty">{p.title}</h3>
                      {p.approvedAt ? <Chip tone="green">Approved</Chip> : <Chip tone="amber">Needs approval</Chip>}
                    </div>
                    <div className="text-[13px] text-ink-3">{p.features.length} steps{p.estimate ? <>, likely <span className="num text-ink-2">{usd(p.estimate.p50)}</span>, cap <span className="num text-ink-2">{usd(p.estimate.cap)}</span></> : null}</div>
                    {p.tasks && Object.keys(p.tasks).length ? <StatusBar counts={p.tasks} /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </section>
      <Panel aria-label="Tasks">
        <PanelHeader title="All tasks" />
        <Async q={tasks}>{(ts) => <TaskTable tasks={ts} base={w.base} />}</Async>
      </Panel>
      <Dialog open={open} onClose={() => setOpen(false)} title="New plan in this company" width={600}>
        <DescribeForm onSubmit={(v) => create.mutate(v)} pending={create.isPending} error={create.error ? (create.error as Error).message : null} />
      </Dialog>
    </>
  );
}

export function PlanPage({ id }: { id: string }) {
  const w = useWorkspace();
  const q = usePlan(id);
  const { run, error, pending } = useWrite();
  return (
    <Async q={q} skeleton={<div className="space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-80" /></div>}>
      {({ plan, tasks }) => (
        <>
          <PageHeader
            back={{ href: `${w.base}/work`, label: "Work" }}
            title={plan.title}
            sub={plan.approvedAt ? `Approved ${ago(plan.approvedAt)}` : "Not approved yet. Agents start once an admin approves it."}
            actions={
              plan.approvedAt ? <Chip tone="green" dot>Approved</Chip> : can.admin(w.access) || w.demo ? (
                <Button action variant="primary" loading={Boolean(pending)} data-testid="approve-plan" onClick={() => void run({ title: "Approve the plan", summary: "Agents start on these tasks once this is confirmed.", request: (key) => endpoints.approvePlan(id, key), areas: ["plan", "plans", "tasks", "teams", "analytics"], done: "Plan approved", confirm: () => pollUntil(async () => (await endpoints.tasks(w.slug, id)).tasks.length > 0, { timeout: 12_000 }) })}>Approve plan</Button>
              ) : <Chip tone="amber">Needs an admin's approval</Chip>
            }
          />
          {error ? <div className="mb-5"><WriteError error={error} feature="Approve plan" /></div> : null}
          <div className="space-y-6">
            {plan.estimate ? <Panel className="p-5" aria-label="Estimate"><EstimateStrip e={plan.estimate} /></Panel> : null}
            <Panel aria-label="Steps">
              <PanelHeader title="Steps" hint={`${plan.features.length} in this plan`} />
              <ul className="divide-y divide-line border-t border-line">
                {plan.features.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 basis-56">{f.title}</span>
                    <Chip>{titleCase(f.tag)}</Chip>
                    <span className="w-20 text-ink-3">{f.team}</span>
                    {f.estimate ? <span className="num w-20 text-right">{usd(f.estimate.p50)}</span> : null}
                  </li>
                ))}
              </ul>
            </Panel>
            {tasks.length ? <Panel aria-label="Tasks"><PanelHeader title="Tasks" /><TaskTable tasks={tasks} base={w.base} /></Panel> : null}
          </div>
        </>
      )}
    </Async>
  );
}

export function TaskPage({ id }: { id: string }) {
  const w = useWorkspace();
  const q = useTask(id);
  const toast = useToast();
  const { run, error, pending } = useWrite();
  const [tier, setTier] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const price = useMutation({ mutationFn: (v: { tier?: string; model?: string }) => endpoints.estimate({ taskId: id, ...v }), onError: (e) => toast((e as Error).message, "red") });
  const admin = can.admin(w.access);
  return (
    <Async q={q} skeleton={<div className="space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-64" /></div>}>
      {(t) => {
        const chosen = tier ?? t.tier;
        const changed = chosen !== t.tier || (model.trim() || null) !== (t.pinnedModel ?? null);
        return (
          <>
            <PageHeader back={{ href: `${w.base}/work`, label: "Work" }} title={t.title} actions={<TaskStatus status={t.status} />} sub={`${titleCase(t.tag)} task for the ${teamOf(t.departmentId) || "company"} team`} />
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
              <Panel className="p-5" aria-label="Details">
                <Dl rows={[["Status", STATUS[t.status]?.label ?? titleCase(t.status)], ["Tier", titleCase(t.tier)], ["Pinned model", t.pinnedModel ?? "None: the tier picks"], ["Likely cost", <span key="p" className="num">{t.estP50 ? usd(t.estP50) : "—"}</span>], ["High estimate", <span key="h" className="num">{t.estP90 ? usd(t.estP90) : "—"}</span>], ["Hard cap", <span key="c" className="num">{t.cap ? usd(t.cap) : "—"}</span>], ...(t.attempts ? ([["Attempts", t.attempts]] as [string, React.ReactNode][]) : []), ...(t.pauseReason ? ([["Paused because", t.pauseReason]] as [string, React.ReactNode][]) : [])]} />
                {t.status === "paused" && can.approve(w.access) ? <Link href={`${w.base}/approvals`} className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber hover:underline">Waiting on you: open Approvals <Icon name="right" size={14} /></Link> : null}
              </Panel>
              <Panel className="p-5" aria-label="Tier and model">
                <h2 className="text-[15px] font-semibold">Tier and model</h2>
                <p className="mt-1 mb-4 text-sm text-ink-2">Price the task on another tier or model before changing it. {admin || w.demo ? "" : "Only an admin can change it."}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label htmlFor="t-tier" className="mb-1.5 block text-[13px] font-medium">Tier</label><Select id="t-tier" value={chosen} onChange={(e) => (setTier(e.target.value), price.reset())}>{TIERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select></div>
                  <div><label htmlFor="t-model" className="mb-1.5 block text-[13px] font-medium">Pin a model <span className="font-normal text-ink-3">(optional)</span></label><Input id="t-model" value={model} onChange={(e) => (setModel(e.target.value), price.reset())} placeholder={t.pinnedModel ?? "e.g. qwen3-coder"} /></div>
                </div>
                {price.data ? (
                  <div className="mt-4 rounded-[12px] border border-line bg-void/50 p-4" data-testid="estimate-result">
                    <div className="mb-2 text-[13px] text-ink-3">With this choice</div>
                    <EstimateStrip e={price.data.estimate} />
                  </div>
                ) : null}
                {error ? <div className="mt-4"><WriteError error={error} feature="Change tier" /></div> : null}
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <Button action loading={price.isPending} onClick={() => price.mutate({ tier: chosen, model: model.trim() || undefined })}>Estimate</Button>
                  {admin || w.demo ? <Button action variant="primary" disabled={!changed} loading={Boolean(pending)} onClick={() => void run({ title: "Change the task", summary: `${t.title}: ${titleCase(chosen)} tier${model.trim() ? `, pinned to ${model.trim()}` : ""}`, request: (key) => endpoints.patchTask(id, { tier: chosen, pinnedModel: model.trim() || null }, key), areas: ["task", "tasks"], done: "Task updated" })}>Save change</Button> : null}
                </div>
              </Panel>
            </div>
          </>
        );
      }}
    </Async>
  );
}
