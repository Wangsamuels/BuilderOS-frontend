"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, type ReactNode } from "react";
import { isApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { DemoRibbon, MobileNav, PausedBanner, Sidebar, TopBar, workspaceNav } from "@/components/shell";
import { Mark } from "@/components/singularity";
import { ErrorState, LinkButton, ReadOnlyProvider, Skeleton } from "@/components/ui";
import { accessFrom, useCompany, useDemoBundle, useWorkspace, WorkspaceProvider, type Workspace } from "@/data/workspace";
import { can } from "@/lib/access";
import { pollUntil } from "@/wallet/signing";
import { AuthGate } from "./auth";
import { parseRange } from "./dashboard";
import { useWrite } from "./write";

/** The company isn't the person's to open (403), or doesn't exist (404). The server decided; we only say so. */
function Closed({ notFound }: { notFound: boolean }) {
  return (
    <main id="main" className="grid min-h-[70dvh] place-items-center px-4">
      <div className="max-w-md text-center" data-testid="company-closed">
        <Mark size={44} paused className="mx-auto mb-5" />
        <h1 className="text-2xl font-semibold">{notFound ? "This company doesn't exist" : "You don't have access to this company"}</h1>
        <p className="mt-2 text-ink-2">{notFound ? "Check the link, or pick a company from your home." : "Access is granted by the founder. Ask them for an invite, then open the link in the email."}</p>
        <LinkButton href="/home" variant="primary" className="mt-6">
          Go to your home
        </LinkButton>
      </div>
    </main>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const w = useWorkspace();
  const approver = can.approve(w.access);
  // the hook is always called; it only fetches for people whose grant covers approvals
  const approvals = useApprovalsWhen(approver);
  const { run } = useWrite();
  const items = useMemo(() => workspaceNav(w.base, w.access, approvals), [w.base, w.access, approvals]);
  const frozen = Boolean(w.company?.company.frozen || w.company?.chain?.frozen);
  const resume = () =>
    void run({
      title: "Resume spending",
      summary: "Agents can buy again within their team budgets and the daily cap.",
      request: (key) => endpoints.unfreeze(w.slug, key),
      areas: ["company", "teams", "analytics"],
      done: "Spending resumed",
      confirm: () => pollUntil(async () => !(await endpoints.company(w.slug)).company.frozen, { timeout: 15_000 }),
    });
  return (
    <div className="min-h-dvh">
      <TopBar company={w.company ? { slug: w.slug, name: w.company.company.name } : undefined} demo={w.demo} />
      {w.demo ? <DemoRibbon /> : null}
      {frozen ? <PausedBanner founder={can.founder(w.access) && !w.demo} onResume={resume} /> : null}
      <div className="flex">
        <Sidebar items={items} base={w.base} />
        <main id="main" className="min-w-0 flex-1 px-4 pt-6 pb-28 sm:px-7 sm:pt-8 md:pb-12">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
      </div>
      <MobileNav items={items} base={w.base} />
    </div>
  );
}
/** Pending count for the nav badge. Only asked for when the grant covers approvals; shares the page's cache entry. */
function useApprovalsWhen(on: boolean) {
  const w = useWorkspace();
  const real = useQuery({ queryKey: ["c", w.slug, "approvals"], queryFn: () => endpoints.approvals(w.slug).then((r) => r.cards), enabled: on && !w.demo });
  const demo = useDemoBundle(w.range, on && w.demo);
  return (w.demo ? demo.data?.approvals.length : real.data?.length) || undefined;
}

function Frame({ slug, demo, children }: { slug: string; demo: boolean; children: ReactNode }) {
  const range = parseRange(useSearchParams().get("range"));
  const q = useCompany(slug, demo, range);
  const value = useMemo<Workspace>(
    () => ({ slug: q.data?.slug ?? slug, base: demo ? "/demo" : `/c/${slug}`, demo, range, company: q.data, access: accessFrom(q.data), teamNames: (q.data?.departments ?? []).map((d) => d.name) }),
    [q.data, slug, demo, range],
  );
  if (q.error && !q.data) {
    const closed = isApiError(q.error) && (q.error.status === 403 || q.error.status === 404);
    return (
      <div className="min-h-dvh">
        <TopBar demo={demo} />
        {closed ? <Closed notFound={isApiError(q.error) && q.error.status === 404} /> : <div className="mx-auto max-w-xl p-6"><ErrorState error={q.error} retry={() => q.refetch()} /></div>}
      </div>
    );
  }
  if (!q.data)
    return (
      <div className="min-h-dvh" role="status" aria-label="Loading company">
        <div className="h-14 border-b border-line" />
        <div className="mx-auto max-w-[1180px] space-y-4 p-6">
          <Skeleton className="h-9 w-56" />
          <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  return (
    <WorkspaceProvider value={value}>
      <ReadOnlyProvider value={demo}>
        <Chrome>{children}</Chrome>
      </ReadOnlyProvider>
    </WorkspaceProvider>
  );
}

/** Wraps every company page. The demo uses the same frame, fed from the public sample payload. */
export function WorkspaceFrame({ slug, demo = false, children }: { slug: string; demo?: boolean; children: ReactNode }) {
  const frame = (
    <Suspense>
      <Frame slug={slug} demo={demo}>{children}</Frame>
    </Suspense>
  );
  return demo ? frame : <AuthGate>{frame}</AuthGate>;
}

