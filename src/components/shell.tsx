"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { endpoints } from "@/api/endpoints";
import type { Access, Membership } from "@/api/types";
import { useSession } from "@/auth/session";
import { can, roleOf } from "@/lib/access";
import { cx, shortAccount } from "@/lib/format";
import { useStreamStatus } from "@/stream/stream";
import { Mark } from "./singularity";
import { Button, Chip, Icon, LinkButton } from "./ui";

/* ---------- popover menu ---------- */
export function Menu({ trigger, children, align = "left", label, testid }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; label: string; testid?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", off);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", off);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} data-testid={testid} onClick={() => setOpen((v) => !v)} className="flex items-center rounded-full">
        {trigger(open)}
      </button>
      {open ? (
        <div role="menu" className={cx("animate-rise absolute top-[calc(100%+8px)] z-50 w-[min(320px,calc(100vw-24px))] rounded-[14px] border border-line-strong bg-raised p-1.5 shadow-[0_24px_80px_#000c]", align === "right" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
const item = "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm text-ink hover:bg-hover";

/* ---------- top bar ---------- */
function Switcher({ current }: { current?: { slug: string; name: string } }) {
  const { me } = useSession();
  const router = useRouter();
  const companies = me.data?.companies ?? [];
  return (
    <Menu
      label="Switch company"
      testid="company-switcher"
      trigger={(open) => (
        <span className={cx("flex h-9 max-w-[46vw] items-center gap-2 rounded-full border border-line-strong pr-2.5 pl-3 text-sm font-medium transition-colors sm:max-w-64", open ? "bg-hover" : "bg-raised hover:bg-hover")}>
          <span className="truncate">{current?.name ?? "Home"}</span>
          <Icon name="chevron" size={14} className="text-ink-3" />
        </span>
      )}
    >
      {(close) => (
        <>
          <Link role="menuitem" href="/home" onClick={close} className={item}>
            <Icon name="home" className="text-ink-3" /> Home
          </Link>
          {companies.length ? <div className="mx-3 my-1.5 h-px bg-line" /> : null}
          <div className="max-h-[50vh] overflow-y-auto">
            {companies.map((c: Membership) => (
              <button
                key={c.companyId}
                role="menuitem"
                type="button"
                className={cx(item, c.slug === current?.slug && "bg-hover")}
                onClick={() => {
                  close();
                  // remembers what Home opens next time; it never decides access
                  void endpoints.setPreferences({ lastCompanyId: c.companyId }).catch(() => {});
                  router.push(`/c/${c.slug}`);
                }}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-void font-display text-xs font-semibold text-ember">{c.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <Chip tone={c.isFounder ? "ember" : "neutral"}>{roleOf(c)}</Chip>
              </button>
            ))}
          </div>
          <div className="mx-3 my-1.5 h-px bg-line" />
          <Link role="menuitem" href="/drafts/new" onClick={close} className={cx(item, "text-ember")}>
            <Icon name="plus" /> New product
          </Link>
        </>
      )}
    </Menu>
  );
}

function InboxLink() {
  const { status } = useSession();
  const q = useQuery({ queryKey: ["inbox"], queryFn: endpoints.inbox, enabled: status === "signedIn", staleTime: 15_000 });
  const n = q.data?.unread ?? 0;
  return (
    <Link href="/inbox" aria-label={n ? `Inbox, ${n} unread` : "Inbox"} data-testid="inbox-link" className="relative grid size-9 place-items-center rounded-full text-ink-2 hover:bg-raised hover:text-ink">
      <Icon name="inbox" size={18} />
      {n ? (
        <span data-testid="inbox-badge" className="num absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ember px-1 text-[11px] font-semibold text-[#1a1206]">
          {n > 99 ? "99+" : n}
        </span>
      ) : null}
    </Link>
  );
}

function AccountMenu() {
  const { me, signOut } = useSession();
  const id = me.data?.accountId ?? "";
  return (
    <Menu
      label="Account menu"
      align="right"
      testid="account-menu"
      trigger={() => <span className="grid size-9 place-items-center rounded-full border border-line-strong bg-raised font-display text-xs font-semibold text-ink hover:bg-hover">{(me.data?.email?.address ?? id).slice(0, 2).toUpperCase() || "··"}</span>}
    >
      {(close) => (
        <>
          <div className="px-3 py-2.5">
            <div className="truncate text-sm font-medium" title={id}>
              {shortAccount(id)}
            </div>
            <div className="truncate text-[13px] text-ink-3">{me.data?.email?.address ?? "No email yet"}</div>
          </div>
          <div className="mx-3 my-1 h-px bg-line" />
          <Link role="menuitem" href="/account" onClick={close} className={item}>
            <Icon name="members" className="text-ink-3" /> Account
          </Link>
          <button role="menuitem" type="button" className={item} onClick={() => void signOut()}>
            <Icon name="logout" className="text-ink-3" /> Sign out
          </button>
        </>
      )}
    </Menu>
  );
}

export function TopBar({ company, demo }: { company?: { slug: string; name: string }; demo?: boolean }) {
  const { syncing } = useStreamStatus();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-3 backdrop-blur-md sm:px-5">
      <Link href={demo ? "/" : "/home"} aria-label="BuilderOS home" className="flex items-center gap-2 font-display font-semibold">
        <Mark />
        <span className="hidden sm:inline">BuilderOS</span>
      </Link>
      {demo ? <Chip tone="ember">Sample company</Chip> : <Switcher current={company} />}
      {syncing ? (
        <span className="flex items-center gap-1.5 text-xs text-ink-3" title="Catching up with the chain">
          <span className="size-1.5 rounded-full bg-amber" style={{ animation: "pulse-dot 1.2s ease-in-out infinite" }} />
          <span className="hidden sm:inline">Syncing</span>
        </span>
      ) : null}
      <div className="flex-1" />
      {demo ? (
        <LinkButton href="/" variant="primary" size="sm">
          Sign in to build yours
        </LinkButton>
      ) : (
        <>
          <InboxLink />
          <AccountMenu />
        </>
      )}
    </header>
  );
}

/* ---------- workspace navigation ---------- */
export type NavItem = { key: string; label: string; icon: string; href: string; badge?: number };
export function workspaceNav(base: string, access: Access, pendingApprovals?: number): NavItem[] {
  return [
    { key: "", label: "Dashboard", icon: "dashboard", href: base, show: true },
    { key: "teams", label: "Teams", icon: "teams", href: `${base}/teams`, show: true },
    { key: "work", label: "Work", icon: "work", href: `${base}/work`, show: can.work(access) },
    { key: "approvals", label: "Approvals", icon: "approvals", href: `${base}/approvals`, show: can.approve(access), badge: pendingApprovals },
    { key: "money", label: "Money", icon: "money", href: `${base}/money`, show: can.money(access) },
    { key: "members", label: "Members", icon: "members", href: `${base}/members`, show: true },
    { key: "settings", label: "Settings", icon: "settings", href: `${base}/settings`, show: true },
  ]
    .filter((i) => i.show)
    .map(({ show: _show, ...i }) => i);
}
const activeKey = (pathname: string, base: string) => {
  const seg = pathname.slice(base.length).split("/").filter(Boolean)[0] ?? "";
  return seg === "reports" ? "teams" : seg;
};

export function Sidebar({ items, base }: { items: NavItem[]; base: string }) {
  const active = activeKey(usePathname(), base);
  return (
    <nav aria-label="Company" className="sticky top-14 hidden h-[calc(100dvh-56px)] w-56 shrink-0 flex-col gap-0.5 border-r border-line p-3 md:flex">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={active === i.key ? "page" : undefined} className={cx("flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors", active === i.key ? "bg-raised font-medium text-ink shadow-[inset_0_1px_0_#ffffff0f]" : "text-ink-2 hover:bg-raised/60 hover:text-ink")}>
          <Icon name={i.icon} className={active === i.key ? "text-ember" : "text-ink-3"} />
          <span className="flex-1">{i.label}</span>
          {i.badge ? (
            <span data-testid="approvals-badge" className="num grid h-5 min-w-5 place-items-center rounded-full bg-ember px-1.5 text-[11px] font-semibold text-[#1a1206]">
              {i.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/** Phones get a bottom bar with the four most-used areas and a sheet for the rest. */
export function MobileNav({ items, base }: { items: NavItem[]; base: string }) {
  const pathname = usePathname();
  const active = activeKey(pathname, base);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [pathname]);
  const primary = items.filter((i) => ["", "teams", "approvals", "money"].includes(i.key)).slice(0, 4);
  const rest = items.filter((i) => !primary.includes(i));
  const tab = "relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px]";
  return (
    <>
      {more ? (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-0 bg-void/70" />
          <div className="animate-rise absolute inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] rounded-[16px] border border-line-strong bg-raised p-1.5">
            {rest.map((i) => (
              <Link key={i.key} href={i.href} className={item}>
                <Icon name={i.icon} className="text-ink-3" /> {i.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <nav aria-label="Company" className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {primary.map((i) => (
          <Link key={i.key} href={i.href} aria-current={active === i.key ? "page" : undefined} className={cx(tab, active === i.key ? "text-ember" : "text-ink-3")}>
            <Icon name={i.icon} size={20} />
            {i.label}
            {i.badge ? <span className="absolute top-2 left-[calc(50%+6px)] size-2 rounded-full bg-ember" /> : null}
          </Link>
        ))}
        {rest.length ? (
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className={cx(tab, rest.some((i) => i.key === active) ? "text-ember" : "text-ink-3")}>
            <Icon name="more" size={20} />
            More
          </button>
        ) : null}
      </nav>
    </>
  );
}

/** Account-level pages (home, inbox, drafts, account): top bar and a centered column. */
export function AccountShell({ children, width = "max-w-5xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="min-h-dvh">
      <TopBar />
      <main id="main" className={cx("mx-auto px-4 py-7 sm:px-6 sm:py-10", width)}>
        {children}
      </main>
    </div>
  );
}

export function PausedBanner({ founder, onResume }: { founder: boolean; onResume: () => void }) {
  return (
    <div role="status" data-testid="paused-banner" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-blue/30 bg-blue-wash px-4 py-2.5 text-sm sm:px-6">
      <Mark size={22} paused />
      <span className="min-w-0 flex-1 text-ink">
        <strong className="font-semibold">All spending is paused.</strong> {founder ? "Agents can't buy anything until you resume." : "Paused by the founder."}
      </span>
      {founder ? (
        <Button size="sm" variant="primary" icon="play" action onClick={onResume}>
          Resume
        </Button>
      ) : null}
    </div>
  );
}
export const DemoRibbon = () => (
  <div data-testid="demo-ribbon" className="border-b border-ember/25 bg-ember-wash px-4 py-2 text-center text-[13px] text-ink sm:px-6">
    Sample company with invented data, read-only.{" "}
    <Link href="/" className="font-medium text-ember underline decoration-ember/40 underline-offset-4">
      Sign in to build yours
    </Link>
  </div>
);
