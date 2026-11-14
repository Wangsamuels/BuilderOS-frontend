/**
 * A stand-in for the BuilderOS API (contract 2026-11-13) with a simulated chain, used only by the end-to-end
 * tests. Shapes follow docs/API-CONTRACT.md. Like the real backend it never moves money: writes return
 * unsigned transactions, and state changes only when the test wallet "broadcasts" one to POST /__sim/tx.
 *
 *   node tests/mock-api/server.ts            (PORT, default 4010)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

const PORT = Number(process.env.PORT ?? 4010);
const ROOT = "builderos-sim.testnet";
const FACTORY = `factory.${ROOT}`;
const NEAR = 10n ** 24n;
const CREATE_COMPANY = (75n * NEAR) / 10n;
const CREATE_TEAM = (45n * NEAR) / 10n;
const DAY = 86_400_000;
const ALL_SCOPES = ["view", "approve", "builder", "code"];
const TEMPLATES: Record<string, string[]> = { viewer: ["view"], approver: ["view", "approve"], builder: ["view", "builder", "code"], admin: ["admin"] };

type Json = Record<string, any>;
type Grant = { scopes: string[]; departmentId: string | null; admin: boolean };
type Team = { name: string; departmentId: string; budget: bigint; spent: bigint; reserved: bigint; perTxLimit: bigint; frozen: boolean; paymentAddress: string; funded: bigint; agents: Array<{ publicKey: string; role: string; status: string }> };
type Company = {
  id: string; slug: string; name: string; founder: string; frozen: boolean; dailyCap: bigint; spentToday: bigint; codeKeyVersion: number; contractVersion: number; createdAt: string;
  teams: Team[]; members: Map<string, Grant>; viewKeys: Map<string, string>; approvals: Json[]; reports: Json[]; receipts: Json[]; plans: Json[]; tasks: Json[]; wrapped: number;
  pending?: { teams: Array<{ team: string; monthlyCap: bigint }>; planId?: string };
};
type Account = { id: string; loginMethod: "privy" | "wallet"; email: { address: string | null; verified: boolean; source: "code" | "privy" | null; pending: string | null }; code?: { value: string; tries: number }; balance: bigint; funded: boolean; prefs: { lastCompanyId?: string | null; dismissed?: string[] }; read: Set<string>; alerts: Json[] };

/* ---------- state ---------- */
let companies = new Map<string, Company>();
let accounts = new Map<string, Account>();
let sessions = new Map<string, { accountId: string; expiresAt: number }>();
let challenges = new Map<string, number>();
let drafts = new Map<string, Json>();
let invites: Json[] = [];
let outbox: Json[] = [];
let txLog = new Map<string, { accountId: string; method: string; receiverId: string }>();
let idem = new Map<string, { status: number; body: unknown }>();
let events: Json[] = [];
let streamTokens = new Map<string, string>();
let streams: Array<{ res: ServerResponse; accountId: string; lastEventId: number }> = [];
let streamLog: Array<{ accountId: string; lastEventId: number }> = [];
let privyEmailOff = new Set<string>();
let seq = 0;
const nid = (p: string) => `${p}_${(++seq).toString(36)}${randomBytes(3).toString("hex")}`;

class Http extends Error {
  status: number;
  code: string;
  details?: Json;
  constructor(status: number, code: string, message: string, details?: Json) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const iso = (t: number) => new Date(t).toISOString();
const now = () => Date.now();
const mask = (e: string | null) => (e ? e.replace(/^(.).*(@.*)$/, "$1•••$2") : null);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const slugOf = (id: string) => id.split(".")[0];
const companyId = (slug: string) => `${slug}.${ROOT}`;
const dept = (team: string, slug: string) => `${team}.${companyId(slug)}`;
const micro = (dollars: number) => BigInt(Math.round(dollars * 1e6));
const parseMoney = (v: unknown): bigint => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : typeof v === "string" && /^\d+\.\d{1,6}$/.test(v) ? micro(Number(v)) : (() => { throw new Http(400, "invalid_request", "Amounts are integer strings in micro-USDC."); })());

function tx(receiverId: string, methodName: string, args: Json, deposit = "1", signerId?: string) {
  return { ...(signerId ? { signerId } : {}), receiverId, actions: [{ type: "FunctionCall", params: { methodName, args, gas: "100000000000000", deposit } }] };
}
function emit(event: string, company: Company | null, data: Json = {}, departmentId: string | null = null, only?: string) {
  const ev = { id: events.length + 1, event, companyId: company?.id ?? null, departmentId, data, nearTx: null, blockHeight: 1000 + events.length, at: iso(now()), only };
  events.push(ev);
  for (const s of streams) send(s, ev);
}
function visible(ev: Json, accountId: string) {
  if (ev.only) return ev.only === accountId;
  if (!ev.companyId) return true;
  const c = companies.get(slugOf(ev.companyId));
  return Boolean(c && access(c, accountId));
}
function send(s: { res: ServerResponse; accountId: string }, ev: Json) {
  if (!visible(ev, s.accountId)) return;
  const { only: _only, ...body } = ev;
  s.res.write(`id: ${ev.id}\nevent: ${ev.event}\ndata: ${JSON.stringify(body)}\n\n`);
}

/* ---------- access (the server decides; the browser only renders) ---------- */
function access(c: Company, accountId: string) {
  if (c.founder === accountId) return { founder: true, admin: true, scopes: ALL_SCOPES, departmentId: null as string | null, expiresAtMs: null };
  const g = c.members.get(accountId);
  if (!g) return null;
  return { founder: false, admin: g.admin, scopes: g.admin ? ALL_SCOPES : g.scopes, departmentId: g.departmentId, expiresAtMs: null };
}
function company(idOrSlug: unknown): Company {
  if (typeof idOrSlug !== "string" || !idOrSlug) throw new Http(400, "invalid_request", "companyId is required.");
  const c = companies.get(slugOf(idOrSlug));
  if (!c) throw new Http(404, "not_found", "That company doesn't exist.");
  return c;
}
type Need = "any" | "admin" | "founder" | string[];
function authorize(accountId: string, idOrSlug: unknown, need: Need) {
  const c = company(idOrSlug);
  const a = access(c, accountId);
  if (!a) throw new Http(403, "forbidden", "You're not a member of this company.");
  const ok = need === "any" ? true : need === "founder" ? a.founder : need === "admin" ? a.admin : a.admin || need.some((s) => a.scopes.includes(s));
  if (!ok) throw new Http(403, "forbidden", "Your access doesn't cover this.", { required: need });
  return { c, a };
}
const has = (a: { admin: boolean; scopes: string[] }, ...s: string[]) => a.admin || s.some((x) => a.scopes.includes(x));
const teamsFor = (c: Company, a: { departmentId: string | null }) => (a.departmentId ? c.teams.filter((t) => t.departmentId === a.departmentId) : c.teams);
const inTeam = (a: { departmentId: string | null }, departmentId: string | null | undefined) => !a.departmentId || a.departmentId === departmentId;

/* ---------- builders shared by real companies and the demo ---------- */
const FEATURES = [
  { key: "auth", title: "Sign-in and accounts", tag: "backend", team: "build", size: "m", cost: 6.2 },
  { key: "editor", title: "Note editor with autosave", tag: "frontend", team: "build", size: "l", cost: 11.4 },
  { key: "billing", title: "Subscriptions and checkout", tag: "payments", team: "build", size: "m", cost: 7.9 },
  { key: "deploy", title: "Production deploy and monitoring", tag: "infra", team: "ops", size: "s", cost: 3.1 },
  { key: "backups", title: "Nightly backups", tag: "infra", team: "ops", size: "s", cost: 2.2 },
  { key: "landing", title: "Landing page and waitlist", tag: "marketing", team: "growth", size: "s", cost: 2.8 },
];
const est = (cost: number) => ({ p50: micro(cost).toString(), p90: micro(cost * 1.6).toString(), cap: micro(cost * 2.5).toString() });
const sumEst = (fs: Json[]) => {
  const t = fs.reduce((n, f) => n + Number(f.estimate?.p50 ?? 0), 0) / 1e6;
  return est(t);
};
function planFeatures(tier = "standard") {
  const k = tier === "premium" ? 1.8 : tier === "economy" ? 0.6 : 1;
  return FEATURES.map((f) => ({ key: f.key, title: f.title, tag: f.tag, size: f.size, dependsOn: f.key === "billing" ? ["auth"] : [], team: f.team, estimate: est(f.cost * k) }));
}
function suggested(name: string, slug: string, features: Json[]) {
  const by = new Map<string, Json[]>();
  for (const f of features) by.set(f.team, [...(by.get(f.team) ?? []), f]);
  const teams = [...by].map(([team, fs]) => {
    const cap = BigInt(sumEst(fs).cap);
    const monthly = ((cap * 2n) / 1_000_000n + 1n) * 1_000_000n;
    return { team, monthlyCap: monthly.toString(), perTxLimit: (monthly / 20n).toString(), features: fs.length, estimatedCap: cap.toString() };
  });
  const required = CREATE_COMPANY + CREATE_TEAM * BigInt(teams.length);
  return { name, slug, dailyCap: micro(50).toString(), teams, funding: { recommendedYocto: required.toString(), recommendedNear: (Number(required / (NEAR / 100n)) / 100).toString() } };
}
function draftView(d: Json) {
  const { author: _a, ...rest } = d;
  return rest;
}
function newDraft(author: string, body: Json) {
  const what = String(body.what ?? body.description ?? "").trim();
  if (what.length < 8) throw new Http(400, "invalid_request", "Describe the product in a sentence or more (what).");
  const title = String(body.title ?? what.split(/[.!?\n]/)[0]).split(/\s+/).slice(0, 5).join(" ").replace(/[^\w\s-]/g, "");
  const tier = String(body.tier ?? "standard");
  const features = planFeatures(tier);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "product";
  const d = { id: nid("draft"), author, title, status: "draft", companyId: null, launchCompanyId: null, tier, features, estimate: sumEst(features), suggestedSetup: suggested(title, slug, features), description: [what, body.who && `For: ${body.who}`, body.howTheyPay && `They pay: ${body.howTheyPay}`].filter(Boolean).join("\n"), private: Boolean(body.private), createdAt: iso(now()), updatedAt: iso(now()) };
  drafts.set(d.id, d);
  return d;
}
function teamView(t: Team, c: Company) {
  const tasks: Record<string, number> = {};
  for (const k of c.tasks.filter((x) => x.departmentId === t.departmentId)) tasks[k.status] = (tasks[k.status] ?? 0) + 1;
  return { name: t.name, departmentId: t.departmentId, budget: t.budget.toString(), spent: t.spent.toString(), reserved: t.reserved.toString(), available: (t.budget - t.spent - t.reserved).toString(), perTxLimit: t.perTxLimit.toString(), frozen: t.frozen || c.frozen, paymentAddress: t.paymentAddress, chainId: 84532, agents: t.agents, tasks };
}
function reportView(r: Json, a: { admin: boolean; scopes: string[] }) {
  const money = has(a, "view", "approve");
  const build = has(a, "builder", "code");
  const f = r.facts;
  const facts: Json = { durationMs: f.durationMs, tier: f.tier, reason: f.reason ?? null };
  if (build) Object.assign(facts, { files: f.files, checks: f.checks, review: f.review, commitSha: f.commitSha, generator: f.generator });
  if (money) Object.assign(facts, { models: f.models, receipts: f.receipts, estimate: f.estimate, taskCostSoFar: f.taskCostSoFar });
  return { ...r, cost: money ? r.cost : null, facts };
}
function headline(s: Json, days: number) {
  const parts = [s.done && `${s.done} done`, s.needsReview && `${s.needsReview} in review`, s.paused && `${s.paused} waiting on you`, s.failed && `${s.failed} failed`, s.retrying && `${s.retrying} retrying`].filter(Boolean);
  if (!parts.length) return `No reports in the last ${days} days`;
  return `${parts.join(" · ")}${s.cost !== null ? ` · $${(Number(s.cost) / 1e6).toFixed(2)} spent` : ""} in the last ${days} days`;
}
function reportsView(c: Company, a: ReturnType<typeof access> & {}, q: { team?: string; days?: number; outcome?: string }) {
  const days = q.days ?? 7;
  const money = has(a, "view", "approve");
  return {
    groupBy: "team",
    teams: teamsFor(c, a)
      .filter((t) => !q.team || t.name === q.team)
      .map((t) => {
        const rs = c.reports.filter((r) => r.departmentId === t.departmentId && now() - Date.parse(r.updatedAt) < days * DAY && (!q.outcome || r.outcome === q.outcome)).sort((x, y) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt));
        const n = (o: string) => rs.filter((r) => r.outcome === o).length;
        const summary: Json = { done: n("done"), needsReview: n("needs_review"), retrying: n("retrying"), paused: n("paused"), failed: n("failed"), reports: rs.length, cost: money ? rs.reduce((s, r) => s + BigInt(r.cost), 0n).toString() : null };
        summary.headline = headline(summary, days);
        return { team: t.name, departmentId: t.departmentId, summary, reports: rs.map((r) => reportView(r, a)) };
      }),
  };
}
function analyticsView(c: Company, a: ReturnType<typeof access> & {}, range: string, team?: string) {
  const days = Number(range.replace("d", "")) || 30;
  if (team && a.departmentId && dept(team, c.slug) !== a.departmentId) throw new Http(403, "forbidden", "Your access is limited to one team.");
  const teams = teamsFor(c, a).filter((t) => !team || t.name === team);
  const ids = new Set(teams.map((t) => t.departmentId));
  const from = now() - days * DAY;
  const pays = c.receipts.filter((r) => r.kind === "payment" && ids.has(r.departmentId) && Date.parse(r.createdAt) >= from);
  const sections = { money: has(a, "view", "approve"), work: has(a, "builder", "code"), control: has(a, "approve") };
  const byDay = Array.from({ length: days }, (_, i) => {
    const day = iso(now() - (days - 1 - i) * DAY).slice(0, 10);
    const rs = pays.filter((r) => r.createdAt.slice(0, 10) === day);
    const byTeam: Record<string, string> = {};
    for (const t of teams) byTeam[t.name] = rs.filter((r) => r.departmentId === t.departmentId).reduce((s, r) => s + BigInt(r.amount), 0n).toString();
    return { day, total: rs.reduce((s, r) => s + BigInt(r.amount), 0n).toString(), byTeam };
  });
  const rank = (key: string, out: string) => {
    const m = new Map<string, { amount: bigint; purchases: number }>();
    for (const r of pays) {
      const k = String(r.payload[key] ?? "other");
      const e = m.get(k) ?? { amount: 0n, purchases: 0 };
      m.set(k, { amount: e.amount + BigInt(r.amount), purchases: e.purchases + 1 });
    }
    return [...m].map(([k, v]) => ({ [out]: k, amount: v.amount.toString(), purchases: v.purchases })).sort((x, y) => Number(BigInt(y.amount) - BigInt(x.amount)));
  };
  const tasks = c.tasks.filter((t) => ids.has(t.departmentId));
  const count = (xs: Json[]) => xs.reduce<Record<string, number>>((m, t) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {});
  const reps = c.reports.filter((r) => ids.has(r.departmentId) && Date.parse(r.updatedAt) >= from);
  const reviewed = reps.filter((r) => r.facts.review);
  const done = reps.filter((r) => r.outcome === "done");
  const pending = c.approvals.filter((x) => x.status === "pending" && (!a.departmentId || x.payload.department_id === a.departmentId));
  return {
    range: { days, from: iso(from), to: iso(now()) },
    teams: teams.map((t) => ({ name: t.name, departmentId: t.departmentId })),
    sections,
    money: sections.money
      ? {
          total: pays.reduce((s, r) => s + BigInt(r.amount), 0n).toString(),
          byDay,
          byTeam: teams.map((t) => {
            const spentInRange = pays.filter((r) => r.departmentId === t.departmentId).reduce((s, r) => s + BigInt(r.amount), 0n);
            const burn = spentInRange / BigInt(days);
            const available = t.budget - t.spent - t.reserved;
            return { team: t.name, departmentId: t.departmentId, spentInRange: spentInRange.toString(), budget: t.budget.toString(), spent: t.spent.toString(), reserved: t.reserved.toString(), available: available.toString(), burnPerDay: burn.toString(), runwayDays: burn > 0n ? Number(available / burn) : null, frozen: t.frozen };
          }),
          byModel: rank("model", "model"),
          bySeller: rank("seller", "seller"),
          dailyCap: { cap: c.dailyCap.toString(), spentToday: c.spentToday.toString(), usedPct: c.dailyCap ? Number((c.spentToday * 1000n) / c.dailyCap) / 10 : 0 },
        }
      : null,
    work: sections.work
      ? {
          tasks: count(tasks),
          tasksByTeam: teams.map((t) => ({ team: t.name, departmentId: t.departmentId, ...count(tasks.filter((x) => x.departmentId === t.departmentId)) })),
          completedByDay: byDay.map((d) => ({ day: d.day, done: done.filter((r) => r.updatedAt.slice(0, 10) === d.day).length })),
          reviewPassRate: reviewed.length ? reviewed.filter((r) => r.facts.review.verdict === "pass").length / reviewed.length : null,
          reviewed: reviewed.length,
          ...(sections.money ? { costPerDoneTask: done.length ? (done.reduce((s, r) => s + BigInt(r.cost), 0n) / BigInt(done.length)).toString() : null, estimateVsActual: done.length ? { estimated: done.reduce((s, r) => s + BigInt(r.facts.estimate.p50), 0n).toString(), actual: done.reduce((s, r) => s + BigInt(r.cost), 0n).toString(), tasks: done.length } : null } : {}),
        }
      : null,
    control: sections.control ? { approvals: { pending: pending.length, oldestPendingAt: pending.map((x) => x.createdAt).sort()[0] ?? null, decidedInRange: c.approvals.filter((x) => x.status !== "pending").length }, blockedPurchases: c.receipts.filter((r) => r.kind === "blocked").length, pausedTeams: c.teams.filter((t) => t.frozen).map((t) => t.name), companyFrozen: c.frozen } : null,
  };
}
function companyView(c: Company, a: ReturnType<typeof access> & {}) {
  return { company: { id: c.id, name: c.name, frozen: c.frozen, founderAccount: c.founder, createdAt: c.createdAt }, companyId: c.id, slug: c.slug, departments: teamsFor(c, a).map((t) => ({ name: t.name, departmentId: t.departmentId })), chain: { frozen: c.frozen, daily_cap: c.dailyCap.toString(), spent_today: c.spentToday.toString(), code_key_version: c.codeKeyVersion, contract_version: c.contractVersion }, access: a };
}
function overviewCompany(c: Company, a: ReturnType<typeof access> & {}) {
  const teams = teamsFor(c, a);
  const ids = new Set(teams.map((t) => t.departmentId));
  const sum = (f: (t: Team) => bigint) => teams.reduce((s, t) => s + f(t), 0n);
  const reps = c.reports.filter((r) => ids.has(r.departmentId)).sort((x, y) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt));
  const pending = c.approvals.filter((x) => x.status === "pending" && inTeam(a, x.payload.department_id));
  const tasks = c.tasks.filter((t) => ids.has(t.departmentId)).reduce<Record<string, number>>((m, t) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {});
  return {
    companyId: c.id, slug: c.slug, name: c.name, role: a.founder ? "founder" : a.admin ? "admin" : "member", scopes: a.scopes, departmentId: a.departmentId, frozen: c.frozen,
    teams: teams.map((t) => ({ name: t.name, departmentId: t.departmentId, frozen: t.frozen })),
    money: has(a, "view", "approve") ? { dailyCap: c.dailyCap.toString(), spentToday: c.spentToday.toString(), budget: sum((t) => t.budget).toString(), spent: sum((t) => t.spent).toString(), reserved: sum((t) => t.reserved).toString(), available: sum((t) => t.budget - t.spent - t.reserved).toString() } : null,
    work: has(a, "builder", "code") ? { tasks, reportsThisWeek: reps.filter((r) => now() - Date.parse(r.updatedAt) < 7 * DAY).length, needsAttention: reps.filter((r) => r.outcome === "paused" || r.outcome === "failed").length, lastReport: reps[0] ? reportView(reps[0], a) : null } : null,
    approvals: has(a, "approve") ? { pending: pending.length, oldestAt: pending.map((x) => x.createdAt).sort()[0] ?? null } : null,
  };
}

/* ---------- seeded company content ---------- */
const MODELS = [["claude-sonnet", "anthropic"], ["gpt-5-mini", "openai"], ["deepseek-v3", "deepseek"]];
function populate(c: Company) {
  const plan = { id: nid("plan"), title: `${c.name} v1`, tier: "standard", status: "launched", features: planFeatures(), estimate: sumEst(planFeatures()), approvedAt: iso(now() - 20 * DAY), description: "The first version." };
  c.plans.push(plan);
  const statuses = ["done", "done", "running", "done", "queued", "paused"];
  FEATURES.forEach((f, i) => {
    const d = dept(f.team, c.slug);
    const task = { id: nid("task"), planId: plan.id, title: f.title, tag: f.tag, size: f.size, status: statuses[i], departmentId: d, tier: "standard", pinnedModel: null, estP50: est(f.cost).p50, estP90: est(f.cost).p90, cap: est(f.cost).cap, pauseReason: statuses[i] === "paused" ? "Waiting for an approval" : null, attempts: 1, updatedAt: iso(now() - i * DAY) };
    c.tasks.push(task);
    if (statuses[i] === "queued") return;
    const outcome = statuses[i] === "done" ? "done" : statuses[i] === "paused" ? "paused" : "needs_review";
    const cost = micro(f.cost * 0.8);
    const [model, provider] = MODELS[i % MODELS.length];
    const at = iso(now() - (i * 0.9 + 0.2) * DAY);
    const receiptId = nid("rcpt");
    c.receipts.push({ id: receiptId, kind: "payment", companyId: c.id, departmentId: d, actor: `agent-${f.team}.sim`, amount: cost.toString(), token: "USDC", rail: "x402", chainId: "84532", foreignTx: `0x${sha(receiptId)}`, verifiedOnChain: true, requestId: nid("req"), payload: { seller: `${provider}.x402`, model, title: f.title }, nearTx: sha(receiptId + "n").slice(0, 44), createdAt: at });
    if (i === 1)
      c.reports.push({ id: nid("rep"), taskId: task.id, attempt: 1, team: f.team, departmentId: d, title: f.title, tag: f.tag, outcome: "retrying", agent: `agent-${f.team}.sim`, summary: "First pass failed the type check in the autosave hook; retrying with a narrower change.", summarySource: "agent", cost: micro(1.1).toString(), facts: { files: ["src/editor/autosave.ts"], checks: { passed: false, errors: ["TS2345: Argument of type 'string' is not assignable"] }, review: null, commitSha: null, generator: { model, provider, rail: "x402" }, models: [{ model, provider, calls: 4, failed: 1, cost: micro(1.1).toString(), tokensIn: 21000, tokensOut: 3900 }], receipts: [], estimate: est(f.cost), taskCostSoFar: micro(1.1).toString(), durationMs: 96_000, tier: "standard" }, createdAt: iso(Date.parse(at) - 3_600_000), updatedAt: iso(Date.parse(at) - 3_600_000) });
    c.reports.push({
      id: nid("rep"), taskId: task.id, attempt: i === 1 ? 2 : 1, team: f.team, departmentId: d, title: f.title, tag: f.tag, outcome, agent: `agent-${f.team}.sim`,
      summary: outcome === "done" ? `Built ${f.title.toLowerCase()} and covered it with tests. All checks pass.` : outcome === "paused" ? "Stopped before buying a domain: the seller is new, so the purchase is waiting for approval." : "Implemented the feature; the reviewer asked for clearer error states.",
      summarySource: "agent", cost: cost.toString(),
      facts: { files: [`src/${f.key}/index.ts`, `src/${f.key}/${f.key}.test.ts`], checks: { passed: outcome !== "needs_review", errors: outcome === "needs_review" ? ["2 lint warnings"] : [] }, review: outcome === "paused" ? null : { verdict: outcome === "done" ? "pass" : "changes_requested", model: "gemini-2.5-pro", reasons: outcome === "done" ? ["Meets the task", "Tests cover the main paths"] : ["Error states are unclear"] }, commitSha: outcome === "done" ? sha(task.id).slice(0, 40) : null, generator: { model, provider, rail: "x402" }, models: [{ model, provider, calls: 9 + i, failed: 0, cost: cost.toString(), tokensIn: 48000 + i * 900, tokensOut: 9100 }], receipts: [{ id: receiptId, amount: cost.toString(), seller: `${provider}.x402` }], estimate: est(f.cost), taskCostSoFar: cost.toString(), reason: outcome === "paused" ? "approval_required" : null, durationMs: 240_000 + i * 31_000, tier: "standard" },
      createdAt: at, updatedAt: at,
    });
    const t = c.teams.find((x) => x.departmentId === d)!;
    t.spent += cost;
  });
  // extra history so charts have a shape
  for (let d = 2; d < 28; d += 1) {
    const f = FEATURES[d % FEATURES.length];
    const amount = micro(0.4 + ((d * 37) % 23) / 10);
    const id = nid("rcpt");
    const [model, provider] = MODELS[d % MODELS.length];
    c.receipts.push({ id, kind: "payment", companyId: c.id, departmentId: dept(f.team, c.slug), actor: `agent-${f.team}.sim`, amount: amount.toString(), token: "USDC", rail: "x402", chainId: "84532", foreignTx: `0x${sha(id)}`, verifiedOnChain: true, requestId: nid("req"), payload: { seller: `${provider}.x402`, model, title: f.title }, createdAt: iso(now() - d * DAY - 3_600_000) });
    c.teams.find((x) => x.name === f.team)!.spent += amount;
  }
  c.receipts.sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
  c.spentToday = micro(18.4);
  c.teams[0].reserved = micro(6);
  c.teams[0].agents.push({ publicKey: `ed25519:${bs58.encode(createHash("sha256").update(c.slug + "a1").digest())}`, role: "builder", status: "running" });
  c.teams[1].agents.push({ publicKey: `ed25519:${bs58.encode(createHash("sha256").update(c.slug + "a2").digest())}`, role: "ops", status: "running" });
  c.approvals.push(
    { id: nid("card"), companyId: c.id, kind: "seller", status: "pending", amount: micro(14).toString(), requestIds: [nid("req")], payload: { department_id: dept("growth", c.slug), seller_id: "namecheap.x402", reason: "new_seller", title: "Register lumen-notes.app", pay_to: "0x7b1E4c0f2A9d53e8C6B4a1F09d2E7c5B8a3F6D10" }, createdAt: iso(now() - 3 * 3_600_000) },
    { id: nid("card"), companyId: c.id, kind: "single", status: "pending", amount: micro(42.5).toString(), requestIds: [nid("req")], payload: { department_id: dept("build", c.slug), seller_id: "anthropic.x402", reason: "over_limit", title: "Large refactor run on the editor" }, createdAt: iso(now() - 40 * 60_000) },
  );
}
function makeCompany(slug: string, name: string, founder: string, opts: { teams?: Array<{ team: string; monthlyCap: bigint }>; dailyCap?: bigint; version?: number; filled?: boolean } = {}) {
  const c: Company = { id: companyId(slug), slug, name, founder, frozen: false, dailyCap: opts.dailyCap ?? micro(50), spentToday: 0n, codeKeyVersion: 1, contractVersion: opts.version ?? 3, createdAt: iso(now() - (opts.filled ? 34 * DAY : 0)), teams: [], members: new Map(), viewKeys: new Map(), approvals: [], reports: [], receipts: [], plans: [], tasks: [], wrapped: 0 };
  for (const t of opts.teams ?? []) addTeam(c, t.team, t.monthlyCap);
  companies.set(slug, c);
  if (opts.filled) {
    for (const t of ["build", "ops", "growth"]) addTeam(c, t, micro(t === "build" ? 400 : 150));
    populate(c);
  }
  return c;
}
function addTeam(c: Company, name: string, budget: bigint) {
  c.teams.push({ name, departmentId: dept(name, c.slug), budget, spent: 0n, reserved: 0n, perTxLimit: budget / 20n, frozen: false, paymentAddress: `0x${sha(dept(name, c.slug)).slice(0, 40)}`, funded: 0n, agents: [] });
}

/* ---------- accounts ---------- */
function account(id: string, loginMethod: "privy" | "wallet" = "wallet") {
  let a = accounts.get(id);
  if (!a) {
    a = { id, loginMethod, email: { address: null, verified: false, source: null, pending: null }, balance: 0n, funded: false, prefs: {}, read: new Set(), alerts: [] };
    accounts.set(id, a);
  }
  return a;
}
const myCompanies = (id: string) => [...companies.values()].filter((c) => access(c, id));
function meView(a: Account) {
  const cs = myCompanies(a.id);
  const ds = [...drafts.values()].filter((d) => d.author === a.id && d.status !== "launched").sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
  const last = cs.find((c) => c.id === a.prefs.lastCompanyId || c.slug === a.prefs.lastCompanyId);
  const required = CREATE_COMPANY + CREATE_TEAM * 3n;
  const founded = cs.filter((c) => c.founder === a.id);
  const steps = [
    { id: "account", label: "Sign in", done: true },
    { id: "email", label: "Verify your email", done: a.email.verified },
    { id: "describe", label: "Describe a product", done: ds.length > 0 || founded.length > 0 },
    { id: "fund", label: "Add NEAR for the launch", done: a.balance >= required || founded.length > 0 },
    { id: "launch", label: "Launch your company", done: founded.length > 0 },
    { id: "approve", label: "Approve the plan", done: founded.some((c) => c.tasks.length > 0) },
  ];
  return {
    accountId: a.id, loginMethod: a.loginMethod, email: { ...a.email, address: mask(a.email.address), pending: mask(a.email.pending) }, needsEmailForCompany: !a.email.verified,
    companies: cs.map((c) => { const x = access(c, a.id)!; return { companyId: c.id, slug: c.slug, name: c.name, isFounder: x.founder, admin: x.admin, scopes: x.scopes, departmentId: x.departmentId }; }),
    companyIds: cs.map((c) => c.id),
    drafts: ds.map((d) => ({ id: d.id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt, estimate: d.estimate })),
    home: { view: cs.length ? "overview" : "welcome", openCompanyId: (last ?? cs[0])?.id ?? null, demo: "/v1/demo" },
    balance: { exists: a.balance > 0n, availableYocto: a.balance.toString(), availableNear: (Number(a.balance / (NEAR / 100n)) / 100).toString() },
    funding: { recommendedYocto: required.toString(), recommendedNear: (Number(required / (NEAR / 100n)) / 100).toString() },
    pendingRefund: { yocto: "0", near: "0" },
    setup: { steps, next: steps.find((s) => !s.done)?.id ?? null, completed: steps.filter((s) => s.done).length, total: steps.length, showBanner: steps.some((s) => !s.done) },
  };
}
function inboxView(a: Account) {
  const items: Json[] = [];
  for (const n of a.alerts) items.push({ id: n.id, kind: "alert", companyId: n.companyId ?? null, slug: n.companyId ? slugOf(n.companyId) : null, title: n.title, body: n.body ?? "", at: n.at, urgent: Boolean(n.urgent), action: n.url ? { type: "open", url: n.url } : null });
  for (const c of myCompanies(a.id)) {
    const x = access(c, a.id)!;
    if (has(x, "approve")) for (const card of c.approvals.filter((k) => k.status === "pending" && inTeam(x, k.payload.department_id))) items.push({ id: `approval:${card.id}`, kind: "approval", companyId: c.id, slug: c.slug, title: card.kind === "seller" ? "A new seller needs your approval" : card.kind === "daily-cap" ? "The daily cap is reached" : "A purchase needs your approval", body: [card.payload.title, card.amount && `$${(Number(card.amount) / 1e6).toFixed(2)}`].filter(Boolean).join(" · "), at: card.createdAt, urgent: true, action: { type: "approve", cardId: card.id, route: `POST /v1/approvals/${card.id}` } });
    if (has(x, "builder", "code")) for (const r of c.reports.filter((k) => inTeam(x, k.departmentId) && now() - Date.parse(k.updatedAt) < 3 * DAY).slice(0, 4)) items.push({ id: `report:${r.id}:${r.outcome}`, kind: "report", companyId: c.id, slug: c.slug, title: `${r.team}: ${r.title}`, body: r.summary, at: r.updatedAt, urgent: r.outcome === "paused" || r.outcome === "failed", action: { type: "report", reportId: r.id } });
  }
  if (a.email.verified) for (const inv of invites.filter((i) => i.onChain && i.status === "pending" && i.email === a.email.address && Date.parse(i.expiresAt) > now())) items.push({ id: `invite:${inv.id}`, kind: "invite", companyId: inv.companyId, slug: slugOf(inv.companyId), title: `You're invited to ${company(inv.companyId).name}`, body: `Role: ${inv.template}${inv.departments.length ? ` · team: ${inv.departments.join(", ")}` : ""}`, at: inv.createdAt, urgent: false, action: { type: "accept_invite", route: `POST /v1/inbox/invites/${inv.id}/accept` } });
  const out = items.map((i) => ({ ...i, read: a.read.has(i.id) })).sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return { items: out, unread: out.filter((i) => !i.read).length };
}

/* ---------- the simulated chain ---------- */
function applyTx(accountId: string, t: Json): string {
  const a = account(accountId);
  const { methodName, args } = t.actions[0].params as { methodName: string; args: Json };
  if (t.signerId && t.signerId !== accountId) throw new Http(400, "chain_failure", "Smart contract panicked: only the named signer may sign this transaction");
  const fail = (m: string) => { throw new Http(400, "chain_failure", m); };
  const hash = bs58.encode(randomBytes(32));
  const founderOnly = (c: Company) => c.founder === accountId || fail("Smart contract panicked: only the founder can do this");
  const adminOnly = (c: Company) => access(c, accountId)?.admin || fail("Smart contract panicked: not allowed");
  if (methodName === "create_company") {
    const existing = companies.get(args.slug);
    if (existing && existing.founder !== accountId) fail("Smart contract panicked: this company name is already taken");
    if (a.balance < CREATE_COMPANY) fail("Your wallet doesn't hold enough NEAR for this transaction.");
    if (!existing) {
      a.balance -= CREATE_COMPANY;
      const c = makeCompany(args.slug, args.name, accountId, { dailyCap: BigInt(args.daily_cap) });
      c.pending = pendingCreates.get(args.slug);
      emit("company_created", c, { company_id: c.id });
    }
  } else {
    const c = company(t.receiverId);
    if (methodName === "create_department") {
      founderOnly(c);
      if (!c.teams.some((x) => x.name === args.name)) {
        if (a.balance < CREATE_TEAM) fail("Your wallet doesn't hold enough NEAR for this transaction.");
        a.balance -= CREATE_TEAM;
        addTeam(c, args.name, BigInt(args.budget));
        emit("department_created", c, { name: args.name }, dept(args.name, c.slug));
      }
      bindPlan(c);
    } else if (methodName === "set_caps") { founderOnly(c); c.dailyCap = BigInt(args.daily_cap); }
    else if (methodName === "freeze") { adminOnly(c); c.frozen = true; emit("frozen", c); for (const [id] of [...c.members, [c.founder]] as Array<[string]>) account(id).alerts.unshift({ id: nid("notification"), companyId: c.id, title: `${c.name} is paused`, body: "All spending is paused until the founder resumes.", at: iso(now()), urgent: true, url: "/settings/keys" }); }
    else if (methodName === "unfreeze") { founderOnly(c); c.frozen = false; emit("unfrozen", c); }
    else if (methodName === "approve" || methodName === "reject") {
      const x = access(c, accountId);
      if (!x || !has(x, "approve")) fail("Smart contract panicked: not an approver");
      for (const card of c.approvals.filter((k) => args.ids.some((i: string) => k.requestIds.includes(i)))) {
        card.status = methodName === "approve" ? "approved" : "rejected";
        if (methodName === "approve" && card.amount) {
          const team = c.teams.find((k) => k.departmentId === card.payload.department_id);
          if (team) team.spent += BigInt(card.amount);
          c.spentToday += BigInt(card.amount);
          c.receipts.unshift({ id: nid("rcpt"), kind: "payment", companyId: c.id, departmentId: card.payload.department_id ?? null, actor: accountId, amount: card.amount, token: "USDC", rail: "x402", chainId: "84532", foreignTx: `0x${sha(card.id)}`, verifiedOnChain: true, requestId: card.requestIds[0], payload: { seller: card.payload.seller_id, title: card.payload.title }, nearTx: hash, createdAt: iso(now()) });
        }
        emit(methodName === "approve" ? "purchase_approved" : "purchase_rejected", c, { card_id: card.id }, card.payload.department_id ?? null);
      }
    } else if (methodName === "dept_call") {
      adminOnly(c);
      for (const call of args.calls as Json[]) {
        const team = c.teams.find((k) => k.name === call.department || k.departmentId === call.department);
        if (call.method === "assign_task") {
          const plan = c.plans.find((p) => p.id === call.args.plan_id);
          const f = plan?.features.find((k: Json) => k.key === call.args.key);
          if (plan && f && !c.tasks.some((k) => k.planId === plan.id && k.key === f.key)) {
            c.tasks.push({ id: nid("task"), key: f.key, planId: plan.id, title: f.title, tag: f.tag, size: f.size, status: "queued", departmentId: dept(f.team, c.slug), tier: plan.tier, pinnedModel: null, estP50: f.estimate.p50, estP90: f.estimate.p90, cap: f.estimate.cap, attempts: 0, updatedAt: iso(now()) });
            plan.approvedAt ??= iso(now());
          }
          emit("task_assigned", c, { key: call.args.key }, team?.departmentId ?? null);
        } else if (call.method === "top_up_budget" && team) team.budget = BigInt(call.args.budget);
        else if (call.method === "pause" && team) team.frozen = true;
        else if (call.method === "allow_seller") void 0;
        else if (call.method === "set_task_tier") { const k = c.tasks.find((x) => x.id === call.args.task_id); if (k) Object.assign(k, { tier: call.args.tier ?? k.tier, pinnedModel: call.args.pinned_model ?? null }); }
        else if (call.method === "set_evm_config" && team) void 0;
      }
    } else if (methodName === "invite") { founderOnly(c); const inv = invites.find((i) => i.codeHash === args.invite_hash); if (inv) { inv.onChain = true; outbox.push({ to: inv.email, companyId: c.id, link: `/invite?code=${inv.code}` }); for (const acc of accounts.values()) if (acc.email.verified && acc.email.address === inv.email) emit("grant_set", null, { invite: inv.id }, null, acc.id); } }
    else if (methodName === "accept_invite") {
      const inv = invites.find((i) => i.code === args.code && i.companyId === c.id);
      if (!inv || inv.status !== "pending" || !inv.onChain) fail("Smart contract panicked: invite not found or already used");
      if (a.balance < NEAR / 100n) fail("Your wallet doesn't hold enough NEAR for this transaction.");
      inv!.status = "accepted";
      inv!.acceptedBy = accountId;
      const scopes = TEMPLATES[inv!.template];
      c.members.set(accountId, { scopes: scopes.filter((s) => s !== "admin"), admin: scopes.includes("admin"), departmentId: inv!.template !== "admin" && inv!.departments.length === 1 ? dept(inv!.departments[0], c.slug) : null });
      emit("grant_set", c, { account: accountId });
    } else if (methodName === "revoke") { founderOnly(c); c.members.delete(args.account); c.viewKeys.delete(args.account); emit("grant_revoked", c, { account: args.account }); }
    else if (methodName === "request_withdrawal") {
      founderOnly(c);
      let left = BigInt(args.amount);
      for (const team of c.teams) { const take = team.funded < left ? team.funded : left; team.funded -= take; left -= take; }
      if (left > 0n) fail("Smart contract panicked: not enough funds to withdraw");
      c.receipts.unshift({ id: nid("rcpt"), kind: "withdrawal", companyId: c.id, departmentId: null, actor: accountId, amount: args.amount, token: "USDC", rail: args.chain, chainId: null, foreignTx: null, verifiedOnChain: true, requestId: args.withdrawal_id, payload: { seller: `Withdrawal to ${args.to}`, to: args.to }, nearTx: hash, createdAt: iso(now()) });
      emit("withdrawal_requested", c, { company_id: c.id, withdrawal_id: args.withdrawal_id, amount: args.amount, token: "usdc", to: args.to });
    }
    else if (methodName === "register_view_key") { if (!access(c, accountId)) fail("Smart contract panicked: not a member"); }
    else if (methodName === "rotate_code_key") { founderOnly(c); c.codeKeyVersion = args.version; }
    else if (methodName === "register_agent") { adminOnly(c); const team = c.teams.find((k) => k.departmentId === args.department); if (team && !team.agents.some((g) => g.publicKey === args.public_key)) team.agents.push({ publicKey: args.public_key, role: args.role, status: "running" }); emit("agent_registered", c, {}, team?.departmentId ?? null); }
    else if (methodName === "fire_agent") { adminOnly(c); for (const team of c.teams) team.agents = team.agents.filter((g) => g.publicKey !== args.public_key); }
    else fail(`Smart contract panicked: unknown method ${methodName}`);
  }
  txLog.set(hash, { accountId, method: methodName, receiverId: t.receiverId });
  return hash;
}
const pendingCreates = new Map<string, { teams: Array<{ team: string; monthlyCap: bigint }>; planId?: string }>();
function bindPlan(c: Company) {
  const p = c.pending ?? pendingCreates.get(c.slug);
  if (!p?.planId || c.teams.length < p.teams.length) return;
  const d = drafts.get(p.planId);
  if (!d || d.status === "launched") return;
  Object.assign(d, { status: "launched", companyId: c.id });
  c.plans.push({ id: d.id, title: d.title, tier: d.tier, status: "launched", features: d.features, estimate: d.estimate, approvedAt: null, description: d.description });
}

/* ---------- http ---------- */
const routes: Array<{ method: string; re: RegExp; keys: string[]; fn: (ctx: Ctx) => unknown | Promise<unknown> }> = [];
type Ctx = { p: Record<string, string>; q: URLSearchParams; body: Json; me: Account; res: ServerResponse; req: IncomingMessage; raw?: (status: number, text: string, type: string) => void };
function on(method: string, path: string, fn: (ctx: Ctx) => unknown, auth = true) {
  const keys: string[] = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => (keys.push(k), "([^/]+)"))}$`);
  routes.push({ method, re, keys, fn: Object.assign(fn, { auth }) });
}
const pub = (method: string, path: string, fn: (ctx: Ctx) => unknown) => on(method, path, fn, false);
const notImplemented = (feature: string, status: "planned" | "unsupported", message: string, replacement?: string) => () => { throw new Http(501, "not_implemented", message, { feature, status, ...(replacement ? { replacement } : {}) }); };

pub("GET", "/health", () => ({ ok: true, contract: "2026-11-13" }));
pub("GET", "/v1/auth/challenge", () => {
  const nonce = randomBytes(32).toString("base64");
  challenges.set(nonce, now() + 5 * 60_000);
  return { message: "Sign in to BuilderOS", recipient: "builderos.sim", nonce, expiresAt: iso(now() + 5 * 60_000), accountBound: false };
});
pub("POST", "/v1/auth/verify", ({ body }) => {
  const exp = challenges.get(body.nonce);
  challenges.delete(body.nonce); // a challenge works once
  if (!exp || exp < now()) throw new Http(401, "unauthenticated", "That sign-in request expired. Try again.");
  const pk = bs58.decode(String(body.publicKey).replace(/^ed25519:/, ""));
  const msg = Buffer.from(body.message, "utf8");
  const rec = Buffer.from("builderos.sim", "utf8");
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const hash = createHash("sha256").update(Buffer.concat([u32(2 ** 31 + 413), u32(msg.length), msg, Buffer.from(body.nonce, "base64"), u32(rec.length), rec, Buffer.from([0])])).digest();
  if (!ed25519.verify(Buffer.from(body.signature, "base64"), hash, pk)) throw new Http(401, "unauthenticated", "The signature doesn't match.");
  if (Buffer.from(pk).toString("hex") !== body.accountId) throw new Http(401, "unauthenticated", "The key doesn't belong to this account.");
  const a = account(body.accountId, body.loginMethod);
  a.loginMethod = body.loginMethod ?? a.loginMethod;
  if (a.loginMethod === "privy" && !a.email.verified && !privyEmailOff.has(a.id)) a.email = { address: `${a.id.slice(0, 6)}@privy.test`, verified: true, source: "privy", pending: null };
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { accountId: a.id, expiresAt: now() + DAY });
  return { accountId: a.id, token, expiresAt: iso(now() + DAY), loginMethod: a.loginMethod, email: { ...a.email, address: mask(a.email.address) } };
});
on("POST", "/v1/auth/logout", ({ req }) => (sessions.delete(String(req.headers.authorization).slice(7)), { ok: true }));
on("GET", "/v1/auth/me", ({ me }) => meView(me));
on("POST", "/v1/auth/fund-testnet", ({ me }) => {
  if (!me.funded) { me.funded = true; me.balance += 25n * NEAR; }
  return { ok: true };
});

on("GET", "/v1/account", ({ me }) => ({ accountId: me.id, loginMethod: me.loginMethod, email: { ...me.email, address: mask(me.email.address), pending: mask(me.email.pending) }, needsEmailForCompany: !me.email.verified, preferences: me.prefs }));
on("POST", "/v1/account/email", ({ me, body }) => {
  if (!/.+@.+\..+/.test(body.email ?? "")) throw new Http(400, "invalid_request", "Enter a valid email address.");
  const value = String(100000 + (parseInt(sha(body.email).slice(0, 6), 16) % 900000));
  me.email.pending = body.email;
  me.code = { value, tries: 0 };
  return { ok: true, sentTo: mask(body.email), expiresAt: iso(now() + 600_000), devCode: value };
});
on("POST", "/v1/account/email/verify", ({ me, body }) => {
  if (!me.code || !me.email.pending) throw new Http(404, "not_found", "No code is waiting. Send a new one.");
  if (me.code.tries >= 5) throw new Http(429, "too_many_attempts", "Too many wrong codes.");
  if (body.code !== me.code.value) { me.code.tries++; throw new Http(400, "wrong_code", `That code doesn't match. ${5 - me.code.tries} tries left.`); }
  me.email = { address: me.email.pending, verified: true, source: "code", pending: null };
  me.code = undefined;
  return { ok: true, email: { ...me.email, address: mask(me.email.address) } };
});
// Verify the email from a Privy identity token (the fallback when sign-in couldn't do it)
on("POST", "/v1/account/email/privy", ({ me, body }) => {
  const m = /^test-identity:(.+@.+)$/.exec(String(body.identityToken ?? ""));
  if (!m) throw new Http(401, "bad_privy_token", "The sign-in token is invalid or expired.");
  me.email = { address: m[1], verified: true, source: "privy", pending: null };
  return { ok: true, email: { ...me.email, address: mask(me.email.address) } };
});
on("GET", "/v1/account/preferences", ({ me }) => ({ preferences: me.prefs }));
on("PATCH", "/v1/account/preferences", ({ me, body }) => {
  if (body.lastCompanyId) authorize(me.id, body.lastCompanyId, "any");
  if ("lastCompanyId" in body) me.prefs.lastCompanyId = body.lastCompanyId ? company(body.lastCompanyId).id : null;
  if (body.dismissed) me.prefs.dismissed = body.dismissed;
  return { preferences: me.prefs };
});

on("GET", "/v1/overview", ({ me }) => {
  const view = meView(me);
  const cs = myCompanies(me.id).map((c) => overviewCompany(c, access(c, me.id)!));
  const add = (f: (c: Json) => string | undefined) => cs.reduce((s, c) => s + BigInt(f(c) ?? 0), 0n).toString();
  return {
    home: view.home, email: view.email,
    totals: { companies: cs.length, founded: cs.filter((c) => c.role === "founder").length, spentToday: add((c) => c.money?.spentToday), budget: add((c) => c.money?.budget), spent: add((c) => c.money?.spent), pendingApprovals: cs.reduce((s, c) => s + (c.approvals?.pending ?? 0), 0), tasksRunning: cs.reduce((s, c) => s + (c.work?.tasks.running ?? 0), 0), tasksDone: cs.reduce((s, c) => s + (c.work?.tasks.done ?? 0), 0), needsAttention: cs.reduce((s, c) => s + (c.work?.needsAttention ?? 0), 0) },
    companies: cs, drafts: view.drafts, inbox: { unread: inboxView(me).unread },
  };
});
on("GET", "/v1/inbox", ({ me }) => inboxView(me));
on("POST", "/v1/inbox/read", ({ me, body }) => {
  const ids: string[] = body.all ? inboxView(me).items.map((i) => i.id) : (body.ids ?? []);
  ids.forEach((i) => me.read.add(i));
  return { ok: true, marked: ids.length };
});
on("POST", "/v1/inbox/invites/:id/accept", ({ me, p }) => {
  const inv = invites.find((i) => i.id === p.id && me.email.verified && i.email === me.email.address);
  if (!inv) throw new Http(404, "not_found", "That invite isn't for this account.");
  if (Date.parse(inv.expiresAt) < now()) throw new Http(410, "invite_expired", "This invite has expired.");
  return { companyId: inv.companyId, transaction: tx(inv.companyId, "accept_invite", { code: inv.code }, "0", me.id) };
});

function demoCompany() {
  const c = makeCompany("lumen-notes-demo", "Lumen Notes", "founder.demo", { filled: true });
  companies.delete("lumen-notes-demo"); // the sample is never a real company: nobody can open or write to it
  return c;
}
let demoCache: Company | null = null;
pub("GET", "/v1/demo", ({ q }) => {
  const c = (demoCache ??= demoCompany());
  const a = { founder: false, admin: false, scopes: ALL_SCOPES, departmentId: null as string | null, expiresAtMs: null, demo: true };
  const view = companyView(c, a);
  return { demo: true, readOnly: true, notice: "Sample company with invented data.", ...view, overview: { ...overviewCompany(c, a), role: "demo" }, teams: c.teams.map((t) => teamView(t, c)), analytics: analyticsView(c, a, q.get("range") ?? "30d"), reports: reportsView(c, a, { days: 30 }), approvals: c.approvals, plan: c.plans[0], tasks: c.tasks, members: [{ account_id: "founder.demo", role: "founder", department_id: null }, { account_id: "ada.demo", scopes: ["view", "approve"], department_id: null }, { account_id: "kemi.demo", scopes: ["view", "builder", "code"], department_id: dept("build", c.slug) }] };
});

/* drafts */
const myDraft = (me: Account, id: string) => {
  const d = drafts.get(id);
  if (!d || d.author !== me.id) throw new Http(404, "not_found", "That draft doesn't exist.");
  return d;
};
on("POST", "/v1/drafts", ({ me, body }) => ({ draft: draftView(newDraft(me.id, body)) }));
on("GET", "/v1/drafts", ({ me }) => ({ drafts: [...drafts.values()].filter((d) => d.author === me.id && d.status !== "launched").map(draftView) }));
on("GET", "/v1/drafts/:id", ({ me, p }) => ({ draft: draftView(myDraft(me, p.id)) }));
on("PATCH", "/v1/drafts/:id", ({ me, p, body }) => {
  const d = myDraft(me, p.id);
  if (d.status === "launched") throw new Http(409, "draft_already_launched", "This draft is already in a company.", { companyId: d.companyId });
  if (body.title) d.title = body.title;
  if (body.tier) { d.tier = body.tier; d.features = planFeatures(body.tier).filter((f) => d.features.some((x: Json) => x.key === f.key)); }
  if (body.description) { d.description = body.description; d.features = planFeatures(d.tier); }
  if (body.removeKeys) d.features = d.features.filter((f: Json) => !body.removeKeys.includes(f.key));
  if (body.features) d.features = body.features.map((f: Json) => ({ ...d.features.find((x: Json) => x.key === f.key), ...f }));
  d.estimate = sumEst(d.features);
  d.suggestedSetup = suggested(d.suggestedSetup.name === d.title ? d.title : d.title, d.suggestedSetup.slug, d.features);
  d.updatedAt = iso(now());
  return { draft: draftView(d) };
});
on("DELETE", "/v1/drafts/:id", ({ me, p }) => (myDraft(me, p.id), drafts.delete(p.id), { ok: true }));
on("POST", "/v1/drafts/:id/launch", ({ me, p, body }) => {
  const d = myDraft(me, p.id);
  if (d.status === "launched") throw new Http(409, "draft_already_launched", "This draft is already in a company.", { companyId: d.companyId });
  const { c } = authorize(me.id, body.companyId, "admin");
  Object.assign(d, { status: "launched", companyId: c.id });
  const plan = { id: d.id, title: d.title, tier: d.tier, status: "launched", features: d.features, estimate: d.estimate, approvedAt: null, description: d.description };
  c.plans.push(plan);
  return { plan, next: `POST /v1/plans/${d.id}/approve` };
});

/* companies */
on("POST", "/v1/companies", ({ me, body }) => {
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(body.slug ?? "") || !body.name) throw new Http(400, "invalid_request", "name and slug are required.");
  const existing = companies.get(body.slug);
  if (existing && existing.founder !== me.id) throw new Http(409, "slug_taken", "That name is taken. Pick another.");
  const d = body.planId ? drafts.get(body.planId) : null;
  if (body.planId && (!d || d.author !== me.id)) throw new Http(404, "not_found", "That draft doesn't exist.");
  if (d?.status === "launched" && d.companyId !== companyId(body.slug)) throw new Http(409, "draft_already_launched", "This draft is already in a company.", { companyId: d.companyId });
  // sending the same slug again resumes a create that was started (no email check)
  const resuming = Boolean(existing) || (pendingCreates.has(body.slug) && d?.launchCompanyId === companyId(body.slug));
  if (!resuming && !me.email.verified) throw new Http(403, "email_required", "Verify an email before creating a company.", { next: ["POST /v1/account/email", "POST /v1/account/email/verify"] });
  const teams: Array<{ team: string; monthlyCap: bigint }> = existing?.pending?.teams ?? pendingCreates.get(body.slug)?.teams ?? (body.teams ?? d?.suggestedSetup.teams ?? [{ team: "build", monthlyCap: "100000000" }]).map((t: Json) => ({ team: t.team, monthlyCap: parseMoney(t.monthlyCap) }));
  const dailyCap = body.dailyCap ? parseMoney(body.dailyCap) : BigInt(d?.suggestedSetup.dailyCap ?? "50000000");
  const missing = teams.filter((t) => !existing?.teams.some((x) => x.name === t.team));
  const required = (existing ? 0n : CREATE_COMPANY) + CREATE_TEAM * BigInt(missing.length);
  if (me.balance < required) throw new Http(402, "insufficient_funds", "Your wallet needs more NEAR to create this company.", { requiredYocto: required.toString(), availableYocto: me.balance.toString(), funding: { testnet: "POST /v1/auth/fund-testnet" } });
  pendingCreates.set(body.slug, { teams, planId: body.planId });
  if (existing) existing.pending ??= { teams, planId: body.planId };
  if (d && d.status === "draft") Object.assign(d, { status: "launching", launchCompanyId: companyId(body.slug) });
  const id = companyId(body.slug);
  const transactions = [...(existing ? [] : [tx(FACTORY, "create_company", { slug: body.slug, name: body.name, daily_cap: dailyCap.toString() }, CREATE_COMPANY.toString(), me.id)]), ...missing.map((t) => tx(id, "create_department", { name: t.team, budget: t.monthlyCap.toString() }, CREATE_TEAM.toString(), me.id))];
  return { companyId: id, transactions, resumed: Boolean(existing), complete: !transactions.length, missing: missing.map((t) => t.team), verify: `GET /v1/companies/creation/${body.slug}`, funding: {}, requiredYocto: required.toString(), teams: teams.map((t) => ({ team: t.team, monthlyCap: t.monthlyCap.toString() })), dailyCap: dailyCap.toString(), planId: body.planId };
});
on("GET", "/v1/companies/creation/:slug", ({ me, p }) => {
  const c = companies.get(p.slug);
  return { slugTaken: Boolean(c), founderIsYou: c?.founder === me.id, companyExists: Boolean(c), departments: c?.teams.map((t) => t.name) ?? [], dailyCap: c?.dailyCap.toString() ?? null, pendingRefundYocto: "0", plansBound: c?.founder === me.id ? c.plans.map((x) => x.id) : [] };
});
on("GET", "/v1/companies", ({ me }) => ({ companies: meView(me).companies }));
on("GET", "/v1/companies/:id", ({ me, p }) => { const { c, a } = authorize(me.id, p.id, "any"); return companyView(c, a); });
on("GET", "/v1/teams", ({ me, q }) => { const { c, a } = authorize(me.id, q.get("companyId"), "any"); return { teams: teamsFor(c, a).map((t) => teamView(t, c)), units: "micro-USDC" }; });
on("POST", "/v1/policy", ({ me, body }) => {
  if (body.perTxLimit || body.autoApproveLimit || body.tier) return notImplemented("policy.limits", "unsupported", "Per-purchase limits can't be changed after a company is created.")();
  if (body.dailyCap) { const { c } = authorize(me.id, body.companyId, "founder"); return { transactions: [tx(c.id, "set_caps", { daily_cap: parseMoney(body.dailyCap).toString() }, "1", me.id)] }; }
  const { c } = authorize(me.id, body.companyId, "admin");
  const team = c.teams.find((t) => t.name === body.team || t.departmentId === body.team);
  if (!team) throw new Http(400, "invalid_request", "team is required.");
  const next = body.monthlyCap ? parseMoney(body.monthlyCap) : team.budget + parseMoney(body.budgetIncrease);
  if (next < team.budget) throw new Http(409, "budget_decrease_unsupported", "Budgets can only go up. Pause the team instead.");
  if (c.contractVersion < 3) throw new Http(409, "contract_upgrade_required", "Raising a budget needs contract v3.", { how: "Propose the upgrade, wait 24 hours, then apply it. Until then this company keeps its original budgets." });
  return { transactions: [tx(c.id, "dept_call", { calls: [{ department: team.name, method: "top_up_budget", args: { budget: next.toString() } }] }, "1", me.id)] };
});
on("GET", "/v1/companies/:id/payments", ({ me, p }) => { const { c, a } = authorize(me.id, p.id, ["view", "approve"]); return { teams: teamsFor(c, a).map((t) => ({ name: t.name, departmentId: t.departmentId, chainId: 84532, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", address: t.paymentAddress, derivedAddress: t.paymentAddress, configured: c.contractVersion >= 3 })) }; });
on("POST", "/v1/companies/:id/payments/configure", ({ me, p }) => {
  const { c } = authorize(me.id, p.id, "admin");
  if (c.contractVersion < 3) throw new Http(409, "contract_upgrade_required", "Payment setup needs contract v3.", { how: "Propose the upgrade, wait 24 hours, then apply it." });
  return { transactions: [tx(c.id, "dept_call", { calls: c.teams.map((t) => ({ department: t.name, method: "set_evm_config", args: {} })) }, String(c.teams.length), me.id)] };
});

/* money */
on("GET", "/v1/deposit", ({ me, q }) => {
  const { c, a } = authorize(me.id, q.get("companyId"), ["view", "approve"]);
  const ts = teamsFor(c, a);
  return { supported: false, address: null, method: "team_addresses", reason: "near_intents_unavailable", message: "NEAR Intents isn't on testnet, so there's no single company address. Fund each team's address directly.", tokens: [{ symbol: "USDC", network: "base-sepolia" }], units: "micro-USDC", balance: ts.reduce((s, t) => s + t.funded, 0n).toString(), teams: ts.map((t) => ({ team: t.name, departmentId: t.departmentId, address: t.paymentAddress, chainId: 84532, token: "USDC", balance: t.funded.toString() })), event: "deposit_received" };
});
on("GET", "/v1/approvals", ({ me, q }) => { const { c, a } = authorize(me.id, q.get("companyId"), ["approve"]); return { cards: c.approvals.filter((k) => k.status === (q.get("status") ?? "pending") && (a.departmentId ? k.payload.department_id === a.departmentId && k.kind !== "daily-cap" : true)) }; });
on("POST", "/v1/approvals/:id", ({ me, p, body }) => {
  const c = [...companies.values()].find((x) => x.approvals.some((k) => k.id === p.id));
  if (!c) throw new Http(404, "not_found", "That approval doesn't exist.");
  const { a } = authorize(me.id, c.id, ["approve"]);
  const card = c.approvals.find((k) => k.id === p.id)!;
  if (card.status !== "pending") throw new Http(409, "conflict", "This was already decided.");
  if (body.alwaysAllow && !a.admin) throw new Http(403, "forbidden", "Only an admin can always allow a seller.", { required: ["admin"] });
  if (body.alwaysAllow && c.contractVersion < 3) throw new Http(409, "contract_upgrade_required", "Always allowing a seller needs contract v3.", { how: "Propose the upgrade, wait 24 hours, then apply it." });
  const transactions = [tx(c.id, body.decision === "approve" ? "approve" : "reject", { ids: card.requestIds }, "1", me.id), ...(body.alwaysAllow && body.decision === "approve" ? [tx(c.id, "dept_call", { calls: [{ department: slugOf(card.payload.department_id), method: "allow_seller", args: { seller: card.payload.seller_id } }] }, "1", me.id)] : [])];
  return { card, transaction: transactions[0], transactions };
});
on("GET", "/v1/ledger", ({ me, q, raw }) => {
  const { c, a } = authorize(me.id, q.get("companyId"), ["view", "approve"]);
  const rows = c.receipts.filter((r) => inTeam(a, r.departmentId) && (!q.get("kind") || r.kind === q.get("kind"))).slice(0, Number(q.get("limit") ?? 100));
  if (q.get("format") === "csv") return raw!(200, ["id,kind,team,amount_micro_usdc,seller,created_at", ...rows.map((r) => [r.id, r.kind, slugOf(r.departmentId ?? ""), r.amount, r.payload.seller ?? "", r.createdAt].join(","))].join("\n"), "text/csv");
  return { receipts: rows };
});
on("GET", "/v1/receipts/:id", ({ me, p }) => {
  for (const c of myCompanies(me.id)) { const r = c.receipts.find((x) => x.id === p.id); if (r) { authorize(me.id, c.id, ["view", "approve"]); return { receipt: r }; } }
  throw new Http(404, "not_found", "That receipt doesn't exist.");
});
on("POST", "/v1/withdrawals", ({ me, body }) => {
  const { c } = authorize(me.id, body.companyId, "founder");
  if (!/^\d+$/.test(body.amount ?? "") || !body.to || !["near", "base", "ethereum", "arbitrum", "solana"].includes(body.chain ?? "near")) throw new Http(400, "invalid_request", "amount, to and chain are required.");
  const available = c.teams.reduce((n, t) => n + t.funded, 0n); // stands in for the company treasury
  const want = BigInt(body.amount);
  if (want > available) throw new Http(409, "insufficient_funds", `only ${available} available (reserved funds are excluded)`);
  const withdrawalId = nid("wd");
  return { plan: { withdrawalId, amount: body.amount, token: "usdc", to: body.to, chain: body.chain ?? "near", sources: [{ from: "intents", amount: body.amount }], available: { intents: available.toString(), tempoUnreserved: "0" } }, transaction: tx(c.id, "request_withdrawal", { withdrawal_id: withdrawalId, amount: body.amount, to: body.to, chain: body.chain ?? "near" }, "1", me.id) };
});
on("POST", "/v1/withdraw/quote", notImplemented("withdraw.quote", "unsupported", "Withdrawal quotes aren't a separate step.", "POST /v1/withdrawals (the plan is the quote)"));
on("GET", "/v1/services", notImplemented("services", "planned", "Recurring services aren't available yet."));
on("POST", "/v1/freeze", ({ me, body }) => {
  const { c } = authorize(me.id, body.companyId, "admin");
  if (body.departments?.length) return { transactions: [tx(c.id, "dept_call", { calls: body.departments.map((d: string) => ({ department: d, method: "pause", args: {} })) }, String(body.departments.length), me.id)] };
  return { transactions: [tx(c.id, "freeze", {}, "1", me.id)] };
});
on("POST", "/v1/unfreeze", ({ me, body }) => { const { c } = authorize(me.id, body.companyId, "founder"); return { transactions: [tx(c.id, "unfreeze", {}, "1", me.id)] }; });

/* analytics, reports */
on("GET", "/v1/analytics", ({ me, q }) => { const { c, a } = authorize(me.id, q.get("companyId"), "any"); return analyticsView(c, a, q.get("range") ?? "30d", q.get("team") ?? undefined); });
on("GET", "/v1/reports", ({ me, q }) => { const { c, a } = authorize(me.id, q.get("companyId"), "any"); return reportsView(c, a, { team: q.get("team") ?? undefined, days: q.get("days") ? Number(q.get("days")) : 7, outcome: q.get("outcome") ?? undefined }); });
on("GET", "/v1/reports/:id", ({ me, p }) => {
  for (const c of myCompanies(me.id)) {
    const r = c.reports.find((x) => x.id === p.id);
    if (!r) continue;
    const a = access(c, me.id)!;
    if (!inTeam(a, r.departmentId)) throw new Http(403, "forbidden", "This report belongs to another team.");
    return { report: reportView(r, a), attempts: c.reports.filter((x) => x.taskId === r.taskId).sort((x, y) => x.attempt - y.attempt).map((x) => ({ id: x.id, attempt: x.attempt, outcome: x.outcome, at: x.updatedAt })) };
  }
  throw new Http(404, "not_found", "That report doesn't exist.");
});

/* plans, tasks, agents */
const planView = (c: Company, pl: Json) => ({ ...pl, tasks: c.tasks.filter((t) => t.planId === pl.id).reduce<Record<string, number>>((m, t) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {}) });
const findPlan = (me: Account, id: string) => {
  for (const c of myCompanies(me.id)) { const pl = c.plans.find((x) => x.id === id); if (pl) return { c, pl }; }
  return null;
};
on("GET", "/v1/plans", ({ me, q }) => { const { c } = authorize(me.id, q.get("companyId"), ["builder", "code"]); return { plans: c.plans.map((pl) => planView(c, pl)) }; });
on("POST", "/v1/plans", ({ me, body }) => {
  if (!body.companyId) return { draft: draftView(newDraft(me.id, body)) };
  const { c } = authorize(me.id, body.companyId, ["builder", "code"]);
  if (String(body.description ?? "").trim().length < 8) throw new Http(400, "invalid_request", "Describe what to build in a sentence or more.");
  const features = planFeatures(body.tier).slice(0, 3).map((f, i) => ({ ...f, key: `${f.key}-${c.plans.length}-${i}` }));
  const plan = { id: nid("plan"), title: String(body.description).split(/\s+/).slice(0, 5).join(" "), tier: body.tier ?? "standard", status: "launched", features, estimate: sumEst(features), approvedAt: null, description: body.description };
  c.plans.push(plan);
  return { plan };
});
on("GET", "/v1/plans/:id", ({ me, p }) => {
  const d = drafts.get(p.id);
  const f = findPlan(me, p.id);
  if (f) { authorize(me.id, f.c.id, ["builder", "code"]); return { plan: f.pl, tasks: f.c.tasks.filter((t) => t.planId === p.id) }; }
  if (d && d.author === me.id) return { plan: draftView(d), tasks: [] };
  throw new Http(404, "not_found", "That plan doesn't exist.");
});
on("POST", "/v1/plans/:id/approve", ({ me, p }) => {
  let f = findPlan(me, p.id);
  if (!f) {
    const d = drafts.get(p.id);
    if (!d || d.author !== me.id) throw new Http(404, "not_found", "That plan doesn't exist.");
    const c = d.launchCompanyId ? companies.get(slugOf(d.launchCompanyId)) : null;
    if (!c) throw new Http(409, "plan_not_launched", "Launch this draft into a company before approving it.");
    bindPlan(c);
    f = findPlan(me, p.id);
    if (!f) throw new Http(409, "plan_not_launched", "The company is still being created.");
  }
  const { c, pl } = f;
  authorize(me.id, c.id, "admin");
  const todo = pl.features.filter((k: Json) => !c.tasks.some((t) => t.planId === pl.id && t.key === k.key));
  if (!todo.length && pl.approvedAt) throw new Http(409, "plan_already_approved", "This plan is already approved.");
  return { tasks: todo.map((k: Json) => ({ key: k.key, title: k.title })), transactions: [tx(c.id, "dept_call", { calls: todo.map((k: Json) => ({ department: k.team, method: "assign_task", args: { plan_id: pl.id, key: k.key } })) }, String(todo.length), me.id)], resumed: false };
});
on("GET", "/v1/tasks", ({ me, q }) => { const { c, a } = authorize(me.id, q.get("companyId"), ["builder", "code"]); return { tasks: c.tasks.filter((t) => inTeam(a, t.departmentId) && (!q.get("planId") || t.planId === q.get("planId"))) }; });
const findTask = (me: Account, id: string) => {
  for (const c of myCompanies(me.id)) { const t = c.tasks.find((x) => x.id === id); if (t) return { c, t }; }
  throw new Http(404, "not_found", "That task doesn't exist.");
};
on("GET", "/v1/tasks/:id", ({ me, p }) => { const { c, t } = findTask(me, p.id); authorize(me.id, c.id, ["builder", "code"]); return { task: t, hires: [], units: "micro-USDC" }; });
on("PATCH", "/v1/tasks/:id", ({ me, p, body }) => { const { c, t } = findTask(me, p.id); authorize(me.id, c.id, "admin"); return { transactions: [tx(c.id, "dept_call", { calls: [{ department: slugOf(t.departmentId), method: "set_task_tier", args: { task_id: t.id, tier: body.tier, pinned_model: body.pinnedModel ?? null } }] }, "1", me.id)] }; });
on("POST", "/v1/estimate", ({ me, body }) => {
  const { c, t } = findTask(me, body.taskId);
  authorize(me.id, c.id, ["builder", "code"]);
  const base = Number(t.estP50) / 1e6;
  const k = (tier: string) => (tier === "premium" ? 1.8 : tier === "economy" ? 0.6 : 1);
  return { estimate: est(base * (k(body.tier ?? t.tier) / k(t.tier)) * (body.model ? 1.15 : 1)), current: { p50: t.estP50, p90: t.estP90, cap: t.cap }, tiers: { economy: est((base / k(t.tier)) * 0.6), standard: est(base / k(t.tier)), premium: est((base / k(t.tier)) * 1.8) }, units: "micro-USDC" };
});
on("POST", "/v1/agents", ({ me, body }) => { const { c } = authorize(me.id, body.companyId, "admin"); return { transaction: tx(c.id, "register_agent", { department: body.departmentId, public_key: body.publicKey, role: body.role }, "0", me.id) }; });
on("POST", "/v1/agents/:pk/status", ({ me, p, body }) => {
  const { c } = authorize(me.id, body.companyId, "admin");
  const pk = decodeURIComponent(p.pk);
  const agent = c.teams.flatMap((t) => t.agents).find((g) => g.publicKey === pk);
  if (!agent) throw new Http(404, "not_found", "That agent doesn't exist.");
  if (body.status === "fired") return { transaction: tx(c.id, "fire_agent", { public_key: pk }, "0", me.id) };
  agent.status = body.status;
  return { ok: true };
});

/* members, invites, keys */
on("GET", "/v1/members", ({ me, q }) => {
  const { c, a } = authorize(me.id, q.get("companyId"), "any");
  const all = [{ account_id: c.founder, role: "founder", department_id: null, scopes: ALL_SCOPES, has_view_key: c.viewKeys.has(c.founder) }, ...[...c.members].map(([id, g]) => ({ account_id: id, department_id: g.departmentId, scopes: g.admin ? ["admin"] : g.scopes, revoked: false, has_view_key: c.viewKeys.has(id) }))];
  return { members: a.admin ? all : all.filter((m) => m.account_id === me.id), canManage: a.founder };
});
on("POST", "/v1/members/invite", ({ me, body }) => {
  const { c } = authorize(me.id, body.companyId, "founder");
  if (!/.+@.+\..+/.test(body.email ?? "") || !Array.isArray(body.departments) || !body.departments.length || !TEMPLATES[body.template]) throw new Http(400, "invalid_request", "email, departments and template are required.");
  const code = randomBytes(14).toString("base64url");
  const departments = body.departments.length === c.teams.length ? [] : body.departments.map(slugOf);
  const inv = { id: nid("inv"), code, codeHash: sha(code), companyId: c.id, email: String(body.email).toLowerCase(), template: body.template, departments, expiresAt: iso(now() + (body.expiresInDays ?? 30) * DAY), status: "pending", onChain: false, createdAt: iso(now()) };
  invites.push(inv);
  return { inviteId: inv.id, transaction: tx(c.id, "invite", { invite_hash: inv.codeHash }, "1", me.id) };
});
on("GET", "/v1/invites/:code", ({ p }) => {
  const inv = invites.find((i) => i.code === p.code && i.onChain);
  if (!inv) throw new Http(404, "not_found", "That invite doesn't exist.");
  const c = company(inv.companyId);
  const expired = Date.parse(inv.expiresAt) < now();
  return { companyId: c.id, slug: c.slug, companyName: c.name, role: inv.template, departments: inv.departments, expiresAt: inv.expiresAt, status: expired ? "expired" : inv.status, canAccept: inv.status === "pending" && !expired };
});
on("POST", "/v1/invites/accept", ({ me, body }) => {
  const inv = invites.find((i) => i.code === body.code && i.onChain && i.status === "pending" && Date.parse(i.expiresAt) > now());
  if (!inv) throw new Http(404, "not_found", "That invite wasn't found or has expired.");
  return { companyId: inv.companyId, transaction: tx(inv.companyId, "accept_invite", { code: inv.code }, "0") };
});
on("DELETE", "/v1/members/:account", ({ me, p, q }) => { const { c } = authorize(me.id, q.get("companyId"), "founder"); return { transaction: tx(c.id, "revoke", { account: decodeURIComponent(p.account) }, "1", me.id) }; });
on("POST", "/v1/members/:account/grants", notImplemented("members.grants", "unsupported", "A member's access can't be edited on chain.", "DELETE /v1/members/:accountId, then POST /v1/members/invite"));
on("POST", "/v1/keys/view", ({ me, body }) => {
  const { c } = authorize(me.id, body.companyId, "any");
  if (typeof body.x25519PublicKey !== "string" || body.x25519PublicKey.length < 40 || body.x25519PublicKey.length > 60) throw new Http(400, "invalid_request", "x25519PublicKey must be a base64 key.");
  pendingKeys.set(`${c.id}:${me.id}`, body.x25519PublicKey);
  return { transaction: tx(c.id, "register_view_key", { key: body.x25519PublicKey }, "0", me.id), next: "POST /v1/keys/view/confirm" };
});
const pendingKeys = new Map<string, string>();
on("POST", "/v1/keys/view/confirm", ({ me, body }) => {
  const { c } = authorize(me.id, body.companyId, "any");
  const t = txLog.get(body.txHash);
  if (!t) throw new Http(404, "tx_not_found", "That transaction isn't visible yet.");
  if (t.accountId !== me.id || t.method !== "register_view_key" || t.receiverId !== c.id) throw new Http(409, "tx_mismatch", "That transaction doesn't register a key for this account.");
  const key = pendingKeys.get(`${c.id}:${me.id}`)!;
  c.viewKeys.set(me.id, key);
  return { ok: true, accountId: me.id, x25519PublicKey: key };
});
on("GET", "/v1/keys/devices", ({ me, q }) => { const { c } = authorize(me.id, q.get("companyId"), "admin"); return { codeKeyVersion: c.codeKeyVersion, devices: [...c.viewKeys].filter(([id]) => access(c, id)).map(([id, k]) => ({ accountId: id, x25519PublicKey: k, founder: id === c.founder, scopes: access(c, id)!.scopes, departmentId: access(c, id)!.departmentId })) }; });
on("POST", "/v1/keys/code/rotate", ({ me, body }) => { const { c } = authorize(me.id, body.companyId, "founder"); return { currentVersion: c.codeKeyVersion, newVersion: c.codeKeyVersion + 1, transaction: tx(c.id, "rotate_code_key", { version: c.codeKeyVersion + 1 }, "1", me.id), next: ["sign transaction", "GET /v1/keys/devices", "POST /v1/keys/wrapped"] }; });
on("POST", "/v1/keys/wrapped", ({ me, body }) => {
  const { c } = authorize(me.id, body.companyId, "founder");
  if (body.version !== c.codeKeyVersion) throw new Http(409, "version_conflict", "The rotation isn't on chain yet.", { currentVersion: c.codeKeyVersion });
  // a sealed box of a 32-byte key is 32 (ephemeral key) + 32 + 16 (tag) bytes
  if (!Array.isArray(body.keys) || !body.keys.length || body.keys.some((k: Json) => Buffer.from(k.ciphertext, "base64").length !== 80)) throw new Http(400, "invalid_request", "Each key must be a sealed 32-byte key.");
  c.wrapped = body.keys.length;
  return { stored: body.keys.length };
});

/* stream */
on("POST", "/v1/stream/token", ({ me }) => { const token = randomBytes(16).toString("hex"); streamTokens.set(token, me.id); return { token, expiresAt: iso(now() + 15 * 60_000), url: "/v1/stream" }; });
pub("GET", "/v1/stream", ({ q, req, res }) => {
  const accountId = streamTokens.get(q.get("token") ?? "");
  if (!accountId) throw new Http(401, "unauthenticated", "Stream token missing or expired.");
  const last = Number(q.get("lastEventId") ?? req.headers["last-event-id"] ?? 0) || 0;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": req.headers.origin ?? "*" });
  const s = { res, accountId, lastEventId: last };
  streamLog.push({ accountId, lastEventId: last });
  res.write(`event: ready\ndata: ${JSON.stringify({ account: accountId, companies: myCompanies(accountId).map((c) => c.id), resumedAfter: last, expiresAt: iso(now() + 15 * 60_000) })}\n\n`);
  if (last) for (const ev of events.filter((e) => e.id > last)) send(s, ev);
  streams.push(s);
  req.on("close", () => (streams = streams.filter((x) => x !== s)));
  return STREAM;
});
const STREAM = Symbol("stream");

/* ---------- the test wallet's "broadcast", and test controls ---------- */
pub("POST", "/__sim/tx", ({ body }) => {
  if (body.fail) throw new Http(400, "chain_failure", body.fail);
  return { hash: applyTx(body.accountId, body.transaction) };
});
pub("POST", "/__test/reset", () => { reset(); return { ok: true }; });
pub("POST", "/__test/company", ({ body }) => { account(body.founder); const c = makeCompany(body.slug, body.name ?? body.slug, body.founder, { filled: body.filled !== false, version: body.version }); if (body.frozen) c.frozen = true; return { companyId: c.id }; });
pub("POST", "/__test/grant", ({ body }) => { const c = company(body.slug); account(body.accountId); c.members.set(body.accountId, { scopes: body.scopes ?? [], admin: Boolean(body.admin), departmentId: body.team ? dept(body.team, c.slug) : null }); emit("grant_set", c, { account: body.accountId }); return { ok: true }; });
pub("POST", "/__test/revoke", ({ body }) => { const c = company(body.slug); c.members.delete(body.accountId); return { ok: true }; });
pub("POST", "/__test/balance", ({ body }) => { account(body.accountId).balance = BigInt(Math.round(body.near * 100)) * (NEAR / 100n); return { ok: true }; });
pub("POST", "/__test/privy-email-off", ({ body }) => { privyEmailOff.add(body.accountId); return { ok: true }; });
pub("POST", "/__test/email", ({ body }) => { account(body.accountId).email = { address: body.email, verified: true, source: "code", pending: null }; return { ok: true }; });
pub("POST", "/__test/approval", ({ body }) => {
  const c = company(body.slug);
  const card = { id: nid("card"), companyId: c.id, kind: body.kind ?? "single", status: "pending", amount: micro(body.amount ?? 9.5).toString(), requestIds: [nid("req")], payload: { department_id: dept(body.team ?? "build", c.slug), seller_id: body.seller ?? "vercel.x402", reason: "over_limit", title: body.title ?? "Extra build minutes" }, createdAt: iso(now()) };
  c.approvals.unshift(card);
  emit("purchase_yielded", c, { card_id: card.id }, card.payload.department_id);
  return { id: card.id };
});
pub("POST", "/__test/report", ({ body }) => {
  const c = company(body.slug);
  const src = c.reports.find((r) => r.team === (body.team ?? "build"))!;
  const r = { ...src, id: nid("rep"), title: body.title ?? "Fresh report", outcome: body.outcome ?? "done", attempt: 1, taskId: nid("task"), createdAt: iso(now()), updatedAt: iso(now()) };
  c.reports.unshift(r);
  emit("task_reported", c, { report_id: r.id, task_id: r.taskId, title: r.title, outcome: r.outcome, attempt: 1, cost: r.cost }, r.departmentId);
  return { id: r.id };
});
pub("POST", "/__test/deposit", ({ body }) => { const c = company(body.slug); const t = c.teams.find((x) => x.name === body.team)!; t.funded += micro(body.amount); emit("deposit_received", c, { company_id: c.id, department_id: t.departmentId, address: t.paymentAddress, chain_id: 84532, token: "USDC", amount: micro(body.amount).toString(), balance: t.funded.toString() }, t.departmentId); return { ok: true }; });
pub("POST", "/__test/expire-sessions", ({ body }) => { for (const [k, s] of sessions) if (!body.accountId || s.accountId === body.accountId) sessions.delete(k); return { ok: true }; });
pub("POST", "/__test/drop-streams", () => { const n = streams.length; for (const s of streams) s.res.end(); streams = []; return { dropped: n }; });
pub("POST", "/__test/stream-status", ({ body }) => { for (const s of streams) s.res.write(`event: status\ndata: ${JSON.stringify({ catchingUp: Boolean(body.catchingUp), lag: body.catchingUp ? 12 : 0 })}\n\n`); return { ok: true }; });
pub("GET", "/__test/state", () => ({ outbox, streamLog, events: events.length, streams: streams.length, idempotentReplays, companies: [...companies.values()].map((c) => ({ slug: c.slug, founder: c.founder, frozen: c.frozen, teams: c.teams.map((t) => ({ name: t.name, budget: t.budget.toString(), frozen: t.frozen, agents: t.agents })), members: [...c.members.keys()], dailyCap: c.dailyCap.toString(), codeKeyVersion: c.codeKeyVersion, wrapped: c.wrapped, viewKeys: c.viewKeys.size, tasks: c.tasks.length })) }));
let idempotentReplays = 0;

function reset() {
  companies = new Map(); accounts = new Map(); sessions = new Map(); challenges = new Map(); drafts = new Map(); invites = []; outbox = []; txLog = new Map(); idem = new Map(); events = []; streamTokens = new Map(); streamLog = []; idempotentReplays = 0;
  for (const s of streams) s.res.end();
  streams = [];
  pendingCreates.clear(); pendingKeys.clear(); privyEmailOff = new Set();
}

const CORS = { "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type, authorization, idempotency-key, last-event-id, x-request-id", "access-control-expose-headers": "idempotent-replay", "access-control-max-age": "600" };
createServer(async (req, res) => {
  const origin = req.headers.origin ?? "*";
  const url = new URL(req.url ?? "/", "http://x");
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": origin, ...CORS, ...extra }); res.end(JSON.stringify(body)); };
  if (req.method === "OPTIONS") return void (res.writeHead(204, { "access-control-allow-origin": origin, ...CORS }), res.end());
  try {
    const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) throw new Http(404, "not_found", `No route for ${req.method} ${url.pathname}.`);
    const m = route.re.exec(url.pathname)!;
    const p = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]]));
    let body: Json = {};
    if (req.method !== "GET") {
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(ch as Buffer);
      const text = Buffer.concat(chunks).toString("utf8");
      body = text ? JSON.parse(text) : {};
    }
    let me = undefined as unknown as Account;
    if ((route.fn as any).auth) {
      const s = sessions.get(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!s || s.expiresAt < now()) throw new Http(401, "unauthenticated", "Your session ended. Sign in again.");
      me = account(s.accountId);
    }
    // Idempotency-Key: the same key from the same account replays the stored answer
    const key = req.method !== "GET" && me && req.headers["idempotency-key"] && !/stream\/token|logout/.test(url.pathname) ? `${me.id}:${req.headers["idempotency-key"]}` : null;
    if (key && idem.has(key)) { idempotentReplays++; const r = idem.get(key)!; return json(r.status, r.body, { "idempotent-replay": "true" }); }
    let sentRaw = false;
    const out = await route.fn({ p, q: url.searchParams, body, me, req, res, raw: (status, text, type) => { sentRaw = true; res.writeHead(status, { "content-type": type, "access-control-allow-origin": origin, ...CORS }); res.end(text); } });
    if (out === STREAM || sentRaw) return;
    if (key) idem.set(key, { status: 200, body: out });
    json(200, out);
  } catch (e) {
    if (e instanceof Http) return json(e.status, { error: e.code, code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
    console.error(e);
    json(500, { error: "internal", code: "internal", message: (e as Error).message });
  }
}).listen(PORT, () => console.log(`mock BuilderOS API on http://localhost:${PORT}`));
