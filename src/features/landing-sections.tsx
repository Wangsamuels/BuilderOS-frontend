"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Chip, Icon } from "@/components/ui";
import { cx } from "@/lib/format";

/* ---------- small hooks ---------- */
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True while the element is on screen. Animations only run for what the person can see. */
function useInView<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/* ---------- the rolling word in the headline ---------- */
/**
 * One word that rolls to the next, like a counter wheel. The tile keeps the width of the longest word,
 * so the headline never reflows. Screen readers get the words once, as plain text.
 */
export function RollingWord({ words, every = 2000 }: { words: string[]; every?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => !document.hidden && setN((v) => v + 1), every);
    return () => clearInterval(t);
  }, [every]);
  const now = words[n % words.length];
  const before = words[(n + words.length - 1) % words.length];
  const roll = "col-start-1 row-start-1 text-center";
  return (
    <span className="relative inline-grid overflow-hidden rounded-[0.2em] bg-ember px-[0.16em] pb-[0.06em] align-baseline leading-[1.16] text-[#1a1206]">
      <span className="sr-only">{words.join(" and ")}</span>
      {/* sizer: the widest word, invisible */}
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {words.reduce((a, b) => (b.length > a.length ? b : a))}
      </span>
      {n > 0 ? (
        <span key={`o${n}`} aria-hidden className={roll} style={{ animation: "roll-out 0.55s cubic-bezier(0.65, 0, 0.35, 1) both" }}>
          {before}
        </span>
      ) : null}
      <span key={`i${n}`} aria-hidden className={roll} style={n > 0 ? { animation: "roll-in 0.55s cubic-bezier(0.65, 0, 0.35, 1) both" } : undefined}>
        {now}
      </span>
    </span>
  );
}

/* ---------- what it stands on ---------- */
const FACTS = [
  ["Budgets on NEAR", "Each team's budget, per-purchase limit and the daily cap are enforced by smart contracts, not by a setting in a dashboard."],
  ["Paid per call, in USDC", "Agents pay for models and services as they use them, from their team's own address on Base."],
  ["Numbers from records", "Costs, checks and reviews come from receipts and logs. An agent's summary is labelled as exactly that."],
  ["One transaction stops it", "Pause every team at once. Only the founder can resume."],
];
export function Facts() {
  return (
    <section aria-label="What BuilderOS stands on" className="border-y border-line bg-bg">
      <dl className="mx-auto grid max-w-6xl gap-x-8 gap-y-8 px-4 py-10 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        {FACTS.map(([t, d]) => (
          <div key={t}>
            <dt className="font-display text-[15px] font-semibold text-ink">{t}</dt>
            <dd className="mt-1.5 text-sm text-ink-2">{d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------- the flow, playing ---------- */
const STEPS = [
  { title: "Describe it", body: "Say what the product does, who it's for and how they pay. Plain words are enough, and nothing costs money yet." },
  { title: "Review the plan", body: "It comes back as steps grouped by team, each with a likely cost, a high estimate and a hard cap. Edit or remove any step." },
  { title: "Launch the company", body: "Your wallet signs the company and its teams onto NEAR. Each team gets its own budget and limits." },
  { title: "Agents work, you decide", body: "Agents build and report back per team. Anything over a limit, or from a new seller, waits for you." },
];
const STEP_MS = 5200;
const SENTENCE = "A notes app for small teams with sharing, version history and offline drafts.";
const PLAN = [
  ["var(--color-s1)", "Sign-in and accounts", "$6.20"],
  ["var(--color-s1)", "Note editor with autosave", "$11.40"],
  ["var(--color-s2)", "Production deploy and monitoring", "$3.10"],
  ["var(--color-s3)", "Landing page and waitlist", "$2.80"],
];
const SIGN = ["Create the company", "Create the build team", "Create the ops team", "Create the growth team"];

function Typed({ text, play }: { text: string; play: boolean }) {
  const [n, setN] = useState(play ? 0 : text.length);
  useEffect(() => {
    if (!play) return setN(text.length);
    setN(0);
    const t = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(t), v) : v + 1)), 34);
    return () => clearInterval(t);
  }, [text, play]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length ? <span aria-hidden className="ml-px inline-block h-[1.1em] w-px translate-y-[0.2em] bg-ember" style={{ animation: "caret 0.9s steps(1) infinite" }} /> : null}
    </>
  );
}
function Ticks({ play }: { play: boolean }) {
  const [done, setDone] = useState(play ? 0 : SIGN.length);
  useEffect(() => {
    if (!play) return setDone(SIGN.length);
    setDone(0);
    const t = setInterval(() => setDone((v) => (v >= SIGN.length ? (clearInterval(t), v) : v + 1)), 950);
    return () => clearInterval(t);
  }, [play]);
  return (
    <>
      <p className="mb-3 text-sm text-ink-2">{done < SIGN.length ? `Step ${done + 1} of ${SIGN.length}: approve in your wallet` : "Signed. The company exists on chain."}</p>
      <ol className="space-y-2.5">
        {SIGN.map((s, i) => (
          <li key={s} className={cx("flex items-center gap-3 text-sm transition-colors duration-300", i < done ? "text-ink" : i === done ? "text-ember" : "text-ink-3")}>
            <span className={cx("grid size-6 place-items-center rounded-full border text-xs transition-colors duration-300", i < done ? "border-green/50 bg-green-wash text-green" : i === done ? "border-ember/70" : "border-line-strong")}>{i < done ? <Icon name="check" size={12} /> : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </>
  );
}
const stagger = (i: number, play: boolean) => (play ? { animation: "appear 0.45s cubic-bezier(0.16, 1, 0.3, 1) both", animationDelay: `${0.15 + i * 0.22}s` } : undefined);

function Preview({ step, play }: { step: number; play: boolean }) {
  const frame = "flex h-full flex-col";
  const label = (t: string) => <div className="mb-3 text-[13px] text-ink-3">{t}</div>;
  if (step === 0)
    return (
      <div className={frame}>
        {label("What does it do?")}
        <div className="min-h-28 flex-1 rounded-[10px] border border-line-strong bg-void/60 p-3.5 leading-relaxed text-ink">
          <Typed text={SENTENCE} play={play} />
        </div>
        <div className="mt-4 flex justify-end">
          <span className="inline-flex h-10 items-center rounded-full bg-ember px-5 text-sm font-semibold text-[#1a1206]">Plan it</span>
        </div>
      </div>
    );
  if (step === 1)
    return (
      <div className={frame}>
        {label("The plan, by team")}
        <ul className="flex-1 divide-y divide-line rounded-[10px] border border-line">
          {PLAN.map(([color, title, cost], i) => (
            <li key={title} className="flex items-center gap-3 px-3.5 py-2.5 text-sm" style={stagger(i, play)}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="min-w-0 flex-1 truncate">{title}</span>
              <span className="num text-ink-2">{cost}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-[13px]" style={stagger(PLAN.length, play)}>
          {[["Likely", "$23.50"], ["High", "$37.60"], ["Hard cap", "$58.75"]].map(([k, v]) => (
            <div key={k}>
              <dt className="text-ink-3">{k}</dt>
              <dd className="num mt-0.5 text-base font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  if (step === 2)
    return (
      <div className={frame}>
        {label("Your wallet signs, in order")}
        <Ticks play={play} />
      </div>
    );
  return (
    <div className={cx(frame, "gap-3")}>
      {label("Reports and decisions")}
      <div className="rounded-[12px] border border-line bg-void/50 p-3.5" style={stagger(0, play)}>
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium">build · Sign-in and accounts</span>
          <Chip tone="green" dot>
            Done
          </Chip>
        </div>
        <p className="mt-1.5 text-[13px] text-ink-3">Agent's summary</p>
        <p className="text-sm text-ink-2">Built sign-in and accounts and covered it with tests. All checks pass.</p>
      </div>
      <div className="rounded-[12px] border border-amber/30 bg-amber-wash p-3.5" style={stagger(2, play)}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">
            <strong className="font-semibold">growth</strong> wants to pay a new seller <span className="num">$14.00</span>
          </span>
          <Chip tone="amber">Waiting on you</Chip>
        </div>
        <div className="mt-3 flex justify-end gap-2 text-[13px]">
          <span className="inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-ink-2">Reject</span>
          <span className="inline-flex h-8 items-center rounded-full bg-ember px-3 font-semibold text-[#1a1206]">Approve</span>
        </div>
      </div>
    </div>
  );
}

/** The four steps of the product, playing on their own while in view. Any step can be picked; hovering holds it. */
export function Flow() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const [motion, setMotion] = useState(false);
  useEffect(() => setMotion(!reducedMotion()), []);
  const playing = inView && !held && motion;
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, step]);

  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-20 sm:px-8 sm:py-28">
      <h2 id="how-title" className="max-w-[20ch] text-3xl leading-tight font-semibold sm:text-[40px]">
        From a sentence to a running company
      </h2>
      <p className="mt-4 max-w-[58ch] text-lg text-ink-2">Four steps. The first two cost nothing; nothing is on chain until your wallet signs.</p>
      <div ref={ref} className="mt-12 grid gap-8 lg:grid-cols-[1fr_1.05fr] lg:gap-14" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} onFocusCapture={() => setHeld(true)} onBlurCapture={() => setHeld(false)}>
        <ol>
          {STEPS.map((s, i) => {
            const on = i === step;
            return (
              <li key={s.title} className="relative">
                <button type="button" aria-current={on ? "step" : undefined} onClick={() => setStep(i)} className="group flex w-full gap-4 py-4 text-left">
                  <span className={cx("num grid size-8 shrink-0 place-items-center rounded-full border text-sm transition-colors duration-300", on ? "border-ember bg-ember text-[#1a1206]" : i < step ? "border-ember/50 text-ember" : "border-line-strong text-ink-3 group-hover:text-ink")}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cx("block font-display text-lg font-semibold transition-colors duration-300", on ? "text-ink" : "text-ink-2 group-hover:text-ink")}>{s.title}</span>
                    {/* the body opens for the active step; grid rows animate the height without measuring */}
                    <span className={cx("grid transition-[grid-template-rows,opacity] duration-500 ease-out", on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                      <span className="overflow-hidden">
                        <span className="block pt-1.5 text-ink-2">{s.body}</span>
                      </span>
                    </span>
                  </span>
                </button>
                {/* how long this step stays before the next one */}
                <span aria-hidden className="block h-px bg-line">
                  {on && playing ? <span key={step} className="block h-px origin-left bg-ember" style={{ animation: `fill-x ${STEP_MS}ms linear both` }} /> : null}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="panel min-h-[340px] p-5 sm:p-6" aria-live="off">
          <div key={step} className="h-full" style={motion ? { animation: "appear 0.4s cubic-bezier(0.16, 1, 0.3, 1) both" } : undefined}>
            <Preview step={step} play={motion && inView} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- the path of a purchase ---------- */
type Tone = "green" | "amber";
const DOT: Record<Tone, string> = { green: "bg-green shadow-[0_0_10px_var(--color-green)]", amber: "bg-amber shadow-[0_0_10px_var(--color-amber)]" };

function Node({ icon, title, sub, tone }: { icon: string; title: string; sub: string; tone?: Tone | "ember" }) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-line-strong bg-surface px-3.5 py-3 lg:w-[190px] lg:shrink-0 lg:flex-col lg:items-start lg:gap-2">
      <span className={cx("grid size-8 shrink-0 place-items-center rounded-full border", tone === "green" ? "border-green/40 bg-green-wash text-green" : tone === "amber" ? "border-amber/40 bg-amber-wash text-amber" : "border-line-strong text-ember")}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="text-[13px] text-ink-3">{sub}</div>
      </div>
    </div>
  );
}
/** A connector with a payment travelling along it: sideways on wide screens, downward on phones. */
function Link_({ tone, delay, cycle, play }: { tone: Tone; delay: number; cycle: number; play: boolean }) {
  const dot = cx("absolute size-2 rounded-full opacity-0", DOT[tone]);
  const anim = (name: string) => (play ? { animation: `${name} ${cycle}s linear ${delay}s infinite` } : undefined);
  return (
    <div aria-hidden className="relative ml-[29px] h-7 w-px bg-line-strong lg:ml-0 lg:h-px lg:w-auto lg:min-w-8 lg:flex-1">
      <span className={cx(dot, "-left-[3.5px] lg:hidden")} style={anim("travel-y")} />
      <span className={cx(dot, "-top-[3.5px] hidden lg:block")} style={anim("travel-x")} />
    </div>
  );
}
function Lane({ tone, title, note, children }: { tone: Tone; title: string; note: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 font-sans text-[15px] font-semibold tracking-normal text-ink">
          <span className={cx("size-2 rounded-full", tone === "green" ? "bg-green" : "bg-amber")} />
          {title}
        </h3>
        <p className="text-sm text-ink-3">{note}</p>
      </div>
      <div className="flex flex-col lg:flex-row lg:items-center">{children}</div>
    </div>
  );
}

/** How one purchase travels: straight through when it fits the limits, by way of you when it doesn't. */
export function PurchasePath() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const [motion, setMotion] = useState(false);
  useEffect(() => setMotion(!reducedMotion()), []);
  const play = inView && motion;
  const hop = 1.25; // seconds a payment takes between two stops
  return (
    <section aria-labelledby="path-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-28">
      <h2 id="path-title" className="max-w-[22ch] text-3xl leading-tight font-semibold sm:text-[40px]">
        Every purchase takes one of two paths
      </h2>
      <p className="mt-4 max-w-[60ch] text-lg text-ink-2">An agent never holds your keys or a card. It asks its team's contract to pay, and the contract answers.</p>
      <div ref={ref} className="mt-12 space-y-10">
        <Lane tone="green" title="Inside the limits" note="Paid at once. You see it in the ledger.">
          <Node icon="spark" title="Agent" sub="Needs a model call" />
          <Link_ tone="green" delay={0} cycle={5} play={play} />
          <Node icon="shield" title="Team contract" sub="Budget, limit and cap all fit" tone="green" />
          <Link_ tone="green" delay={hop} cycle={5} play={play} />
          <Node icon="money" title="Seller" sub="Paid in USDC, receipt recorded" />
        </Lane>
        <Lane tone="amber" title="Over a limit, a new seller, or the daily cap" note="Held until someone with approve access decides.">
          <Node icon="spark" title="Agent" sub="Wants to buy a domain" />
          <Link_ tone="amber" delay={0.6} cycle={6} play={play} />
          <Node icon="pause" title="Team contract" sub="Holds the purchase" tone="amber" />
          <Link_ tone="amber" delay={0.6 + hop} cycle={6} play={play} />
          <Node icon="approvals" title="You" sub="Approve or reject, signed by your wallet" tone="amber" />
          <Link_ tone="amber" delay={0.6 + hop * 2 + 0.9} cycle={6} play={play} />
          <Node icon="money" title="Seller" sub="Paid only if you approved" />
        </Lane>
      </div>
    </section>
  );
}

/* ---------- what a report is ---------- */
export function ReportAnatomy() {
  const fact = (k: string, v: ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="text-ink-3">{k}</dt>
      <dd className="min-w-0 text-right text-ink">{v}</dd>
    </div>
  );
  return (
    <section aria-labelledby="report-title" className="border-y border-line bg-bg">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <h2 id="report-title" className="max-w-[18ch] text-3xl leading-tight font-semibold sm:text-[40px]">
            What an agent says, and what the records show
          </h2>
          <p className="mt-5 max-w-[52ch] text-lg text-ink-2">After every attempt at a task an agent writes a report. BuilderOS keeps its words and the evidence apart, so you never have to take a summary on trust.</p>
          <ul className="mt-6 space-y-3 text-ink-2">
            {["Reports are grouped by team, so each team's work reads as one story.", "Checks, the review by a second model, the commit and every receipt are recorded facts.", "Earlier attempts at the same task stay on the timeline."].map((t) => (
              <li key={t} className="flex gap-3">
                <Icon name="check" className="mt-1 text-ember" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <figure className="panel overflow-hidden" aria-label="Sample report">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <span className="min-w-0 truncate text-[15px] font-semibold">Note editor with autosave</span>
            <Chip tone="green" dot>
              Done
            </Chip>
          </div>
          <div className="grid sm:grid-cols-2">
            <div className="border-b border-line p-5 sm:border-r sm:border-b-0">
              <div className="mb-2 text-[13px] text-ink-3">Agent's summary</div>
              <p className="text-[15px] leading-relaxed text-ink-2">Built the editor with autosave and covered it with tests. The second attempt narrowed the change after a type error in the autosave hook.</p>
            </div>
            <dl className="divide-y divide-line px-5 py-2.5">
              <div className="pt-2.5 pb-1 text-[13px] text-ink-3">Recorded facts</div>
              {fact("Checks", <span className="text-green">Passed</span>)}
              {fact("Review", "Pass, by a second model")}
              {fact("Attempts", "2")}
              {fact("Cost", <span className="num">$9.12 over 10 model calls</span>)}
              {fact("Commit", <span className="num">a41c9e7</span>)}
            </dl>
          </div>
          <figcaption className="border-t border-line px-5 py-2.5 text-[13px] text-ink-3">A sample report with invented data.</figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ---------- who can do what ---------- */
const ROLES: Array<[string, string, string]> = [
  ["Viewer", "Budgets, spending and reports", "Nothing changes"],
  ["Approver", "Money and the purchases that are waiting", "Approves or rejects purchases"],
  ["Builder", "Plans, tasks, code and reports", "Adds plans for agents to build"],
  ["Admin", "Everything", "Budgets, agents, plan approval, pause all"],
  ["Founder", "Everything", "Also invites, removes, resumes and sets the daily cap"],
];
export function Roles() {
  return (
    <section aria-labelledby="roles-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-28">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <div>
          <h2 id="roles-title" className="max-w-[16ch] text-3xl leading-tight font-semibold sm:text-[40px]">
            Bring people in, one scope at a time
          </h2>
          <p className="mt-5 max-w-[46ch] text-lg text-ink-2">Access is written on chain when someone accepts an invite and checked on every request. Limit anyone to a single team and that team is all they see.</p>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-[13px] text-ink-3">
              <tr>
                {["Role", "Sees", "Can do"].map((h) => (
                  <th key={h} scope="col" className="border-b border-line px-5 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map(([role, sees, does]) => (
                <tr key={role} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="px-5 py-3.5 font-semibold whitespace-nowrap text-ink">
                    {role === "Founder" ? <span className="text-ember">{role}</span> : role}
                  </th>
                  <td className="px-5 py-3.5 text-ink-2">{sees}</td>
                  <td className="px-5 py-3.5 text-ink-2">{does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
