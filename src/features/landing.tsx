"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/auth/session";
import { BudgetBar } from "@/components/charts";
import { HorizonGauge, Mark, Orbits, Singularity } from "@/components/singularity";
import { Chip, Icon, LinkButton } from "@/components/ui";
import { IS_TESTNET } from "@/lib/config";
import { SignInButtons } from "./auth";
import { Facts, Flow, PurchasePath, ReportAnatomy, RollingWord, Roles } from "./landing-sections";

export function Landing() {
  const { status, me } = useSession();
  const router = useRouter();
  // A signed-in person never sees the landing: alert links to "/" open their current company.
  useEffect(() => {
    if (status !== "signedIn" || !me.data) return;
    const open = me.data.home.openCompanyId;
    const slug = me.data.companies.find((c) => c.companyId === open)?.slug;
    router.replace(slug ? `/c/${slug}` : "/home");
  }, [status, me.data, router]);

  // the hole sits to the right of the copy on wide screens and above it on phones
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const view: { offset: [number, number]; zoom: number } = wide ? { offset: [0.42, 0.02], zoom: 0.6 } : { offset: [0, 0.5], zoom: 0.7 };

  return (
    <div className="bg-void">
      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <Mark size={30} /> BuilderOS
          {IS_TESTNET ? <Chip className="ml-1">Testnet</Chip> : null}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <a href="#how" className="hidden rounded-full px-3 py-2 text-ink-2 hover:text-ink sm:block">
            How it works
          </a>
          <LinkButton href="/demo" variant="ghost" size="sm">
            See a demo
          </LinkButton>
        </nav>
      </header>

      <main id="main">
        <section aria-labelledby="hero-title" className="relative isolate flex min-h-[100dvh] flex-col justify-end overflow-hidden lg:justify-center">
          {/* The company as a black hole: the budget is its mass, teams orbit it, and the cap is the horizon. */}
          <Singularity scrollTilt interactive mass={0.85} className="absolute inset-0 -z-10 size-full" offset={view.offset} zoom={view.zoom} />
          <Orbits interactive className="absolute inset-0 -z-10 size-full" offset={view.offset} zoom={view.zoom} />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-void via-void/50 to-transparent lg:bg-gradient-to-r lg:from-void lg:via-void/55 lg:to-transparent" />
          <div className="mx-auto w-full max-w-6xl px-4 pt-[46vh] pb-10 sm:px-8 lg:pt-24 lg:pb-16">
            <div className="animate-rise max-w-[640px]">
              <h1 id="hero-title" className="text-[40px] leading-[1.06] font-semibold tracking-[-0.03em] sm:text-[56px]">
                <span className="block">Describe a product.</span>
                <span className="whitespace-nowrap">
                  AI <RollingWord words={["teams", "agents"]} />
                </span>{" "}
                build and run it.
              </h1>
              <p className="mt-5 max-w-[48ch] text-lg text-ink-2">Every team spends from a budget enforced by smart contracts. You approve anything unusual, see what each team did, and can pause it all in one tap.</p>
              <div id="sign-in" className="mt-8 max-w-[380px] scroll-mt-24">
                <SignInButtons />
                <p className="mt-4 text-sm text-ink-3">
                  No company form first.{" "}
                  <Link href="/demo" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ember">
                    See a sample company
                  </Link>
                </p>
              </div>
            </div>
          </div>
          <p className="absolute right-8 bottom-8 hidden max-w-[30ch] text-right text-[13px] leading-relaxed text-ink-3 lg:block">The budget is the mass. Teams orbit it. The spending cap is the horizon: nothing gets past it.</p>
        </section>

        <Facts />
        <Flow />

        <section aria-labelledby="control-title" className="border-y border-line bg-bg">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <h2 id="control-title" className="max-w-[18ch] text-3xl leading-tight font-semibold sm:text-[40px]">
                Agents spend. The contract holds the line.
              </h2>
              <ul className="mt-8 space-y-6 text-ink-2">
                {[
                  ["shield", "Budgets live on chain", "Each team has a monthly budget, a per-purchase limit and a shared daily cap. Agents can't exceed them, even if something goes wrong."],
                  ["key", "Your wallet signs, nothing else moves money", "BuilderOS prepares transactions; only your signature makes them real."],
                  ["teams", "You choose who sees what", "Invite a viewer, an approver or a builder for one team. They see that team and nothing more."],
                ].map(([icon, title, body]) => (
                  <li key={title} className="flex gap-4">
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border border-line-strong text-ember">
                      <Icon name={icon} />
                    </span>
                    <div>
                      <h3 className="font-sans text-base font-semibold tracking-normal text-ink">{title}</h3>
                      <p className="mt-1">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {/* a real fragment of the dashboard, drawn with the product's own components */}
            <div className="panel p-5 sm:p-6" aria-label="Example of the money view">
              <div className="flex flex-wrap items-center gap-6">
                <HorizonGauge pct={62} label="$9.30" sub="of $15.00 today" />
                <div className="min-w-48 flex-1 space-y-4">
                  {[
                    ["build", "248000000", "3200000", "400000000", "var(--color-s1)"],
                    ["ops", "61000000", "1500000", "120000000", "var(--color-s2)"],
                    ["growth", "88000000", "0", "150000000", "var(--color-s3)"],
                  ].map(([team, spent, reserved, budget, color]) => (
                    <div key={team}>
                      <div className="mb-1.5 flex justify-between text-sm">
                        <span>{team}</span>
                        <span className="num text-ink-2">
                          ${Number(spent) / 1e6} of ${Number(budget) / 1e6}
                        </span>
                      </div>
                      <BudgetBar spent={spent} reserved={reserved} budget={budget} color={color} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 rounded-[12px] border border-amber/30 bg-amber-wash px-4 py-3 text-sm">
                <span>
                  <strong className="font-semibold">ops</strong> wants to pay a new seller <span className="num">$2.40</span>
                </span>
                <Chip tone="amber">Waiting on you</Chip>
              </div>
            </div>
          </div>
        </section>

        <PurchasePath />
        <ReportAnatomy />
        <Roles />

        <section className="mx-auto flex max-w-6xl flex-col items-start gap-6 border-t border-line px-4 py-20 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <h2 className="max-w-[22ch] text-2xl leading-tight font-semibold sm:text-3xl">Look around a company that's already running.</h2>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/demo" size="lg" icon="play">
              Open the sample company
            </LinkButton>
            <LinkButton href="#sign-in" size="lg" variant="primary">
              Start building
            </LinkButton>
          </div>
        </section>
      </main>
      <footer className="border-t border-line px-4 py-8 text-[13px] text-ink-3 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Mark size={20} /> BuilderOS{IS_TESTNET ? ", running on NEAR testnet. Testnet funds have no value." : ""}
          </span>
          <Link href="/demo" className="hover:text-ink">
            Sample company
          </Link>
        </div>
      </footer>
    </div>
  );
}
