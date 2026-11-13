"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { endpoints } from "@/api/endpoints";
import { useSession } from "@/auth/session";
import { AccountShell } from "@/components/shell";
import { Async, Button, Chip, CopyButton, Dl, Notice, PageHeader, Panel, Skeleton } from "@/components/ui";
import { near } from "@/lib/money";
import { EmailVerify } from "./launch";

export function AccountPage() {
  const { signOut, me } = useSession();
  const q = useQuery({ queryKey: ["account"], queryFn: endpoints.account });
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  return (
    <AccountShell width="max-w-2xl">
      <PageHeader title="Account" />
      <Async q={q} skeleton={<div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>}>
        {(a) => (
          <div className="space-y-4">
            <Panel aria-label="Sign-in" className="px-5 py-3">
              <h2 className="pt-1 pb-1 text-[15px] font-semibold">Sign-in</h2>
              <Dl
                rows={[
                  ["Method", a.loginMethod === "privy" ? "Google or email" : "NEAR wallet"],
                  ["Account", <span key="a" className="inline-flex max-w-full items-center gap-2"><span className="num truncate" title={a.accountId} data-testid="account-id">{a.accountId}</span><CopyButton value={a.accountId} /></span>],
                  ...(me.data ? ([["Wallet balance", `${near(me.data.balance.availableYocto)} NEAR`]] as Array<[string, string]>) : []),
                ]}
              />
            </Panel>

            <Panel aria-label="Email" className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold">Email</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm" data-testid="account-email">
                    {a.email.address ? <span className="num text-ink">{a.email.address}</span> : <span className="text-ink-3">No email yet</span>}
                    {a.email.address ? <Chip tone={a.email.verified ? "green" : "amber"} dot>{a.email.verified ? (a.email.source === "privy" ? "Verified by sign-in" : "Verified") : "Not verified"}</Chip> : null}
                  </p>
                  <p className="mt-1.5 max-w-[56ch] text-[13px] text-ink-3">Approvals and alerts go here. You need a verified email to create a company.</p>
                </div>
                {!editing ? <Button size="sm" onClick={() => setEditing(true)} data-testid="change-email">{a.email.address ? "Change email" : "Add email"}</Button> : null}
              </div>
              {a.email.pending && !editing ? <div className="mt-4"><Notice tone="amber">Waiting for you to confirm {a.email.pending}. Your current address stays active until then.</Notice></div> : null}
              {editing ? (
                <div className="mt-5 border-t border-line pt-5">
                  {a.email.address ? <p className="mb-4 text-[13px] text-ink-3">Your current address stays active until the new one is confirmed.</p> : null}
                  <EmailVerify onVerified={() => setEditing(false)} />
                  <Button variant="ghost" size="sm" className="mt-3" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              ) : null}
            </Panel>

            <Panel aria-label="Session" className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <h2 className="text-[15px] font-semibold">Sign out</h2>
                <p className="mt-0.5 text-[13px] text-ink-3">Sessions last 24 hours. Signing out ends this one right away.</p>
              </div>
              <Button icon="logout" loading={leaving} onClick={() => (setLeaving(true), void signOut())} data-testid="sign-out">Sign out</Button>
            </Panel>
          </div>
        )}
      </Async>
    </AccountShell>
  );
}
