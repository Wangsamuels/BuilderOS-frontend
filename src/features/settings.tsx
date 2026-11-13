"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { isApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { Agent, Team } from "@/api/types";
import { Async, Button, Chip, CopyButton, Dialog, Dl, Empty, Field, Icon, Input, NoAccess, Notice, PageHeader, Panel, PanelHeader, Select, SkeletonRows, useToast } from "@/components/ui";
import { useTeams, useWorkspace } from "@/data/workspace";
import { can } from "@/lib/access";
import { cx, shortAccount, titleCase } from "@/lib/format";
import { createDeviceKey, deviceKey, newCodeKey, sealTo } from "@/wallet/device-keys";
import { pollUntil } from "@/wallet/signing";
import { useWrite, WriteError } from "./write";

const Section = ({ id, children }: { id: string; children: ReactNode }) => (
  <div id={id} className="scroll-mt-20">
    {children}
  </div>
);

/* ---------- agents ---------- */
const AGENT_TONE: Record<string, "green" | "amber" | "red"> = { running: "green", paused: "amber", fired: "red" };

function RegisterAgent({ teams, onClose }: { teams: Team[]; onClose: () => void }) {
  const w = useWorkspace();
  const { run, error, pending } = useWrite();
  const [departmentId, setDepartmentId] = useState(teams[0]?.departmentId ?? "");
  const [publicKey, setPublicKey] = useState("");
  const [role, setRole] = useState("builder");
  const valid = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,}$/.test(publicKey.trim());
  const submit = async () => {
    const ok = await run({
      title: "Register an agent",
      summary: `The agent can work for the ${teams.find((t) => t.departmentId === departmentId)?.name} team and spend from its budget, within the per-purchase limit.`,
      request: (key) => endpoints.registerAgent({ companyId: w.slug, departmentId, publicKey: publicKey.trim(), role }, key),
      areas: ["teams"],
      done: "Agent registered",
    });
    if (ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Register an agent" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button action variant="primary" disabled={!valid || !departmentId} loading={Boolean(pending)} onClick={() => void submit()} data-testid="confirm-agent">Register agent</Button></>}>
      <div className="space-y-4">
        <Field label="Team">
          {(p) => (
            <Select {...p} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              {teams.map((t) => <option key={t.departmentId} value={t.departmentId}>{titleCase(t.name)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Agent public key" hint="The agent's own NEAR key, starting with ed25519:. Never paste a private key." error={publicKey && !valid ? "This doesn't look like a public key (ed25519:…)." : null}>
          {(p) => <Input {...p} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="ed25519:…" className="num" autoComplete="off" spellCheck={false} data-testid="agent-key" />}
        </Field>
        <Field label="Role">
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="builder">Builder</option>
              <option value="reviewer">Reviewer</option>
              <option value="ops">Ops</option>
              <option value="growth">Growth</option>
            </Select>
          )}
        </Field>
        <WriteError error={error} feature="Registering an agent" />
      </div>
    </Dialog>
  );
}

function AgentRow({ a }: { a: Agent }) {
  const w = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const { run, pending } = useWrite();
  const [confirmFire, setConfirmFire] = useState(false);
  // pausing and resuming an agent is a server-side switch: no transaction to sign
  const status = useMutation({
    mutationFn: (s: "running" | "paused") => endpoints.agentStatus(a.publicKey, { companyId: w.slug, status: s }),
    onSuccess: (_r, s) => {
      void qc.invalidateQueries({ queryKey: ["c", w.slug, "teams"] });
      toast(s === "paused" ? "Agent paused" : "Agent resumed", "green");
    },
    onError: (e) => toast(isApiError(e) && e.status === 403 ? "Your access doesn't cover this. Ask the founder." : (e as Error).message, "red"),
  });
  const fire = async () => {
    await run({ title: "Remove the agent", summary: "Its key stops working for this team. This can't be undone; register it again to bring it back.", request: (key) => endpoints.agentStatus(a.publicKey, { companyId: w.slug, status: "fired" }, key), areas: ["teams"], done: "Agent removed" });
    setConfirmFire(false);
  };
  return (
    <li data-testid="agent-row" className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <Icon name="spark" className="text-ink-3" />
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate text-sm font-medium">{titleCase(a.role)}</span>
        <span className="num block truncate text-[13px] text-ink-3" title={a.publicKey}>{shortAccount(a.publicKey.replace(/^ed25519:/, ""))}</span>
      </span>
      <Chip tone={AGENT_TONE[a.status] ?? "green"} dot>{titleCase(a.status)}</Chip>
      {a.status !== "fired" ? (
        <span className="flex gap-2">
          <Button action size="sm" icon={a.status === "paused" ? "play" : "pause"} loading={status.isPending} onClick={() => status.mutate(a.status === "paused" ? "running" : "paused")} data-testid="agent-toggle">{a.status === "paused" ? "Resume" : "Pause"}</Button>
          <Button action size="sm" variant="danger" onClick={() => setConfirmFire(true)} data-testid="agent-fire">Remove</Button>
        </span>
      ) : null}
      <Dialog open={confirmFire} onClose={() => setConfirmFire(false)} title="Remove this agent?" footer={<><Button variant="ghost" onClick={() => setConfirmFire(false)}>Keep agent</Button><Button action variant="danger" loading={Boolean(pending)} onClick={() => void fire()} data-testid="confirm-fire">Remove agent</Button></>}>
        <p className="text-ink-2">The agent's key is removed from the team contract, so it can no longer spend or report. To stop it for a while instead, pause it.</p>
      </Dialog>
    </li>
  );
}

function Agents() {
  const teams = useTeams();
  const [open, setOpen] = useState(false);
  return (
    <Panel aria-label="Agents">
      <PanelHeader title="Agents" hint="Each agent has its own key and works for one team." action={<Button action size="sm" icon="plus" onClick={() => setOpen(true)} disabled={!teams.data?.length} data-testid="register-agent">Register agent</Button>} />
      <Async q={teams} skeleton={<div className="px-5 pb-5"><SkeletonRows rows={3} /></div>}>
        {(ts) => (
          <div className="divide-y divide-line border-t border-line">
            {ts.map((t) => (
              <div key={t.departmentId} className="px-5 py-3">
                <h3 className="font-sans text-[13px] font-medium tracking-normal text-ink-3">{titleCase(t.name)} team</h3>
                {t.agents.length ? <ul className="divide-y divide-line/60">{t.agents.map((a) => <AgentRow key={a.publicKey} a={a} />)}</ul> : <p className="py-2 text-sm text-ink-3">No agents yet.</p>}
              </div>
            ))}
            {!ts.length ? <Empty icon="spark" title="No teams yet" body="Agents are registered to a team." /> : null}
          </div>
        )}
      </Async>
      {open && teams.data ? <RegisterAgent teams={teams.data} onClose={() => setOpen(false)} /> : null}
    </Panel>
  );
}

/* ---------- payment setup ---------- */
function Payments() {
  const w = useWorkspace();
  const q = useQuery({ queryKey: ["c", w.slug, "payments"], queryFn: () => endpoints.payments(w.slug).then((r) => r.teams), enabled: !w.demo });
  const { run, error, pending } = useWrite();
  if (w.demo) return null;
  const configure = () =>
    void run({ title: "Configure payments", summary: "Sets each team's payment address so its agents can pay sellers in USDC.", request: (key) => endpoints.configurePayments(w.slug, key), areas: ["payments", "teams", "deposit"], done: "Payments configured" });
  return (
    <Panel aria-label="Payment setup">
      <PanelHeader title="Payment setup" hint="The address each team pays from. Fund these on the Money page." action={<Button action size="sm" loading={Boolean(pending)} onClick={configure} data-testid="configure-payments">Configure</Button>} />
      {error ? <div className="px-5 pb-4"><WriteError error={error} feature="Payment setup" /></div> : null}
      <Async q={q} skeleton={<div className="px-5 pb-5"><SkeletonRows rows={2} /></div>}>
        {(ts) => (
          <ul className="divide-y divide-line border-t border-line">
            {ts.map((t) => (
              <li key={t.departmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <span className="w-24 font-medium">{titleCase(t.name)}</span>
                <span className="num min-w-0 flex-1 basis-56 text-[13px] break-all text-ink-2">{t.address ?? "No address yet"}</span>
                <Chip tone={t.configured ? "green" : "amber"} dot>{t.configured ? "Ready" : "Needs setup"}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </Panel>
  );
}

/* ---------- device keys and rotation ---------- */
function DeviceKeys() {
  const w = useWorkspace();
  const { run, error, pending } = useWrite();
  const [key, setKey] = useState<{ publicKey: string } | null>(null);
  const [registered, setRegistered] = useState(false);
  useEffect(() => setKey(deviceKey(w.slug)), [w.slug]);
  const register = async () => {
    const k = key ?? createDeviceKey(w.slug);
    setKey(k);
    const ok = await run({
      title: "Register this device",
      summary: "Records this browser's public key on chain so private code can be shared with it. The private half stays in this browser.",
      request: (idem) => endpoints.registerViewKey({ companyId: w.slug, x25519PublicKey: k.publicKey }, idem),
      areas: ["members", "devices"],
      done: "Device registered",
      // the server checks the transaction on chain; it can take a couple of seconds to be visible
      confirm: (_r, hashes) => pollUntil(() => endpoints.confirmViewKey({ companyId: w.slug, txHash: hashes[0] }).then(() => true, (e) => (isApiError(e, "tx_not_found") ? false : Promise.reject(e))), { timeout: 20_000 }),
    });
    if (ok) setRegistered(true);
  };
  return (
    <Panel aria-label="Device keys" className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">This device</h2>
          <p className="mt-0.5 max-w-[60ch] text-[13px] text-ink-3">Private code is encrypted to registered devices. Register this browser to read it here.</p>
        </div>
        <Button action size="sm" icon="key" loading={Boolean(pending)} onClick={() => void register()} data-testid="register-device">{key ? "Register again" : "Register this device"}</Button>
      </div>
      {key ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-void/60 px-3.5 py-3">
          <span className="num min-w-0 flex-1 text-[13px] break-all text-ink-2" data-testid="device-key">{key.publicKey}</span>
          {registered ? <Chip tone="green" dot>Registered</Chip> : null}
          <CopyButton value={key.publicKey} />
        </div>
      ) : null}
      {error ? <div className="mt-4"><WriteError error={error} feature="Registering a device" /></div> : null}
    </Panel>
  );
}

const ROTATE_STEPS = ["Sign the rotation", "Read the registered devices", "Wrap a new key to each device", "Store the wrapped keys"];
function RotateKey() {
  const w = useWorkspace();
  const { run, error, pending } = useWrite();
  const [step, setStep] = useState(-1);
  const [fail, setFail] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const rotate = async () => {
    setFail(null);
    setDone(null);
    setStep(0);
    const out = await run({
      title: "Rotate the code key",
      summary: "Everyone still in the company gets a new key. Removed members can't read anything written after this.",
      request: (key) => endpoints.rotateCodeKey(w.slug, key),
      areas: ["company", "devices"],
      done: "Rotation signed",
    });
    if (!out) return setStep(-1);
    try {
      const version = out.result.newVersion;
      setStep(1);
      const { devices } = await endpoints.devices(w.slug);
      if (!devices.length) throw new Error("No devices are registered yet. Register this device first, then rotate.");
      setStep(2);
      const fresh = newCodeKey();
      const keys = devices.map((d) => ({ memberAccount: d.accountId, ciphertext: sealTo(fresh, d.x25519PublicKey) }));
      fresh.fill(0);
      setStep(3);
      // refused with version_conflict until the chain shows the new version
      await pollUntil(() => endpoints.storeWrapped({ companyId: w.slug, kind: "code", version, keys }).then(() => true, (e) => (isApiError(e, "version_conflict") ? false : Promise.reject(e))), { timeout: 20_000 });
      setStep(4);
      setDone(devices.length);
    } catch (e) {
      setFail(e instanceof Error ? e.message : "Rotation didn't finish.");
    }
  };
  return (
    <Panel aria-label="Rotate the code key" className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Rotate the code key</h2>
          <p className="mt-0.5 max-w-[60ch] text-[13px] text-ink-3">Do this after removing a member. Current key version: <span className="num text-ink-2">{w.company?.chain?.code_key_version ?? 0}</span>.</p>
        </div>
        <Button action size="sm" icon="refresh" loading={Boolean(pending) || (step >= 0 && step < 4 && !fail)} onClick={() => void rotate()} data-testid="rotate-key">Rotate key</Button>
      </div>
      {step >= 0 ? (
        <ol className="mt-4 space-y-2" aria-live="polite">
          {ROTATE_STEPS.map((label, i) => (
            <li key={label} className={cx("flex items-center gap-2.5 text-sm", i < step ? "text-ink" : i === step ? "text-ember" : "text-ink-3")}>
              <span className={cx("grid size-5 place-items-center rounded-full border text-[11px]", i < step ? "border-green/50 bg-green-wash text-green" : i === step ? "border-ember/60" : "border-line-strong")}>{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      ) : null}
      {done !== null ? <div className="mt-4" data-testid="rotate-done"><Notice tone="green" icon="check">New key shared with {done} {done === 1 ? "device" : "devices"}.</Notice></div> : null}
      {fail ? <div className="mt-4"><Notice tone="red">{fail} The rotation is safe to run again.</Notice></div> : null}
      {error ? <div className="mt-4"><WriteError error={error} feature="Key rotation" /></div> : null}
    </Panel>
  );
}

/* ---------- pause / resume ---------- */
function Spending() {
  const w = useWorkspace();
  const { run, pending } = useWrite();
  const [confirm, setConfirm] = useState(false);
  const frozen = Boolean(w.company?.company.frozen || w.company?.chain?.frozen);
  const pause = async () => {
    await run({ title: "Pause all spending", summary: "Every team stops buying at once. Work that's already paid for continues.", request: (key) => endpoints.freeze(w.slug, key), areas: ["company", "teams", "analytics"], done: "All spending paused", confirm: () => pollUntil(async () => (await endpoints.company(w.slug)).company.frozen === true, { timeout: 15_000 }) });
    setConfirm(false);
  };
  const resume = () =>
    void run({ title: "Resume spending", summary: "Agents can buy again within their team budgets and the daily cap.", request: (key) => endpoints.unfreeze(w.slug, key), areas: ["company", "teams", "analytics"], done: "Spending resumed", confirm: () => pollUntil(async () => !(await endpoints.company(w.slug)).company.frozen, { timeout: 15_000 }) });
  return (
    <Panel aria-label="Pause and resume" className="flex flex-wrap items-center gap-4 p-5">
      <span className={cx("grid size-11 shrink-0 place-items-center rounded-full", frozen ? "bg-blue-wash text-blue" : "bg-red-wash text-red")}><Icon name={frozen ? "play" : "pause"} size={18} /></span>
      <div className="min-w-0 flex-1 basis-60">
        <h2 className="text-[15px] font-semibold">{frozen ? "Spending is paused" : "Pause all spending"}</h2>
        <p className="mt-0.5 text-[13px] text-ink-3">{frozen ? (can.founder(w.access) ? "Nothing can be bought until you resume." : "Only the founder can resume.") : "One transaction stops every team. Founders and admins can pause; only the founder can resume."}</p>
      </div>
      {frozen ? (
        can.founder(w.access) ? <Button action variant="primary" icon="play" loading={Boolean(pending)} onClick={resume} data-testid="resume-all">Resume</Button> : null
      ) : (
        <Button action variant="danger" icon="pause" onClick={() => setConfirm(true)} data-testid="pause-all">Pause all</Button>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Pause all spending?" footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button action variant="danger" loading={Boolean(pending)} onClick={() => void pause()} data-testid="confirm-pause">Pause all</Button></>}>
        <p className="text-ink-2">Agents in every team stop buying models and services until the founder resumes. Use this if something looks wrong.</p>
      </Dialog>
    </Panel>
  );
}

export function SettingsPage() {
  const w = useWorkspace();
  const admin = can.admin(w.access);
  const chain = w.company?.chain;
  return (
    <>
      <PageHeader title="Settings" sub="Agents, devices and the controls that stop spending." />
      <div className="space-y-4">
        {admin || w.demo ? <Section id="pause"><Spending /></Section> : null}
        {admin || w.demo ? <Section id="agents"><Agents /></Section> : null}
        {admin ? <Section id="payments"><Payments /></Section> : null}
        {!w.demo ? <Section id="keys"><DeviceKeys /></Section> : null}
        {can.founder(w.access) && !w.demo ? <Section id="rotate"><RotateKey /></Section> : null}
        <Section id="security">
          <Panel aria-label="Security" className="px-5 py-3">
            <h2 className="pt-1 pb-1 text-[15px] font-semibold">Security</h2>
            <Dl
              rows={[
                ["Company account", <span key="a" className="num break-all">{w.company?.companyId}</span>],
                ["Your access", w.access.founder ? "Founder" : w.access.admin ? "Admin" : w.access.scopes.length ? w.access.scopes.join(", ") : "Read-only sample"],
                ...(w.access.departmentId ? ([["Limited to", `${w.access.departmentId.split(".")[0]} team`]] as Array<[string, ReactNode]>) : []),
                ["Contract version", chain?.contract_version ?? "—"],
                ["Code key version", chain?.code_key_version ?? 0],
              ]}
            />
          </Panel>
        </Section>
        {!admin && !w.demo ? <Panel as="div"><NoAccess what="agents, payments and pausing" /></Panel> : null}
      </div>
    </>
  );
}
