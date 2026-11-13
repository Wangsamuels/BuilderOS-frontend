"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isApiError, newIdempotencyKey } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { Draft, Feature } from "@/api/types";
import { useSession } from "@/auth/session";
import { AccountShell } from "@/components/shell";
import { Mark } from "@/components/singularity";
import { Async, Button, Chip, Dialog, Empty, Field, Icon, Input, LinkButton, Notice, PageHeader, Panel, Select, Skeleton, Textarea, Toggle, useToast } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { usd } from "@/lib/money";

const SIZE: Record<string, string> = { xs: "Tiny", s: "Small", m: "Medium", l: "Large", xl: "Very large" };
export const TIERS = [
  { value: "economy", label: "Economy", hint: "Cheapest models" },
  { value: "standard", label: "Standard", hint: "Balanced" },
  { value: "premium", label: "Premium", hint: "Strongest models" },
  { value: "private", label: "Private", hint: "Code stays in secure hardware" },
];

/* ---------- /drafts/new ---------- */
const PLANNING = ["Reading your description", "Breaking it into steps", "Assigning steps to teams", "Estimating the cost"];
export function DescribeForm({ onSubmit, pending, error, submitLabel = "Plan it" }: { onSubmit: (v: { what: string; who?: string; howTheyPay?: string; private?: boolean }) => void; pending: boolean; error?: string | null; submitLabel?: string }) {
  const [what, setWhat] = useState("");
  const [who, setWho] = useState("");
  const [pay, setPay] = useState("");
  const [priv, setPriv] = useState(false);
  const [touched, setTouched] = useState(false);
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!pending) return setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, PLANNING.length - 1)), 900);
    return () => clearInterval(t);
  }, [pending]);
  const invalid = what.trim().length < 10;
  if (pending)
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center py-14 text-center" data-testid="planning">
        <span className="grid size-16 place-items-center rounded-full bg-void [&>svg]:animate-[orbit_5s_linear_infinite]">
          <Mark size={46} />
        </span>
        <p className="mt-5 text-lg font-semibold">Planning your product</p>
        <p className="mt-1 text-sm text-ink-2">{PLANNING[stage]}…</p>
      </div>
    );
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!invalid) onSubmit({ what: what.trim(), who: who.trim() || undefined, howTheyPay: pay.trim() || undefined, private: priv || undefined });
      }}
    >
      <Field label="What does it do?" error={touched && invalid ? "Describe the product in at least a sentence." : null} hint="The more specific you are, the better the plan.">
        {(p) => <Textarea {...p} name="what" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="A notes app for small teams with sharing, version history and offline drafts." autoFocus rows={5} maxLength={4000} />}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Who is it for?" optional>
          {(p) => <Input {...p} name="who" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Teams of 5 to 50 people" />}
        </Field>
        <Field label="How do they pay?" optional>
          {(p) => <Input {...p} name="pay" value={pay} onChange={(e) => setPay(e.target.value)} placeholder="Monthly plan per team" />}
        </Field>
      </div>
      <Toggle checked={priv} onChange={setPriv} label="Keep my code private" hint="Agents only use models that run in secure hardware. This costs more." />
      {error ? <Notice tone="red">{error}</Notice> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="lg" icon="spark">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function NewDraft() {
  const router = useRouter();
  const qc = useQueryClient();
  const key = useRef(newIdempotencyKey());
  const m = useMutation({
    mutationFn: (v: Parameters<typeof endpoints.createDraft>[0]) => endpoints.createDraft(v, key.current),
    onSuccess: ({ draft }) => {
      qc.setQueryData(["draft", draft.id], { draft });
      void qc.invalidateQueries({ queryKey: ["me"] });
      router.push(`/drafts/${draft.id}`);
    },
    onError: () => (key.current = newIdempotencyKey()),
  });
  return (
    <AccountShell width="max-w-2xl">
      <PageHeader back={{ href: "/home", label: "Home" }} title="Describe your product" sub="You'll get a plan, a cost estimate and suggested teams. Nothing is created or paid for yet." />
      <Panel className="p-5 sm:p-7">
        <DescribeForm onSubmit={(v) => m.mutate(v)} pending={m.isPending || m.isSuccess} error={m.error ? (m.error as Error).message : null} />
      </Panel>
    </AccountShell>
  );
}

/* ---------- /drafts/[id] ---------- */
function FeatureRow({ f, onRename, onRemove, busy }: { f: Feature; onRename: (title: string) => void; onRemove: () => void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(f.title);
  const save = () => {
    setEditing(false);
    if (title.trim() && title.trim() !== f.title) onRename(title.trim());
    else setTitle(f.title);
  };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5" data-testid="feature-row">
      <div className="min-w-0 flex-1 basis-64">
        {editing ? (
          <Input aria-label="Step title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save} onKeyDown={(e) => (e.key === "Enter" ? save() : e.key === "Escape" ? (setTitle(f.title), setEditing(false)) : null)} className="!h-9" />
        ) : (
          <button type="button" onClick={() => setEditing(true)} title="Edit this step" className="rounded text-left text-[15px] text-ink decoration-line-strong underline-offset-4 hover:underline">
            {f.title}
          </button>
        )}
      </div>
      <Chip>{titleCase(f.tag)}</Chip>
      <span className="w-16 text-[13px] text-ink-3">{SIZE[f.size] ?? f.size}</span>
      <span className="num w-20 text-right text-sm">{f.estimate ? usd(f.estimate.p50) : "—"}</span>
      <button type="button" disabled={busy} onClick={onRemove} aria-label={`Remove "${f.title}"`} className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-red-wash hover:text-red disabled:opacity-40">
        <Icon name="trash" />
      </button>
    </li>
  );
}

export function EstimateStrip({ e }: { e: Draft["estimate"] }) {
  return (
    <dl className="grid grid-cols-3 divide-x divide-line">
      {[
        ["Likely", e.p50, "Half of plans like this cost less"],
        ["High", e.p90, "9 in 10 cost less"],
        ["Hard cap", e.cap, "Agents can't spend past this"],
      ].map(([label, v, hint], i) => (
        <div key={label} className="px-4 first:pl-0 last:pr-0">
          <dt className="text-[13px] text-ink-3">{label}</dt>
          <dd className={`num mt-0.5 text-xl font-semibold sm:text-2xl ${i === 2 ? "text-ember" : ""}`}>{usd(v)}</dd>
          <dd className="mt-0.5 hidden text-xs text-ink-3 sm:block">{hint}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DraftReview({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSession();
  const q = useQuery({ queryKey: ["draft", id], queryFn: () => endpoints.draft(id) });
  const [editDesc, setEditDesc] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addTo, setAddTo] = useState(false);
  const patch = useMutation({
    mutationFn: (body: Parameters<typeof endpoints.patchDraft>[1]) => endpoints.patchDraft(id, body),
    onSuccess: (r) => {
      qc.setQueryData(["draft", id], r);
      void qc.invalidateQueries({ queryKey: ["me"] });
      setEditDesc(null);
      setRenaming(null);
    },
    onError: (e) => {
      if (isApiError(e, "draft_already_launched")) void q.refetch();
      toast((e as Error).message, "red");
    },
  });
  const del = useMutation({
    mutationFn: () => endpoints.deleteDraft(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.push("/home");
    },
  });
  const launchInto = useMutation({
    mutationFn: (companyId: string) => endpoints.launchInto(id, companyId),
    onSuccess: (r, companyId) => {
      const slug = me.data?.companies.find((c) => c.companyId === companyId)?.slug;
      void qc.invalidateQueries({ queryKey: ["me"] });
      router.push(`/c/${slug}/work/plans/${r.plan.id}`);
    },
    onError: (e) => toast((e as Error).message, "red"),
  });
  const mine = (me.data?.companies ?? []).filter((c) => c.isFounder || c.admin);

  return (
    <AccountShell width="max-w-4xl">
      <Async q={q} skeleton={<div className="space-y-4"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-96" /></div>}>
        {({ draft: d }) => {
          if (d.status === "launched" && d.companyId)
            return <Panel as="div"><Empty icon="check" title="This draft is now a company" body="Its plan lives in the company's Work area." action={<LinkButton variant="primary" href={`/c/${d.companyId.split(".")[0]}`}>Open the company</LinkButton>} /></Panel>;
          const teams = [...new Set(d.features.map((f) => f.team))];
          return (
            <div data-testid="draft-review">
              <PageHeader
                back={{ href: "/home", label: "Home" }}
                title={
                  renaming !== null ? (
                    <Input aria-label="Draft title" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={() => (renaming.trim() && renaming !== d.title ? patch.mutate({ title: renaming.trim() }) : setRenaming(null))} onKeyDown={(e) => (e.key === "Enter" ? (e.target as HTMLInputElement).blur() : e.key === "Escape" ? setRenaming(null) : null)} className="!h-11 font-display !text-2xl" />
                  ) : (
                    <button type="button" onClick={() => setRenaming(d.title)} title="Rename" className="rounded text-left decoration-line-strong underline-offset-8 hover:underline">
                      {d.title}
                    </button>
                  )
                }
                actions={
                  <>
                    <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)}>Delete</Button>
                    {mine.length ? <Button onClick={() => setAddTo(true)}>Add to an existing company</Button> : null}
                    <LinkButton href={`/drafts/${id}/launch`} variant="primary" icon="spark" data-testid="launch">{d.status === "launching" ? "Resume launch" : "Launch"}</LinkButton>
                  </>
                }
              />
              {d.status === "launching" ? (
                <div className="mb-5"><Notice tone="amber" icon="clock">Creating your company… The launch was started but not finished. <a className="font-medium underline underline-offset-4" href={`/drafts/${id}/launch`}>Resume the launch</a></Notice></div>
              ) : null}
              <div className="space-y-6">
                <Panel className="p-5" aria-label="Estimate"><EstimateStrip e={d.estimate} /></Panel>
                <Panel aria-label="Description" className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-semibold">What you described</h2>
                      <p className="mt-1.5 max-w-[75ch] whitespace-pre-line text-ink-2">{d.description}</p>
                    </div>
                    <Button size="sm" onClick={() => setEditDesc(d.description)}>Edit</Button>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                    <label htmlFor="tier" className="text-sm text-ink-2">Model tier</label>
                    <Select id="tier" value={d.tier} disabled={patch.isPending} onChange={(e) => patch.mutate({ tier: e.target.value })} className="!h-9 !w-auto text-sm">
                      {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}: {t.hint}</option>)}
                    </Select>
                  </div>
                </Panel>
                <section aria-labelledby="plan-title">
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 id="plan-title" className="text-lg font-semibold">The plan</h2>
                    <span className="text-[13px] text-ink-3">{d.features.length} steps across {teams.length} teams. Click a step to edit it.</span>
                  </div>
                  <div className="space-y-4" aria-busy={patch.isPending}>
                    {teams.map((team) => {
                      const s = d.suggestedSetup.teams.find((t) => t.team === team);
                      return (
                        <Panel key={team} aria-label={`${team} team`}>
                          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-2 sm:px-5">
                            <h3 className="text-base font-semibold">{team}</h3>
                            {s ? <span className="text-[13px] text-ink-3">Suggested budget <span className="num text-ink-2">{usd(s.monthlyCap)}</span> a month, up to <span className="num text-ink-2">{usd(s.perTxLimit)}</span> per purchase</span> : null}
                          </div>
                          <ul className="divide-y divide-line border-t border-line">
                            {d.features.filter((f) => f.team === team).map((f) => (
                              <FeatureRow key={f.key} f={f} busy={patch.isPending} onRemove={() => patch.mutate({ removeKeys: [f.key] })} onRename={(title) => patch.mutate({ features: d.features.map((x) => (x.key === f.key ? { ...x, title } : x)) })} />
                            ))}
                          </ul>
                        </Panel>
                      );
                    })}
                    {!d.features.length ? <Panel as="div"><Empty title="The plan is empty" body="Edit the description to plan it again." action={<Button onClick={() => setEditDesc(d.description)}>Edit the description</Button>} /></Panel> : null}
                  </div>
                </section>
                <Panel className="flex flex-wrap items-center justify-between gap-4 p-5" aria-label="Suggested company">
                  <div>
                    <h2 className="text-[15px] font-semibold">Suggested company</h2>
                    <p className="mt-1 text-sm text-ink-2">{d.suggestedSetup.name}, {d.suggestedSetup.teams.length} teams, daily cap <span className="num">{usd(d.suggestedSetup.dailyCap)}</span>. You can change all of it in the next step.</p>
                  </div>
                  <LinkButton href={`/drafts/${id}/launch`} variant="primary" icon="spark">{d.status === "launching" ? "Resume launch" : "Launch"}</LinkButton>
                </Panel>
              </div>

              <Dialog open={editDesc !== null} onClose={() => setEditDesc(null)} title="Edit the description" width={600} footer={<><Button onClick={() => setEditDesc(null)}>Cancel</Button><Button variant="primary" loading={patch.isPending} onClick={() => editDesc && patch.mutate({ description: editDesc })}>Plan it again</Button></>}>
                <p className="mb-3 text-sm text-ink-2">Changing the description replaces the plan and its estimate.</p>
                <Textarea aria-label="Description" rows={8} value={editDesc ?? ""} onChange={(e) => setEditDesc(e.target.value)} />
              </Dialog>
              <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this draft?" footer={<><Button onClick={() => setConfirmDelete(false)}>Keep it</Button><Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>Delete draft</Button></>}>
                <p className="text-sm text-ink-2">"{d.title}" and its plan will be removed. This can't be undone.</p>
              </Dialog>
              <Dialog open={addTo} onClose={() => setAddTo(false)} title="Add to an existing company">
                <p className="mb-3 text-sm text-ink-2">The plan joins the company and waits there for approval.</p>
                <ul className="space-y-2">
                  {mine.map((c) => (
                    <li key={c.companyId}>
                      <button type="button" disabled={launchInto.isPending} onClick={() => launchInto.mutate(c.companyId)} className="flex w-full items-center justify-between rounded-[12px] border border-line-strong bg-raised px-4 py-3 text-left hover:bg-hover disabled:opacity-50">
                        <span className="font-medium">{c.name}</span>
                        <Icon name="right" className="text-ink-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Dialog>
            </div>
          );
        }}
      </Async>
    </AccountShell>
  );
}
