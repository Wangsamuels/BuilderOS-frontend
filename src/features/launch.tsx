"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { isApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { Draft } from "@/api/types";
import { useSession } from "@/auth/session";
import { AccountShell } from "@/components/shell";
import { SERIES } from "@/components/charts";
import { Orbits, Singularity } from "@/components/singularity";
import { Async, Button, Empty, Field, Icon, Input, LinkButton, Notice, PageHeader, Panel, Skeleton, Spinner } from "@/components/ui";
import { IS_TESTNET, TESTNET_FAUCET_URL } from "@/lib/config";
import { cx, slugify } from "@/lib/format";
import { near, parseUsd, toBig, usd, usdInput } from "@/lib/money";
import { pollUntil, SignCancelled, useSign } from "@/wallet/signing";

type StepId = "company" | "teams" | "email" | "funding" | "sign" | "creating";
const LABEL: Record<StepId, string> = { company: "Company", teams: "Teams", email: "Email", funding: "Funding", sign: "Sign", creating: "Creating" };
type TeamRow = { team: string; monthly: string; perTx: string };

export function EmailVerify({ onVerified }: { onVerified: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const start = useMutation({ mutationFn: () => endpoints.startEmail(email.trim()) });
  const verify = useMutation({
    mutationFn: () => endpoints.verifyEmail(code.trim()),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["account"] })]);
      onVerified();
    },
  });
  const sent = start.data;
  return (
    <div className="space-y-5">
      {!sent ? (
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), start.mutate())}>
          <Field label="Email" hint="Approvals and alerts for your company go here. We send a 6-digit code to confirm it." error={start.error ? (start.error as Error).message : null}>
            {(p) => <Input {...p} type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}
          </Field>
          <Button type="submit" variant="primary" loading={start.isPending} disabled={!/.+@.+\..+/.test(email)}>Send code</Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), verify.mutate())}>
          <p className="text-sm text-ink-2">We sent a code to <strong className="font-medium text-ink">{sent.sentTo}</strong>. It expires in 10 minutes.</p>
          <Field label="6-digit code" error={verify.error ? (isApiError(verify.error, "code_expired") || isApiError(verify.error, "too_many_attempts") ? `${(verify.error as Error).message} Send a new code.` : (verify.error as Error).message) : null}>
            {(p) => <Input {...p} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="num !h-14 max-w-48 text-center !text-2xl tracking-[0.3em]" data-dev-code={sent.devCode} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={verify.isPending} disabled={code.length !== 6}>Verify email</Button>
            <Button variant="ghost" onClick={() => (start.reset(), verify.reset(), setCode(""))}>Use another address</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function LaunchWizard({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["draft", id], queryFn: () => endpoints.draft(id) });
  // Launching turns the draft into a company while this page is open. Only a draft that was already launched
  // when the page loaded is "done"; one that launches under the wizard still has its last step, approving the plan.
  const first = useRef<Draft["status"] | null>(null);
  if (q.data && first.current === null) first.current = q.data.draft.status;
  return (
    <AccountShell width="max-w-3xl">
      <Async q={q} skeleton={<div className="space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-96" /></div>}>
        {({ draft }) =>
          first.current === "launched" && draft.companyId ? (
            <Panel as="div"><Empty icon="check" title="This draft is already a company" body="Its plan lives in the company now. Approve it there if you haven't yet." action={<LinkButton variant="primary" href={`/c/${draft.companyId.split(".")[0]}/work/plans/${draft.id}`}>Open the plan</LinkButton>} /></Panel>
          ) : (
            <Wizard draft={draft} />
          )
        }
      </Async>
    </AccountShell>
  );
}

function Wizard({ draft }: { draft: Draft }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const sign = useSign();
  const s = draft.suggestedSetup;
  const resumeSlug = draft.status === "launching" ? (draft.launchCompanyId?.split(".")[0] ?? null) : null;

  const [name, setName] = useState(s.name);
  const [slug, setSlug] = useState(resumeSlug ?? s.slug);
  const [slugEdited, setSlugEdited] = useState(Boolean(resumeSlug));
  const [slugError, setSlugError] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>(() => s.teams.map((t) => ({ team: t.team, monthly: usdInput(t.monthlyCap), perTx: usdInput(t.perTxLimit) })));
  const [dailyCap, setDailyCap] = useState(usdInput(s.dailyCap));
  const [step, setStep] = useState<StepId>(resumeSlug ? "sign" : "company");
  const [funds, setFunds] = useState<{ requiredYocto: string; availableYocto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);

  const needsEmail = me.data?.needsEmailForCompany ?? false;
  const steps = useMemo<StepId[]>(() => ["company", "teams", ...(needsEmail || step === "email" ? (["email"] as StepId[]) : []), "funding", "sign", "creating"], [needsEmail, step]);
  const go = (to: StepId) => (setError(null), setStep(to));
  const nextOf = (cur: StepId) => steps[steps.indexOf(cur) + 1];

  // live "taken?" check while typing the slug
  const [debounced, setDebounced] = useState(slug);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(slug), 350);
    return () => clearTimeout(t);
  }, [slug]);
  const slugOk = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug);
  const creation = useQuery({ queryKey: ["creation", debounced], queryFn: () => endpoints.creation(debounced), enabled: step === "company" && slugOk && debounced === slug, staleTime: 5_000 });
  const taken = Boolean(creation.data?.slugTaken && !creation.data.founderIsYou);

  const required = toBig(funds?.requiredYocto ?? me.data?.funding.recommendedYocto);
  const available = toBig(funds?.availableYocto ?? me.data?.balance.availableYocto);
  const enough = available >= required;
  const fund = useMutation({
    mutationFn: () => endpoints.fundTestnet(),
    onSuccess: async () => {
      setFunds(null);
      await pollUntil(async () => toBig((await qc.fetchQuery({ queryKey: ["me"], queryFn: endpoints.me, staleTime: 0 })).balance.availableYocto) >= required, { timeout: 15_000 });
    },
  });

  const teamErrors = teams.map((t) => (!parseUsd(t.monthly) || toBig(parseUsd(t.monthly)) === 0n ? "Enter a monthly budget" : null));
  const capMicro = parseUsd(dailyCap);

  const approving = useRef(false);
  async function approvePlan() {
    if (approving.current) return;
    approving.current = true;
    setBusy(true);
    setError(null);
    try {
      await sign({
        title: "Approve the plan",
        summary: "Agents start on the plan's tasks once this is confirmed. Each task has a hard cost cap.",
        request: (key) => endpoints.approvePlan(draft.id, key),
        confirm: () => pollUntil(async () => (await endpoints.tasks(slug, draft.id)).tasks.length > 0, { timeout: 12_000 }),
        doneLabel: "Plan approved",
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["overview"] })]);
      void endpoints.setPreferences({ lastCompanyId: slug }).catch(() => {});
      router.push(`/c/${slug}`);
    } catch (e) {
      if (!(e instanceof SignCancelled)) setError(isApiError(e, "plan_already_approved") ? null : (e as Error).message);
      if (isApiError(e, "plan_already_approved")) router.push(`/c/${slug}`);
    } finally {
      approving.current = false;
      setBusy(false);
    }
  }

  async function waitForCompany() {
    go("creating");
    const ok = await pollUntil(async () => {
      const c = await endpoints.creation(slug);
      if (c.slugTaken && !c.founderIsYou) throw new Error("slug_taken");
      return c.companyExists && (c.plansBound.includes(draft.id) || c.departments.length >= teams.length);
    }, { every: 2000, timeout: 60_000 });
    if (ok) {
      setCreated(true);
      await qc.invalidateQueries({ queryKey: ["me"] });
    } else {
      const c = await endpoints.creation(slug).catch(() => null);
      if (c?.slugTaken && !c.founderIsYou) {
        setSlugError("Someone took this name while you were signing. Pick another name.");
        go("company");
      } else setError("The chain is taking longer than usual. Your company is still being created; this page keeps checking.");
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await sign({
        title: "Create your company",
        summary: (
          <>
            <strong className="text-ink">{name}</strong> with {teams.length} teams. Your wallet signs once for the company and once for each team. Storage on NEAR costs about <span className="num">{near(required)}</span>.
          </>
        ),
        request: (key) => endpoints.createCompany({ name: name.trim(), slug, planId: draft.id, teams: teams.map((t) => ({ team: t.team, monthlyCap: parseUsd(t.monthly)! })), dailyCap: capMicro ?? undefined }, key),
        doneLabel: "Signed",
      });
      void qc.invalidateQueries({ queryKey: ["draft", draft.id] });
      await waitForCompany();
    } catch (e) {
      if (e instanceof SignCancelled) {
        // If signing failed because someone took the name meanwhile, the draft is still yours: pick another name.
        const c = await endpoints.creation(slug).catch(() => null);
        if (c?.slugTaken && !c.founderIsYou) {
          setSlugError("Someone took this name while you were signing. Pick another name.");
          go("company");
        }
        return;
      }
      if (isApiError(e, "email_required")) go("email");
      else if (isApiError(e, "insufficient_funds")) {
        setFunds(e.details as { requiredYocto: string; availableYocto: string });
        go("funding");
      } else if (isApiError(e, "slug_taken")) {
        setSlugError(e.message);
        go("company");
      } else if (isApiError(e, "create_in_progress")) await waitForCompany();
      else if (isApiError(e, "draft_already_launched")) router.push(`/c/${String(e.details.companyId ?? slug).split(".")[0]}`);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const idx = steps.indexOf(step);
  return (
    <div data-testid="launch-wizard" data-step={step}>
      <PageHeader back={{ href: `/drafts/${draft.id}`, label: "Back to the plan" }} title="Launch your company" sub={draft.title} />
      <ol aria-label="Progress" className="mb-6 flex items-center gap-1.5 overflow-x-auto pb-1">
        {steps.map((st, i) => (
          <li key={st} aria-current={st === step ? "step" : undefined} className="flex shrink-0 items-center gap-1.5">
            <span className={cx("flex h-8 items-center gap-2 rounded-full border px-3 text-[13px]", i < idx ? "border-green/30 bg-green-wash text-green" : st === step ? "border-ember bg-ember-wash font-medium text-ink" : "border-line text-ink-3")}>
              {i < idx ? <Icon name="check" size={12} /> : <span className="num">{i + 1}</span>}
              {LABEL[st]}
            </span>
            {i < steps.length - 1 ? <span className="h-px w-3 bg-line-strong" /> : null}
          </li>
        ))}
      </ol>

      <Panel className="overflow-hidden">
        {step === "company" ? (
          <form className="space-y-5 p-5 sm:p-7" onSubmit={(e) => (e.preventDefault(), !taken && slugOk && name.trim() && go("teams"))}>
            <Field label="Company name">
              {(p) => <Input {...p} name="name" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} />}
            </Field>
            <Field label="Web address" hint={!slugOk ? undefined : creation.isFetching || debounced !== slug ? "Checking…" : creation.data ? (taken ? undefined : "Available") : undefined} error={slugError ?? (!slugOk ? "Use 3 to 32 lowercase letters, numbers or dashes." : taken ? "This name is taken. Pick another." : null)}>
              {(p) => (
                <div className="flex items-center gap-2">
                  <span className="text-ink-3">/c/</span>
                  <Input {...p} name="slug" value={slug} onChange={(e) => { setSlugEdited(true); setSlugError(null); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }} />
                </div>
              )}
            </Field>
            <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!slugOk || taken || !name.trim()}>Continue</Button></div>
          </form>
        ) : null}

        {step === "teams" ? (
          <form className="p-5 sm:p-7" onSubmit={(e) => (e.preventDefault(), !teamErrors.some(Boolean) && capMicro && go(nextOf("teams")))}>
            <p className="mb-5 text-sm text-ink-2">Each team gets a monthly budget its agents can't exceed. Budgets can be raised later, not lowered; per-purchase limits are fixed once the company exists.</p>
            <ul className="space-y-4">
              {teams.map((t, i) => (
                <li key={t.team} className="grid gap-3 rounded-[12px] border border-line p-4 sm:grid-cols-[1fr_160px_160px] sm:items-start">
                  <div className="pt-1"><div className="font-medium">{t.team}</div><div className="text-[13px] text-ink-3">{draft.features.filter((f) => f.team === t.team).length} steps in the plan</div></div>
                  <Field label="Monthly budget ($)" error={teamErrors[i]}>
                    {(p) => <Input {...p} inputMode="decimal" value={t.monthly} onChange={(e) => setTeams((xs) => xs.map((x, j) => (j === i ? { ...x, monthly: e.target.value } : x)))} className="num" />}
                  </Field>
                  <Field label="Per purchase ($)" hint="Suggested from the plan">
                    {(p) => <Input {...p} value={t.perTx} readOnly disabled className="num" />}
                  </Field>
                </li>
              ))}
            </ul>
            <div className="mt-5 max-w-56">
              <Field label="Daily cap, all teams ($)" error={!capMicro ? "Enter an amount" : null} hint="Past this, purchases wait for you.">
                {(p) => <Input {...p} inputMode="decimal" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} className="num" />}
              </Field>
            </div>
            <div className="mt-6 flex justify-between"><Button variant="ghost" onClick={() => go("company")}>Back</Button><Button type="submit" variant="primary">Continue</Button></div>
          </form>
        ) : null}

        {step === "email" ? (
          <div className="p-5 sm:p-7">
            <h2 className="mb-1 text-lg font-semibold">Verify your email</h2>
            <p className="mb-5 text-sm text-ink-2">A founder needs a verified email before creating a company.</p>
            {needsEmail ? <EmailVerify onVerified={() => go("funding")} /> : <><Notice tone="green" icon="check">Your email is verified.</Notice><div className="mt-5 flex justify-end"><Button variant="primary" onClick={() => go("funding")}>Continue</Button></div></>}
          </div>
        ) : null}

        {step === "funding" ? (
          <div className="p-5 sm:p-7">
            <h2 className="mb-1 text-lg font-semibold">NEAR for storage</h2>
            <p className="mb-5 text-sm text-ink-2">Creating the company and its {teams.length} teams stores contracts on NEAR. Your wallet pays for that storage once.</p>
            <dl className="grid grid-cols-2 gap-4 rounded-[12px] border border-line p-4">
              <div><dt className="text-[13px] text-ink-3">Needed</dt><dd className="num mt-0.5 text-xl font-semibold">{near(required)}</dd></div>
              <div><dt className="text-[13px] text-ink-3">In your wallet</dt><dd className={cx("num mt-0.5 text-xl font-semibold", enough ? "text-green" : "text-amber")} data-testid="wallet-balance">{near(available)}</dd></div>
            </dl>
            {!enough ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {IS_TESTNET ? <Button variant="primary" loading={fund.isPending} onClick={() => fund.mutate()} data-testid="fund-testnet">Add testnet NEAR for me</Button> : null}
                {IS_TESTNET ? <a href={TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">Open the testnet faucet <Icon name="external" size={13} /></a> : <p className="text-sm text-ink-2">Send NEAR to <span className="num break-all text-ink">{me.data?.accountId}</span>, then come back.</p>}
              </div>
            ) : null}
            {fund.error ? <div className="mt-4"><Notice tone="red">{(fund.error as Error).message}</Notice></div> : null}
            <div className="mt-6 flex justify-between"><Button variant="ghost" onClick={() => go("teams")}>Back</Button><Button variant="primary" disabled={!enough} onClick={() => go("sign")}>Continue</Button></div>
          </div>
        ) : null}

        {step === "sign" ? (
          <div className="p-5 sm:p-7">
            <h2 className="mb-1 text-lg font-semibold">{resumeSlug ? "Finish creating your company" : "Review and sign"}</h2>
            <p className="mb-5 text-sm text-ink-2">{resumeSlug ? "The launch was started earlier. Only the steps that are still missing need your signature." : `Your wallet signs ${teams.length + 1} transactions: one for the company and one for each team.`}</p>
            <dl className="divide-y divide-line rounded-[12px] border border-line px-4">
              <div className="flex justify-between gap-4 py-3 text-sm"><dt className="text-ink-3">Company</dt><dd className="text-right font-medium">{name}<span className="block text-[13px] font-normal text-ink-3">/c/{slug}</span></dd></div>
              {teams.map((t) => <div key={t.team} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-ink-3">{t.team} team</dt><dd className="num">{parseUsd(t.monthly) ? usd(parseUsd(t.monthly)) : "—"} a month</dd></div>)}
              <div className="flex justify-between gap-4 py-3 text-sm"><dt className="text-ink-3">Daily cap</dt><dd className="num">{usd(capMicro)}</dd></div>
            </dl>
            {error ? <div className="mt-4"><Notice tone="red">{error}</Notice></div> : null}
            <div className="mt-6 flex justify-between"><Button variant="ghost" onClick={() => go("funding")} disabled={busy}>Back</Button><Button variant="primary" size="lg" loading={busy} onClick={() => void create()} data-testid="create-company">{resumeSlug ? "Continue creating" : "Create company"}</Button></div>
          </div>
        ) : null}

        {step === "creating" ? (
          <div className="relative isolate">
            {/* matter gathers while the company forms; the disk is full once it exists on chain */}
            <Singularity className="absolute inset-0 -z-10 size-full" mass={created ? 1 : 0.25} spin={created ? 1 : 2.2} zoom={0.9} offset={[0, 0.12]} quality="low" />
            {/* once the company exists, each team it was created with takes up its orbit */}
            {created ? <Orbits className="absolute inset-0 -z-10 size-full" zoom={0.62} offset={[0, 0.12]} bodies={teams.map((_, i) => ({ color: SERIES[i % SERIES.length], ring: i % 2, period: 40 + i * 14, phase: (i * 0.37) % 1 }))} /> : null}
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-surface via-surface/60 to-transparent" />
            <div className="flex min-h-[420px] flex-col items-center justify-end px-5 pt-40 pb-8 text-center sm:px-7" aria-live="polite">
              {created ? (
                <>
                  <h2 className="text-2xl font-semibold" data-testid="company-created">{name} exists on chain</h2>
                  <p className="mt-2 max-w-[46ch] text-ink-2">One step left: approve the plan so agents can start. Each task carries its own hard cap.</p>
                  {error ? <div className="mt-4 text-left"><Notice tone="red">{error}</Notice></div> : null}
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <LinkButton href={`/c/${slug}`}>Open without approving</LinkButton>
                    <Button variant="primary" size="lg" loading={busy} onClick={() => void approvePlan()} data-testid="approve-plan">Approve plan</Button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="flex items-center gap-3 text-2xl font-semibold"><Spinner size={18} /> Creating your company…</h2>
                  <p className="mt-2 max-w-[46ch] text-ink-2">Waiting for the chain to confirm the company and its teams. This usually takes a few seconds. You can leave and come back.</p>
                  {error ? <div className="mt-4 text-left"><Notice tone="amber">{error}</Notice><Button className="mt-3" onClick={() => void waitForCompany()}>Check again</Button></div> : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
