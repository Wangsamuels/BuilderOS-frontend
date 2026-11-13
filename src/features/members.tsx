"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { endpoints } from "@/api/endpoints";
import type { Member } from "@/api/types";
import { useSession } from "@/auth/session";
import { Async, Button, Chip, Dialog, Empty, Field, Icon, Input, LinkButton, NotAvailable, Notice, PageHeader, Panel, Select, SkeletonRows } from "@/components/ui";
import { useMembers, useWorkspace } from "@/data/workspace";
import { can } from "@/lib/access";
import { ago, shortAccount, teamOf, titleCase } from "@/lib/format";
import { pollUntil } from "@/wallet/signing";
import { useWrite, WriteError } from "./write";

const ROLES = [
  { id: "viewer", label: "Viewer", can: "Sees budgets, spending and reports." },
  { id: "approver", label: "Approver", can: "Sees money and decides purchases that are waiting." },
  { id: "builder", label: "Builder", can: "Sees plans, tasks and code, and adds plans." },
  { id: "admin", label: "Admin", can: "Everything except inviting, removing and resuming." },
] as const;

function roleOfMember(m: Member): { label: string; tone: "ember" | "neutral" } {
  if (m.role === "founder") return { label: "Founder", tone: "ember" };
  const s = (m.scopes ?? []) as string[];
  if (s.includes("admin")) return { label: "Admin", tone: "neutral" };
  if (s.includes("builder") || s.includes("code")) return { label: "Builder", tone: "neutral" };
  if (s.includes("approve")) return { label: "Approver", tone: "neutral" };
  return { label: "Viewer", tone: "neutral" };
}

function Invite({ onClose }: { onClose: () => void }) {
  const w = useWorkspace();
  const { run, error, pending } = useWrite();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]["id"]>("viewer");
  const [team, setTeam] = useState("");
  const [days, setDays] = useState("30");
  const valid = /.+@.+\..+/.test(email);
  const send = async () => {
    const ok = await run({
      title: "Invite a member",
      summary: (
        <>
          {email} joins as {role}
          {team ? ` on the ${team} team` : " across all teams"}. The invite email goes out once your wallet has signed.
        </>
      ),
      // an admin is company-wide by definition; everyone else can be limited to one team
      request: (key) => endpoints.invite({ companyId: w.slug, email: email.trim(), template: role, departments: team && role !== "admin" ? [team] : w.teamNames, expiresInDays: Number(days) }, key),
      areas: ["members"],
      done: "Invite sent",
    });
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite a member"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button action variant="primary" disabled={!valid} loading={Boolean(pending)} onClick={() => void send()} data-testid="send-invite">Send invite</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), valid && void send())}>
        <Field label="Email">
          {(p) => <Input {...p} type="email" autoComplete="off" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" data-testid="invite-email" />}
        </Field>
        <Field label="Role" hint={ROLES.find((r) => r.id === role)?.can}>
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as typeof role)} data-testid="invite-role">
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Team" hint={role === "admin" ? "Admins always cover every team." : undefined}>
            {(p) => (
              <Select {...p} value={role === "admin" ? "" : team} disabled={role === "admin"} onChange={(e) => setTeam(e.target.value)} data-testid="invite-team">
                <option value="">All teams</option>
                {w.teamNames.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Invite expires in">
            {(p) => (
              <Select {...p} value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </Select>
            )}
          </Field>
        </div>
        <WriteError error={error} feature="Inviting" />
      </form>
    </Dialog>
  );
}

export function MembersPage() {
  const w = useWorkspace();
  const { me } = useSession();
  const q = useMembers();
  const { run, pending } = useWrite();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [rotate, setRotate] = useState(false);
  const roleEdit = useMutation({ mutationFn: (accountId: string) => endpoints.editGrants(accountId, w.slug) });
  const founder = can.founder(w.access);

  const remove = async (m: Member) => {
    const ok = await run({
      title: "Remove member",
      summary: `${shortAccount(m.account_id)} loses access to ${w.company?.company.name ?? "this company"} as soon as the chain confirms.`,
      request: (key) => endpoints.removeMember(m.account_id, w.slug, key),
      areas: ["members"],
      done: "Member removed",
      confirm: () => pollUntil(async () => !(await endpoints.members(w.slug)).members.some((x) => x.account_id === m.account_id && !x.revoked), { timeout: 15_000 }),
    });
    setRemoving(null);
    if (ok) setRotate(true);
  };

  return (
    <>
      <PageHeader
        title="Members"
        sub={founder ? "People who can see or act in this company. Access lives on chain and is checked on every request." : "Your access to this company."}
        actions={founder || w.demo ? <Button action variant="primary" icon="plus" onClick={() => setInviting(true)} data-testid="invite-member">Invite member</Button> : null}
      />
      <Panel aria-label="Members">
        <Async q={q} skeleton={<div className="p-5"><SkeletonRows /></div>} empty={(d) => !d.members.length && <Empty icon="members" title="No members yet" body="Invite someone to view, approve or build with you." />}>
          {(d) => (
            <ul className="divide-y divide-line">
              {d.members.filter((m) => !m.revoked).map((m) => {
                const r = roleOfMember(m);
                const self = m.account_id === me.data?.accountId;
                return (
                  <li key={m.account_id} data-testid="member-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-void font-display text-xs font-semibold text-ink-2">{m.account_id.slice(0, 2).toUpperCase()}</span>
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="truncate text-sm font-medium" title={m.account_id}>
                        {shortAccount(m.account_id)} {self ? <span className="font-normal text-ink-3">(you)</span> : null}
                      </div>
                      <div className="text-[13px] text-ink-3">
                        {m.department_id ? `${titleCase(teamOf(m.department_id))} team only` : "All teams"}
                        {m.expires_at ? ` · access ends ${ago(m.expires_at)}` : ""}
                        {m.has_view_key ? " · device registered" : ""}
                      </div>
                    </div>
                    <Chip tone={r.tone}>{r.label}</Chip>
                    {d.canManage && r.label !== "Founder" && !self ? (
                      <span className="flex gap-2">
                        <Button size="sm" variant="ghost" loading={roleEdit.isPending && roleEdit.variables === m.account_id} onClick={() => roleEdit.mutate(m.account_id)} data-testid="change-role">Change role</Button>
                        <Button action size="sm" variant="danger" onClick={() => setRemoving(m)} data-testid="remove-member">Remove</Button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Async>
      </Panel>
      {roleEdit.error ? (
        <div className="mt-4 space-y-2" data-testid="role-edit-unavailable">
          <NotAvailable error={roleEdit.error} title="Changing a role" />
          <p className="text-[13px] text-ink-3">Access is written on chain when someone joins, so it can't be edited in place. Remove the member, then invite them again with the new role.</p>
        </div>
      ) : null}
      {!founder && !w.demo ? <p className="mt-4 flex items-center gap-2 text-[13px] text-ink-3"><Icon name="lock" /> Only the founder can see the full list, invite or remove members.</p> : null}

      {inviting ? <Invite onClose={() => setInviting(false)} /> : null}
      <Dialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remove this member?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>Keep member</Button>
            <Button action variant="danger" loading={Boolean(pending)} onClick={() => removing && void remove(removing)} data-testid="confirm-remove">Remove member</Button>
          </>
        }
      >
        <p className="text-ink-2"><span className="text-ink">{shortAccount(removing?.account_id)}</span> will lose access right away. To change someone's role, remove them and invite them again.</p>
      </Dialog>
      <Dialog
        open={rotate}
        onClose={() => setRotate(false)}
        title="Rotate the code key?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRotate(false)}>Not now</Button>
            <LinkButton href={`${w.base}/settings#rotate`} variant="primary">Open key rotation</LinkButton>
          </>
        }
      >
        <div data-testid="rotate-prompt"><Notice tone="amber">The member is removed, but their device may still hold the old code key. Rotating gives everyone who's left a new key and makes the old one useless for new code.</Notice></div>
      </Dialog>
    </>
  );
}
