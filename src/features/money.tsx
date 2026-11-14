"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { isApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { Receipt, Team, WithdrawalChain } from "@/api/types";
import { BudgetBar, seriesColor } from "@/components/charts";
import { HorizonGauge } from "@/components/singularity";
import { Async, Button, Chip, CopyButton, Dialog, Dl, Empty, Field, Icon, Input, NoAccess, NotAvailable, Notice, PageHeader, Panel, PanelHeader, Select, Skeleton, SkeletonRows } from "@/components/ui";
import { useDeposit, useLedger, useTeams, useWorkspace } from "@/data/workspace";
import { can } from "@/lib/access";
import { IS_TESTNET } from "@/lib/config";
import { ago, cx, dateTime, shortAccount, teamOf, titleCase } from "@/lib/format";
import { parseUsd, ratio, sum, toBig, usd, usdInput } from "@/lib/money";
import { pollUntil } from "@/wallet/signing";
import { useWrite, WriteError } from "./write";

const CHAINS: Record<number, string> = { 84532: "Base Sepolia", 8453: "Base" };

/* ---------- budgets ---------- */
function RaiseBudget({ team, onClose }: { team: Team; onClose: () => void }) {
  const w = useWorkspace();
  const { run, error, pending } = useWrite();
  const [value, setValue] = useState(usdInput(team.budget));
  const next = parseUsd(value);
  const lower = next !== null && toBig(next) < toBig(team.budget);
  const same = next !== null && toBig(next) === toBig(team.budget);
  const raise = async () => {
    if (!next) return;
    const ok = await run({
      title: `Raise the ${team.name} budget`,
      summary: (
        <>
          Monthly budget goes from <span className="num text-ink">{usd(team.budget)}</span> to <span className="num text-ink">{usd(next)}</span>.
        </>
      ),
      request: (key) => endpoints.policy({ companyId: w.slug, team: team.name, monthlyCap: next }, key),
      areas: ["teams", "analytics"],
      done: "Budget raised",
      confirm: () => pollUntil(async () => toBig((await endpoints.teams(w.slug)).teams.find((t) => t.name === team.name)?.budget) >= toBig(next), { timeout: 15_000 }),
    });
    if (ok) onClose();
  };
  const pause = async () => {
    const ok = await run(
      { title: `Pause the ${team.name} team`, summary: "Its agents stop buying until the team is resumed. Other teams keep working.", request: (key) => endpoints.freeze(w.slug, key, [team.departmentId]), areas: ["teams", "analytics", "company"], done: "Team paused" },
      "pause",
    );
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${titleCase(team.name)} team budget`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {lower ? (
            <Button action icon="pause" loading={pending === "pause"} onClick={() => void pause()} data-testid="pause-team">Pause team instead</Button>
          ) : (
            <Button action variant="primary" disabled={!next || same} loading={Boolean(pending)} onClick={() => void raise()} data-testid="confirm-budget">Raise budget</Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Monthly budget (USDC)" hint={`Currently ${usd(team.budget)}, with ${usd(team.spent)} spent and ${usd(team.available)} available.`} error={value && next === null ? "Enter an amount like 250 or 250.50." : null}>
          {(p) => <Input {...p} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="num" autoFocus data-testid="budget-input" />}
        </Field>
        {lower ? <Notice tone="amber">Budgets can only go up: the contract doesn't allow lowering one. To stop a team's spending, pause it.</Notice> : null}
        <WriteError error={error} feature="Raising a budget" />
      </div>
    </Dialog>
  );
}

function DailyCap({ current, onClose }: { current: string; onClose: () => void }) {
  const w = useWorkspace();
  const { run, error, pending } = useWrite();
  const [value, setValue] = useState(usdInput(current));
  const next = parseUsd(value);
  const save = async () => {
    if (!next) return;
    const ok = await run({
      title: "Set the daily cap",
      summary: (
        <>
          All teams together can spend at most <span className="num text-ink">{usd(next)}</span> per day. Purchases past it wait for approval.
        </>
      ),
      request: (key) => endpoints.policy({ companyId: w.slug, dailyCap: next }, key),
      areas: ["company", "analytics"],
      done: "Daily cap set",
      confirm: () => pollUntil(async () => toBig((await endpoints.company(w.slug)).chain?.daily_cap) === toBig(next), { timeout: 15_000 }),
    });
    if (ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Daily cap" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button action variant="primary" disabled={!next || toBig(next) === toBig(current)} loading={Boolean(pending)} onClick={() => void save()} data-testid="confirm-daily-cap">Set daily cap</Button></>}>
      <div className="space-y-4">
        <Field label="Company-wide cap per day (USDC)" error={value && next === null ? "Enter an amount like 50 or 50.00." : null}>
          {(p) => <Input {...p} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="num" autoFocus data-testid="daily-cap-input" />}
        </Field>
        <WriteError error={error} feature="Changing the daily cap" />
      </div>
    </Dialog>
  );
}

function Budgets() {
  const w = useWorkspace();
  const teams = useTeams();
  const [raise, setRaise] = useState<Team | null>(null);
  const [capOpen, setCapOpen] = useState(false);
  const chain = w.company?.chain;
  const cap = chain?.daily_cap ?? "0";
  const usedPct = ratio(chain?.spent_today ?? "0", cap) * 100;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Panel aria-label="Team budgets">
        <PanelHeader title="Team budgets" hint="Enforced by each team's contract. A team can't spend past its budget." />
        <Async q={teams} skeleton={<div className="px-5 pb-5"><SkeletonRows /></div>} empty={(t) => !t.length && <Empty icon="teams" title="No teams yet" body="Teams and their budgets are created when the company launches." />}>
          {(ts) => (
            <ul className="divide-y divide-line border-t border-line">
              {ts.map((t) => (
                <li key={t.departmentId} data-testid="budget-row" className="grid gap-x-5 gap-y-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: seriesColor(w.teamNames, t.name) }} />
                      <h3 className="font-sans text-[15px] font-semibold tracking-normal">{titleCase(t.name)}</h3>
                      {t.frozen ? <Chip tone="blue" dot>Paused</Chip> : null}
                      <span className="text-[13px] text-ink-3">up to <span className="num text-ink-2">{usd(t.perTxLimit)}</span> per purchase</span>
                    </div>
                    <BudgetBar spent={t.spent} reserved={t.reserved} budget={t.budget} color={seriesColor(w.teamNames, t.name)} />
                    <p className="mt-2 text-[13px] text-ink-3">
                      <span className="num text-ink">{usd(t.spent)}</span> spent · <span className="num text-ink-2">{usd(t.reserved)}</span> reserved · <span className="num text-ink-2">{usd(t.available)}</span> available of <span className="num text-ink-2" data-testid="team-budget">{usd(t.budget)}</span>
                    </p>
                  </div>
                  {can.admin(w.access) ? <Button action size="sm" onClick={() => setRaise(t)} data-testid="raise-budget">Raise budget</Button> : null}
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Panel>
      <Panel aria-label="Daily cap" className="flex flex-col items-center p-5 text-center">
        <HorizonGauge pct={usedPct} label={usd(chain?.spent_today ?? "0")} sub={`of ${usd(cap)} today`} />
        <h2 className="mt-4 text-[15px] font-semibold">Daily cap</h2>
        <p className="mt-1 text-[13px] text-ink-3">The most all teams can spend in a day. Nothing passes it without your approval.</p>
        {can.founder(w.access) ? <Button action size="sm" className="mt-4" onClick={() => setCapOpen(true)} data-testid="change-daily-cap">Change daily cap</Button> : null}
      </Panel>
      {raise ? <RaiseBudget team={raise} onClose={() => setRaise(null)} /> : null}
      {capOpen ? <DailyCap current={cap} onClose={() => setCapOpen(false)} /> : null}
    </div>
  );
}

/* ---------- funding ---------- */
function Qr({ value, size = 132 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [value]);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${path.n + 4} ${path.n + 4}`} role="img" aria-label={`QR code for ${value}`} className="rounded-[10px] bg-[#f3ebdd]" shapeRendering="crispEdges">
      <path d={path.d} fill="#050509" />
    </svg>
  );
}

function Funding() {
  const q = useDeposit();
  const [qr, setQr] = useState<{ team: string; address: string; chain: string } | null>(null);
  return (
    <Panel aria-label="Funding">
      <PanelHeader title="Funding" hint={IS_TESTNET ? "On testnet each team is funded directly with USDC on Base Sepolia." : "Send USDC to the company address; team budgets draw from it."} />
      <Async q={q} skeleton={<div className="px-5 pb-5"><SkeletonRows rows={3} /></div>}>
        {(d) => (
          <div className="border-t border-line">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
              <span className="text-ink-3">Funded balance across teams</span>
              <span className="num text-lg font-semibold" data-testid="deposit-balance">{usd(d.balance)}</span>
            </div>
            {d.supported && d.address ? (
              <div className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-4">
                <Qr value={d.address} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-ink-3">Company deposit address</div>
                  <div className="num mt-1 text-sm break-all">{d.address}</div>
                  <div className="mt-3"><CopyButton value={d.address} label="Copy address" /></div>
                </div>
              </div>
            ) : (
              <>
                {d.message ? <p className="border-t border-line px-5 py-3 text-[13px] text-ink-3">{d.message}</p> : null}
                <ul className="divide-y divide-line border-t border-line">
                  {d.teams.map((t) => (
                    <li key={t.departmentId} data-testid="funding-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="text-sm font-medium">{titleCase(t.team)} <span className="font-normal text-ink-3">· {t.token} on {CHAINS[t.chainId] ?? `chain ${t.chainId}`}</span></div>
                        <div className="num mt-0.5 text-[13px] break-all text-ink-2">{t.address ?? "No address yet. Finish payment setup in Settings."}</div>
                      </div>
                      <span className="num text-sm font-semibold">{usd(t.balance)}</span>
                      {t.address ? (
                        <span className="flex gap-2">
                          <CopyButton value={t.address} />
                          <Button size="sm" onClick={() => setQr({ team: t.team, address: t.address!, chain: CHAINS[t.chainId] ?? `chain ${t.chainId}` })}>QR</Button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Async>
      <Dialog open={Boolean(qr)} onClose={() => setQr(null)} title={qr ? `Fund the ${qr.team} team` : ""} width={380}>
        {qr ? (
          <div className="flex flex-col items-center gap-4 pb-2 text-center">
            <Qr value={qr.address} size={220} />
            <p className="num text-[13px] break-all text-ink-2">{qr.address}</p>
            <Notice tone="amber">Send only USDC on {qr.chain}. Other tokens or networks won't arrive.</Notice>
            <CopyButton value={qr.address} label="Copy address" />
          </div>
        ) : null}
      </Dialog>
    </Panel>
  );
}

/* ---------- ledger ---------- */
const KIND: Record<string, string> = { payment: "Payment", purchase: "Purchase", deposit: "Deposit", topup: "Top-up", withdrawal: "Withdrawal", revenue: "Revenue", membership: "Membership", keys_policy: "Keys" };
const kindLabel = (k: string) => KIND[k] ?? titleCase(k);

function ReceiptDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["receipt", id], queryFn: () => endpoints.receipt(id).then((r) => r.receipt) });
  return (
    <Dialog open onClose={onClose} title="Receipt">
      <Async q={q}>
        {(r) => (
          <div data-testid="receipt-detail">
            <div className="num mb-3 text-3xl font-semibold">{usd(r.amount)}</div>
            <Dl
              rows={[
                ["Kind", kindLabel(r.kind)],
                ["Team", teamOf(r.departmentId) || "Company"],
                ["When", dateTime(r.createdAt)],
                ...(r.payload?.seller ? ([["Seller", String(r.payload.seller)]] as Array<[string, string]>) : []),
                ...(r.payload?.model ? ([["Model", String(r.payload.model)]] as Array<[string, string]>) : []),
                ...(r.rail ? ([["Rail", r.rail]] as Array<[string, string]>) : []),
                ...(r.actor ? ([["Signed by", shortAccount(r.actor)]] as Array<[string, string]>) : []),
                ["Verified on chain", r.verifiedOnChain === null ? "Not applicable" : r.verifiedOnChain ? "Yes" : "Not yet"],
                ...(r.foreignTx ? ([["Payment transaction", <span key="t" className="num break-all">{r.foreignTx}</span>]] as Array<[string, React.ReactNode]>) : []),
                ...(r.nearTx ? ([["NEAR transaction", <span key="n" className="num break-all">{r.nearTx}</span>]] as Array<[string, React.ReactNode]>) : []),
              ]}
            />
          </div>
        )}
      </Async>
    </Dialog>
  );
}

function Ledger() {
  const w = useWorkspace();
  const q = useLedger();
  const [kind, setKind] = useState("");
  const [team, setTeam] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(12);
  const csv = useMutation({
    mutationFn: () => endpoints.ledgerCsv(w.slug),
    onSuccess: (text) => {
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `${w.slug}-ledger.csv` });
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const kinds = useMemo(() => [...new Set((q.data ?? []).map((r) => r.kind))], [q.data]);
  const rows = (q.data ?? []).filter((r: Receipt) => (!kind || r.kind === kind) && (!team || teamOf(r.departmentId) === team));
  return (
    <Panel aria-label="Ledger" data-testid="ledger">
      <PanelHeader
        title="Ledger"
        hint="Every payment and money movement, from signed records."
        action={
          <Button action size="sm" icon="download" loading={csv.isPending} onClick={() => csv.mutate()} data-testid="export-csv">
            Export CSV
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="!h-9 !w-auto min-w-32 text-[13px]">
          <option value="">All kinds</option>
          {kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </Select>
        {!w.access.departmentId && w.teamNames.length > 1 ? (
          <Select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} className="!h-9 !w-auto min-w-32 text-[13px]">
            <option value="">All teams</option>
            {w.teamNames.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </Select>
        ) : null}
        {rows.length ? <span className="ml-auto self-center text-[13px] text-ink-3">{rows.length} entries · <span className="num text-ink-2">{usd(sum(rows.map((r) => r.amount)))}</span></span> : null}
      </div>
      <Async q={q} skeleton={<div className="px-5 pb-5"><SkeletonRows rows={5} /></div>} empty={(r) => !r.length && <Empty icon="money" title="No money has moved yet" body={w.demo ? "The sample company doesn't include a ledger." : "Payments appear here once a team is funded and its agents start buying."} />}>
        {() =>
          rows.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {rows.slice(0, limit).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(r.id)} data-testid="ledger-row" className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-raised/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{String(r.payload?.seller ?? r.payload?.title ?? kindLabel(r.kind))}</span>
                      <span className="block truncate text-[13px] text-ink-3">{kindLabel(r.kind)}{r.departmentId ? ` · ${teamOf(r.departmentId)}` : ""} · {ago(r.createdAt)}</span>
                    </span>
                    {r.verifiedOnChain ? <Icon name="check" className="text-green" /> : null}
                    <span className={cx("num font-semibold", r.kind === "deposit" || r.kind === "revenue" ? "text-green" : "text-ink")}>{usd(r.amount)}</span>
                  </button>
                </li>
              ))}
              {rows.length > limit ? (
                <li className="px-5 py-3 text-center">
                  <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + 25)}>Show more ({rows.length - limit} older)</Button>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="border-t border-line px-5 py-6 text-center text-sm text-ink-3">Nothing matches these filters.</p>
          )
        }
      </Async>
      {open ? <ReceiptDialog id={open} onClose={() => setOpen(null)} /> : null}
    </Panel>
  );
}

/* ---------- withdraw ---------- */
const CHAIN_OPTIONS: Array<{ id: WithdrawalChain; label: string; hint: string; valid: (a: string) => boolean }> = [
  { id: "near", label: "NEAR", hint: "A NEAR account, like you.near, or a 64-character address", valid: (a) => /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a) && a.length >= 2 && a.length <= 64 },
  { id: "base", label: "Base", hint: "An address starting with 0x", valid: (a) => /^0x[0-9a-fA-F]{40}$/.test(a) },
  { id: "ethereum", label: "Ethereum", hint: "An address starting with 0x", valid: (a) => /^0x[0-9a-fA-F]{40}$/.test(a) },
  { id: "arbitrum", label: "Arbitrum", hint: "An address starting with 0x", valid: (a) => /^0x[0-9a-fA-F]{40}$/.test(a) },
  { id: "solana", label: "Solana", hint: "A Solana address", valid: (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) },
];
const SOURCE: Record<string, string> = { intents: "Company treasury", tempo: "Unreserved team floats" };

/**
 * Withdraw in two beats, like every other money decision here: first the plan (where the funds come from and
 * what it costs), then the founder's wallet signs the request. Nothing moves before the signature.
 */
function Withdraw({ onClose }: { onClose: () => void }) {
  const w = useWorkspace();
  const { run, pending } = useWrite();
  const [amount, setAmount] = useState("");
  const [chain, setChain] = useState<WithdrawalChain>("near");
  const [to, setTo] = useState("");
  const micro = parseUsd(amount);
  const net = CHAIN_OPTIONS.find((c) => c.id === chain)!;
  const address = to.trim();
  const addressOk = net.valid(address);
  const plan = useMutation({ mutationFn: () => endpoints.planWithdrawal({ companyId: w.slug, amount: micro!, to: address, chain }) });
  const p = plan.data?.plan;
  const short = isApiError(plan.error, "insufficient_funds");
  // the server words the shortfall in raw units ("only 0 available"); say it in dollars
  const have = short ? /only (\d+) available/.exec((plan.error as Error).message)?.[1] : undefined;
  const fee = sum((p?.sources ?? []).map((x) => x.estFee ?? "0"));

  const sign = async () => {
    if (!plan.data || !p) return;
    const ok = await run({
      title: "Withdraw funds",
      summary: (
        <>
          <span className="num text-ink">{usd(p.amount)}</span> leaves the company for <span className="num text-ink">{shortAccount(p.to)}</span> on {net.label}.
        </>
      ),
      // the plan already carries the transaction for this exact withdrawal; sign that one
      request: () => Promise.resolve(plan.data),
      areas: ["deposit", "ledger", "teams", "analytics"],
      done: "Withdrawal requested",
    });
    if (ok) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={p ? "Review the withdrawal" : "Withdraw funds"}
      footer={
        p ? (
          <>
            <Button variant="ghost" onClick={() => plan.reset()}>Back</Button>
            <Button action variant="primary" loading={Boolean(pending)} onClick={() => void sign()} data-testid="confirm-withdrawal">Withdraw {usd(p.amount)}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button action variant="primary" disabled={!micro || toBig(micro) === 0n || !addressOk} loading={plan.isPending} onClick={() => plan.mutate()} data-testid="review-withdrawal">Review withdrawal</Button>
          </>
        )
      }
    >
      {p ? (
        <div data-testid="withdrawal-plan">
          <div className="num text-3xl font-semibold">{usd(p.amount)}</div>
          <p className="mt-1 mb-3 text-sm text-ink-3">USDC, sent on {net.label}</p>
          <Dl
            rows={[
              ["To", <span key="t" className="num break-all">{p.to}</span>],
              ...p.sources.map((x) => [`From ${(SOURCE[x.from] ?? x.from).toLowerCase()}`, <span key={x.from} className="num">{usd(x.amount)}</span>] as [string, React.ReactNode]),
              ["Estimated fee", <span key="f" className="num">{toBig(fee) > 0n ? usd(fee) : "None"}</span>],
            ]}
          />
          <div className="mt-4"><Notice tone="amber">Check the address and network. A withdrawal can't be reversed once your wallet has signed it.</Notice></div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), micro && addressOk && plan.mutate())}>
          <Field label="Amount (USDC)" error={amount && micro === null ? "Enter an amount like 25 or 25.50." : null}>
            {(f) => <Input {...f} inputMode="decimal" autoFocus value={amount} onChange={(e) => (setAmount(e.target.value), plan.reset())} placeholder="0.00" className="num" data-testid="withdraw-amount" />}
          </Field>
          <Field label="Send on">
            {(f) => (
              <Select {...f} value={chain} onChange={(e) => (setChain(e.target.value as WithdrawalChain), plan.reset())} data-testid="withdraw-chain">
                {CHAIN_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Destination address" hint={net.hint} error={address && !addressOk ? `This doesn't look like a ${net.label} address.` : null}>
            {(f) => <Input {...f} value={to} onChange={(e) => (setTo(e.target.value), plan.reset())} autoComplete="off" spellCheck={false} className="num" data-testid="withdraw-to" />}
          </Field>
          {short ? (
            <div data-testid="withdraw-short">
              <Notice tone="amber">
                <strong className="font-semibold">There isn't that much to withdraw.</strong>
                <span className="mt-1 block text-ink-2">
                  {have !== undefined ? <>Withdrawable now: <span className="num text-ink">{usd(have)}</span>. </> : null}
                  Funds reserved for purchases in progress are left out.
                  {IS_TESTNET ? " On testnet the company treasury isn't available, so team funds stay at each team's Base Sepolia address and can't be withdrawn from here." : ""}
                </span>
              </Notice>
            </div>
          ) : plan.error ? (
            <WriteError error={plan.error} feature="Withdrawals" />
          ) : null}
        </form>
      )}
    </Dialog>
  );
}

function Withdrawals() {
  const w = useWorkspace();
  const [open, setOpen] = useState(false);
  const services = useQuery({ queryKey: ["c", w.slug, "services"], queryFn: () => endpoints.services(w.slug), retry: false, enabled: !w.demo });
  if (!can.founder(w.access) && !w.demo) return services.error ? <Panel aria-label="Services" className="p-5"><NotAvailable error={services.error} title="Services" /></Panel> : null;
  return (
    <Panel aria-label="Withdraw" className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Withdraw</h2>
          <p className="mt-0.5 max-w-[60ch] text-[13px] text-ink-3">Move USDC out of the company to any address. Only the founder can withdraw, and funds reserved for purchases in progress stay put.</p>
        </div>
        <Button action size="sm" icon="external" onClick={() => setOpen(true)} data-testid="withdraw">Withdraw funds</Button>
      </div>
      {services.error ? <NotAvailable error={services.error} title="Services" /> : null}
      {open ? <Withdraw onClose={() => setOpen(false)} /> : null}
    </Panel>
  );
}

export function MoneyPage() {
  const w = useWorkspace();
  if (!can.money(w.access)) return (<><PageHeader title="Money" /><Panel as="div"><NoAccess what="budgets and the ledger" /></Panel></>);
  return (
    <>
      <PageHeader title="Money" sub="Budgets, where to send funds, and every payment agents have made." />
      <div className="space-y-4">
        <Budgets />
        <Funding />
        <Ledger />
        <Withdrawals />
      </div>
    </>
  );
}
export const MoneySkeleton = () => <Skeleton className="h-96" />;
