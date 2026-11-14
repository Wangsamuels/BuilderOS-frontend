/** Types mirror docs/API-CONTRACT.md (contract 2026-11-13). Money = micro-USDC integer strings. */
import type { Micro } from "@/lib/money";

export type Scope = "view" | "approve" | "builder" | "code";
export type Access = { founder: boolean; admin: boolean; scopes: Scope[]; departmentId: string | null; expiresAtMs?: number | null; demo?: boolean };

/** Wallet-selector shaped transaction returned by every write. */
export type TxAction = { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } };
export type Tx = { signerId?: string; receiverId: string; actions: TxAction[] };
export type WithTx = { transactions?: Tx[]; transaction?: Tx };

export type Challenge = { message: string; recipient: string; nonce: string; expiresAt: string; accountBound: boolean };
export type VerifyResult = { accountId: string; token: string; expiresAt: string; loginMethod: "privy" | "wallet" | null; email: EmailStatus | null; emailError?: string };
export type EmailStatus = { address: string | null; verified: boolean; source: "code" | "privy" | null; pending: string | null };

export type Membership = { companyId: string; slug: string; name: string; isFounder: boolean; admin: boolean; scopes: Scope[]; departmentId: string | null };
export type DraftRef = { id: string; title: string; createdAt: string; estimate?: Estimate; updatedAt?: string };
export type SetupStep = { id: "account" | "email" | "describe" | "fund" | "launch" | "approve"; done: boolean; label: string };
export type Funding = { recommendedYocto: string; recommendedNear: string; [k: string]: unknown };
export type Me = {
  accountId: string;
  loginMethod: "privy" | "wallet" | null;
  email: EmailStatus;
  needsEmailForCompany: boolean;
  companies: Membership[];
  companyIds: string[];
  drafts: DraftRef[];
  home: { view: "welcome" | "overview"; openCompanyId: string | null; demo: string | null };
  balance: { exists: boolean; availableYocto: string; availableNear: string };
  funding: Funding;
  pendingRefund: { yocto: string; near: string };
  setup: { steps: SetupStep[]; next: SetupStep["id"] | null; completed: number; total: number; showBanner: boolean };
};

export type Account = { accountId: string; loginMethod: "privy" | "wallet" | null; email: EmailStatus; needsEmailForCompany: boolean; preferences: { lastCompanyId?: string | null; dismissed?: string[] } };

export type Estimate = { p50: Micro; p90: Micro; cap: Micro };
export type Feature = { key: string; title: string; tag: string; size: string; dependsOn: string[]; team: string; estimate?: Estimate };
export type SuggestedTeam = { team: string; monthlyCap: Micro; perTxLimit: Micro; features?: number; estimatedCap?: Micro };
export type Draft = {
  id: string;
  title: string;
  status: "draft" | "launching" | "launched";
  companyId: string | null;
  launchCompanyId: string | null;
  tier: string;
  features: Feature[];
  estimate: Estimate;
  suggestedSetup: { name: string; slug: string; dailyCap: Micro; teams: SuggestedTeam[]; funding?: Funding };
  description: string;
  updatedAt?: string;
};

export type TaskCounts = Record<string, number>;
export type Outcome = "done" | "needs_review" | "retrying" | "paused" | "failed";
export type ReportFacts = {
  files?: string[];
  checks?: { passed: boolean; errors: string[] } | null;
  review?: { verdict: string; model: string; reasons: string[] } | null;
  commitSha?: string | null;
  generator?: { model: string; provider: string; rail: string };
  models?: Array<{ model: string; provider: string; calls: number; failed: number; cost: Micro; tokensIn: number; tokensOut: number }>;
  receipts?: Array<{ id: string; amount: Micro; seller?: string }>;
  estimate?: Estimate;
  taskCostSoFar?: Micro;
  reason?: string | null;
  error?: string | null;
  durationMs?: number;
  tier?: string;
};
export type Report = {
  id: string;
  taskId: string;
  attempt: number;
  team: string;
  departmentId?: string;
  title: string;
  tag: string;
  outcome: Outcome;
  agent: string;
  summary: string;
  summarySource: "agent";
  cost: Micro | null;
  facts: ReportFacts;
  createdAt: string;
  updatedAt: string;
};
export type TeamReports = { team: string; departmentId: string; summary: { done: number; needsReview: number; retrying: number; paused: number; failed: number; reports: number; cost: Micro | null; headline: string }; reports: Report[] };
export type ReportsResponse = { groupBy: "team"; teams: TeamReports[] };
export type ReportDetail = { report: Report; attempts: Array<{ id: string; attempt: number; outcome: Outcome; at: string }> };

export type OverviewCompany = {
  companyId: string;
  slug: string;
  name: string;
  role: "founder" | "admin" | "member" | "demo";
  scopes?: Scope[];
  departmentId?: string | null;
  frozen: boolean;
  teams: Array<{ name: string; departmentId: string; frozen: boolean }>;
  money: { dailyCap: Micro; spentToday: Micro; budget: Micro; spent: Micro; reserved: Micro; available: Micro } | null;
  work: { tasks: TaskCounts; reportsThisWeek: number; needsAttention: number; lastReport: Report | null } | null;
  approvals: { pending: number; oldestAt: string | null } | null;
};
export type Overview = {
  home: Me["home"];
  totals: { companies: number; founded: number; spentToday: Micro; budget: Micro; spent: Micro; pendingApprovals: number; tasksRunning: number; tasksDone: number; needsAttention: number };
  companies: OverviewCompany[];
  drafts: DraftRef[];
  inbox: { unread: number };
};

export type InboxAction = { type: "approve"; cardId: string } | { type: "report"; reportId: string } | { type: "accept_invite"; route: string } | { type: "open"; url: string };
export type InboxItem = { id: string; kind: "approval" | "report" | "invite" | "alert"; companyId: string | null; slug: string | null; title: string; body: string; at: string; read: boolean; urgent: boolean; action: InboxAction | null };
export type Inbox = { items: InboxItem[]; unread: number };

export type Agent = { publicKey: string; accountId?: string; role: string; status: string; maxTier?: string };
export type Team = { name: string; departmentId: string; budget: Micro; spent: Micro; reserved: Micro; available: Micro; perTxLimit: Micro; frozen: boolean; paymentAddress: string | null; chainId: number; agents: Agent[]; tasks: TaskCounts };

export type CompanyResponse = {
  company: { id: string; name: string; frozen: boolean; founderAccount?: string; createdAt?: string };
  companyId: string;
  slug: string;
  departments?: Array<{ name: string; departmentId: string }>;
  chain?: { frozen?: boolean; daily_cap?: Micro; spent_today?: Micro; code_key_version?: number; contract_version?: number };
  access: Access;
};

export type TeamMoney = { team: string; departmentId: string; spentInRange: Micro; budget: Micro; spent: Micro; reserved: Micro; available: Micro; burnPerDay: Micro; runwayDays: number | null; frozen?: boolean };
export type Analytics = {
  range: { days: number; from: string; to: string };
  teams: Array<{ name: string; departmentId: string }>;
  sections: { money: boolean; work: boolean; control: boolean };
  money: {
    total: Micro;
    byDay: Array<{ day: string; total: Micro; byTeam: Record<string, Micro> }>;
    byTeam: TeamMoney[];
    byModel: Array<{ model: string; amount: Micro; purchases: number }>;
    bySeller: Array<{ seller: string; amount: Micro; purchases: number }>;
    dailyCap: { cap: Micro; spentToday: Micro; usedPct: number };
  } | null;
  work: {
    tasks: TaskCounts;
    tasksByTeam: Array<{ team: string; departmentId: string } & Record<string, number | string>>;
    completedByDay: Array<{ day: string; done: number }>;
    reviewPassRate: number | null;
    reviewed: number;
    costPerDoneTask?: Micro | null;
    estimateVsActual?: { estimated: Micro; actual: Micro; tasks: number } | null;
  } | null;
  control: { approvals: { pending: number; oldestPendingAt: string | null; decidedInRange: number }; blockedPurchases: number; pausedTeams: string[]; companyFrozen: boolean } | null;
};

export type Plan = { id: string; title: string; tier: string; status?: string; estimate?: Estimate; features: Feature[]; approvedAt: string | null; tasks?: TaskCounts; description?: string };
export type Task = { id: string; planId?: string; title: string; tag: string; size?: string; status: string; departmentId: string | null; tier: string; pinnedModel?: string | null; estP50?: Micro | null; estP90?: Micro | null; cap?: Micro | null; pauseReason?: string | null; agent?: string | null; attempts?: number; commitSha?: string | null; updatedAt?: string };

export type ApprovalCard = {
  id: string;
  companyId: string;
  kind: "single" | "daily-cap" | "seller";
  status: "pending" | "approved" | "rejected";
  amount: Micro | null;
  requestIds: string[];
  payload: { department_id?: string; seller_id?: string; reason?: string; title?: string; type?: string; pay_to?: string; count?: number; task_id?: string };
  createdAt: string;
};

export type Receipt = { id: string; kind: string; companyId: string; departmentId: string | null; actor: string | null; amount: Micro | null; token: string | null; rail: string | null; chainId: string | null; foreignTx: string | null; verifiedOnChain: boolean | null; requestId: string | null; payload: Record<string, unknown>; nearTx?: string | null; createdAt: string };
export type Deposit = { supported: boolean; address: string | null; reason?: string; message?: string; balance: Micro; teams: Array<{ team: string; departmentId: string; address: string | null; chainId: number; token: string; balance: Micro }> };
export type Member = { account_id: string; department_id: string | null; scopes?: Scope[]; role?: string; expires_at?: string | null; revoked?: boolean; has_view_key?: boolean };
export type InviteInfo = { companyId: string; slug: string; companyName: string; role: string; departments: string[]; expiresAt: string; status: string; canAccept: boolean };
export type CreateCompanyResult = WithTx & { companyId: string; resumed: boolean; complete: boolean; missing?: string[]; requiredYocto?: string; planId?: string };
export type CreationStatus = { slugTaken: boolean; founderIsYou: boolean; companyExists: boolean; departments: string[]; plansBound: string[] };

export type DemoBundle = {
  demo: true;
  notice: string;
  companyId: string;
  slug: string;
  company: CompanyResponse["company"];
  access: Access;
  chain: CompanyResponse["chain"];
  overview: OverviewCompany;
  teams: Team[];
  analytics: Analytics;
  reports: ReportsResponse;
  approvals: ApprovalCard[];
  plan: Plan;
  tasks: Task[];
  members: Member[];
};

export type StreamEvent = { id: number; event: string; companyId: string | null; departmentId: string | null; data: Record<string, unknown>; at: string };

export type WithdrawalChain = "near" | "base" | "ethereum" | "arbitrum" | "solana";
export type WithdrawalPlan = {
  plan: {
    withdrawalId: string;
    amount: Micro;
    token: string;
    to: string;
    chain: WithdrawalChain;
    /** "near": straight to a NEAR account. "swap": delivered on another chain through a quote. */
    route?: "near" | "swap";
    sources: Array<{ from: "intents" | "tempo" | string; amount: Micro; estFee?: Micro }>;
    available: { intents: Micro; tempoUnreserved: Micro };
    /** What arrives, and until when the wallet must sign (null when there is no quote to expire). */
    quote?: { amountOut: Micro; fees: Micro; deadline: string | null; quoteId: string | null; depositAddress: string | null; destinationAsset: string };
  };
} & WithTx;
