import { api } from "./client";
import type * as T from "./types";

type Q = Record<string, string | number | boolean | null | undefined>;
const get = <R>(path: string, query?: Q, auth = true) => api<R>(path, { query, auth });
const write = <R>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown, key?: string, query?: Q) => api<R>(path, { method, body, idempotencyKey: key, query });

/** One function per endpoint. `key` is the Idempotency-Key for a click; reuse it when retrying the same click. */
export const endpoints = {
  // auth
  challenge: () => get<T.Challenge>("/v1/auth/challenge", undefined, false),
  verify: (body: { accountId: string; publicKey: string; signature: string; message: string; nonce: string; loginMethod: "privy" | "wallet"; privyIdentityToken?: string }) =>
    api<T.VerifyResult>("/v1/auth/verify", { method: "POST", body, auth: false }),
  logout: () => write<{ ok: boolean }>("POST", "/v1/auth/logout"),
  me: () => get<T.Me>("/v1/auth/me"),
  fundTestnet: (key?: string) => write<{ ok?: boolean }>("POST", "/v1/auth/fund-testnet", {}, key),

  // account
  account: () => get<T.Account>("/v1/account"),
  startEmail: (email: string) => write<{ ok: boolean; sentTo: string; expiresAt: string; devCode?: string }>("POST", "/v1/account/email", { email }),
  /** Verify the email with the Privy identity token instead of a code (Google and email sign-ins). */
  verifyEmailWithPrivy: (identityToken: string) => write<{ ok: boolean; email: T.EmailStatus }>("POST", "/v1/account/email/privy", { identityToken }),
  verifyEmail: (code: string) => write<{ ok: boolean; email: T.EmailStatus }>("POST", "/v1/account/email/verify", { code }),
  setPreferences: (body: { lastCompanyId?: string | null; dismissed?: string[] }) => write<{ preferences: T.Account["preferences"] }>("PATCH", "/v1/account/preferences", body),

  // home
  overview: (fresh?: boolean) => get<T.Overview>("/v1/overview", fresh ? { fresh: 1 } : undefined),
  inbox: () => get<T.Inbox>("/v1/inbox", { limit: 100 }),
  markRead: (body: { ids?: string[]; all?: boolean }) => write<{ ok: boolean; marked: number }>("POST", "/v1/inbox/read", body),
  acceptInboxInvite: (id: string, key?: string) => write<T.WithTx & { companyId: string }>("POST", `/v1/inbox/invites/${encodeURIComponent(id)}/accept`, {}, key),
  demo: (range: string) => get<T.DemoBundle>("/v1/demo", { range }, false),
  demoReport: (id: string) => get<T.ReportDetail | { report: T.Report }>(`/v1/demo/reports/${id}`, undefined, false),

  // drafts
  createDraft: (body: { what: string; who?: string; howTheyPay?: string; private?: boolean }, key?: string) => write<{ draft: T.Draft }>("POST", "/v1/drafts", body, key),
  drafts: () => get<{ drafts: T.Draft[] }>("/v1/drafts"),
  draft: (id: string) => get<{ draft: T.Draft }>(`/v1/drafts/${id}`),
  patchDraft: (id: string, body: { title?: string; description?: string; features?: T.Feature[]; removeKeys?: string[]; tier?: string }) => write<{ draft: T.Draft }>("PATCH", `/v1/drafts/${id}`, body),
  deleteDraft: (id: string) => write<{ ok: boolean }>("DELETE", `/v1/drafts/${id}`),
  launchInto: (id: string, companyId: string, key?: string) => write<{ plan: T.Plan; next?: unknown }>("POST", `/v1/drafts/${id}/launch`, { companyId }, key),

  // companies
  createCompany: (body: { name: string; slug: string; planId?: string; teams?: Array<{ team: string; monthlyCap: string }>; dailyCap?: string }, key?: string) => write<T.CreateCompanyResult>("POST", "/v1/companies", body, key),
  creation: (slug: string) => get<T.CreationStatus>(`/v1/companies/creation/${encodeURIComponent(slug)}`),
  company: (id: string) => get<T.CompanyResponse>(`/v1/companies/${encodeURIComponent(id)}`),
  teams: (companyId: string) => get<{ teams: T.Team[] }>("/v1/teams", { companyId }),
  policy: (body: { companyId: string; dailyCap?: string; team?: string; monthlyCap?: string; budgetIncrease?: string }, key?: string) => write<T.WithTx>("POST", "/v1/policy", body, key),
  payments: (companyId: string) => get<{ teams: Array<{ name: string; departmentId: string; chainId: number; address: string | null; configured: boolean }> }>(`/v1/companies/${encodeURIComponent(companyId)}/payments`),
  configurePayments: (companyId: string, key?: string) => write<T.WithTx>("POST", `/v1/companies/${encodeURIComponent(companyId)}/payments/configure`, {}, key),

  // money
  deposit: (companyId: string) => get<T.Deposit>("/v1/deposit", { companyId }),
  approvals: (companyId: string, status = "pending") => get<{ cards: T.ApprovalCard[] }>("/v1/approvals", { companyId, status }),
  decide: (id: string, body: { decision: "approve" | "reject"; alwaysAllow?: boolean }, key?: string) => write<T.WithTx & { card: T.ApprovalCard }>("POST", `/v1/approvals/${id}`, body, key),
  ledger: (companyId: string, q: { kind?: string; departmentId?: string } = {}) => get<{ receipts: T.Receipt[] }>("/v1/ledger", { companyId, ...q, limit: 100 }),
  ledgerCsv: (companyId: string) => api<string>("/v1/ledger", { query: { companyId, format: "csv" }, raw: true }),
  receipt: (id: string) => get<{ receipt: T.Receipt }>(`/v1/receipts/${id}`),
  withdrawQuote: (companyId: string) => write<unknown>("POST", "/v1/withdraw/quote", { companyId }),
  services: (companyId: string) => get<unknown>("/v1/services", { companyId }),
  freeze: (companyId: string, key?: string, departments?: string[]) => write<T.WithTx>("POST", "/v1/freeze", { companyId, departments }, key),
  unfreeze: (companyId: string, key?: string) => write<T.WithTx>("POST", "/v1/unfreeze", { companyId }, key),

  // analytics and reports
  analytics: (companyId: string, range: string, team?: string) => get<T.Analytics>("/v1/analytics", { companyId, range, team }),
  reports: (companyId: string, q: { team?: string; days?: number } = {}) => get<T.ReportsResponse>("/v1/reports", { companyId, ...q }),
  report: (id: string) => get<T.ReportDetail>(`/v1/reports/${id}`),

  // work
  plans: (companyId: string) => get<{ plans: T.Plan[] }>("/v1/plans", { companyId }),
  plan: (id: string) => get<{ plan: T.Plan; tasks: T.Task[] }>(`/v1/plans/${id}`),
  createPlan: (body: { companyId: string; description: string; tier?: string }, key?: string) => write<{ plan: T.Plan }>("POST", "/v1/plans", body, key),
  approvePlan: (id: string, key?: string) => write<T.WithTx & { tasks?: T.Task[]; resumed?: boolean }>("POST", `/v1/plans/${id}/approve`, {}, key),
  tasks: (companyId: string, planId?: string) => get<{ tasks: T.Task[] }>("/v1/tasks", { companyId, planId }),
  task: (id: string) => get<{ task: T.Task; hires?: unknown[] }>(`/v1/tasks/${encodeURIComponent(id)}`),
  patchTask: (id: string, body: { tier?: string; pinnedModel?: string | null }, key?: string) => write<T.WithTx>("PATCH", `/v1/tasks/${encodeURIComponent(id)}`, body, key),
  estimate: (body: { taskId: string; tier?: string; model?: string }) => write<{ estimate: T.Estimate; current?: T.Estimate; tiers?: Record<string, T.Estimate> }>("POST", "/v1/estimate", body),
  registerAgent: (body: { companyId: string; departmentId: string; publicKey: string; role: string }, key?: string) => write<T.WithTx>("POST", "/v1/agents", body, key),
  agentStatus: (publicKey: string, body: { companyId: string; status: "running" | "paused" | "fired" }, key?: string) => write<T.WithTx & { ok?: boolean }>("POST", `/v1/agents/${encodeURIComponent(publicKey)}/status`, body, key),

  // members, invites, keys
  members: (companyId: string) => get<{ members: T.Member[]; canManage: boolean }>("/v1/members", { companyId }),
  invite: (body: { companyId: string; email: string; departments: string[]; template: string; expiresInDays?: number }, key?: string) => write<T.WithTx & { inviteId: string }>("POST", "/v1/members/invite", body, key),
  removeMember: (accountId: string, companyId: string, key?: string) => write<T.WithTx>("DELETE", `/v1/members/${encodeURIComponent(accountId)}`, undefined, key, { companyId }),
  editGrants: (accountId: string, companyId: string) => write<unknown>("POST", `/v1/members/${encodeURIComponent(accountId)}/grants`, { companyId }),
  inviteInfo: (code: string) => get<T.InviteInfo>(`/v1/invites/${encodeURIComponent(code)}`),
  acceptInvite: (code: string, key?: string) => write<T.WithTx & { companyId: string }>("POST", "/v1/invites/accept", { code }, key),
  registerViewKey: (body: { companyId: string; x25519PublicKey: string }, key?: string) => write<T.WithTx>("POST", "/v1/keys/view", body, key),
  confirmViewKey: (body: { companyId: string; txHash: string }) => write<{ ok: boolean }>("POST", "/v1/keys/view/confirm", body),
  devices: (companyId: string) => get<{ codeKeyVersion: number; devices: Array<{ accountId: string; x25519PublicKey: string; founder: boolean }> }>("/v1/keys/devices", { companyId, kind: "code" }),
  rotateCodeKey: (companyId: string, key?: string) => write<T.WithTx & { currentVersion: number; newVersion: number }>("POST", "/v1/keys/code/rotate", { companyId }, key),
  storeWrapped: (body: { companyId: string; kind: "code"; version: number; keys: Array<{ memberAccount: string; ciphertext: string }> }) => write<{ stored: number }>("POST", "/v1/keys/wrapped", body),

  // stream
  streamToken: () => write<{ token: string; expiresAt: string }>("POST", "/v1/stream/token"),
};

export const txs = (r: T.WithTx): T.Tx[] => r.transactions ?? (r.transaction ? [r.transaction] : []);
