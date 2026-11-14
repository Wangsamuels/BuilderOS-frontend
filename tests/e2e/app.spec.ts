import { expect, test, type Page } from "@playwright/test";
import { newIdentity, seed, signed, signIn, useIdentity, type Identity } from "./helpers";

/**
 * The acceptance checklist of docs/frontend architecture §17, end to end, against the mock API
 * (contract shapes + a simulated chain) with a throwaway in-browser wallet.
 */
let me: Identity;
test.beforeEach(async ({ page }) => {
  await seed.reset();
  me = newIdentity();
  await useIdentity(page, me);
});

const founderOf = async (slug = "lumen", opts: Parameters<typeof seed.company>[2] = {}) => seed.company(slug, me.accountId, { name: "Lumen Notes", ...opts });
const other = () => newIdentity().accountId;
const nav = (page: Page) => page.getByRole("navigation", { name: "Company" });

test.describe("sign-in and home", () => {
  test("Google sign-in works on the first click and lands on Welcome with no company form", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByTestId("signin-google").click();
    await page.waitForURL("**/home");
    const welcome = page.getByTestId("welcome");
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole("link", { name: "Describe your product" }).first()).toBeVisible();
    await expect(welcome.getByRole("link", { name: /See a demo/ })).toBeVisible();
    await expect(page.getByTestId("setup-card")).toBeVisible();
    await expect(page.getByLabel("Company name")).toHaveCount(0);

    // a returning person skips the landing
    await page.goto("/");
    await page.waitForURL("**/home");
  });

  test("NEAR wallet sign-in works on the first click and asks for no email", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("signin-wallet").click();
    await page.waitForURL("**/home");
    await expect(page.getByTestId("welcome")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
    await page.goto("/account");
    await expect(page.getByTestId("account-id")).toHaveText(me.accountId);
    await expect(page.getByText("NEAR wallet")).toBeVisible();
    await expect(page.getByTestId("account-email")).toContainText("No email yet");
  });

  test("an expired session shows sign-in on the same URL and returns there", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/money");
    await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
    await seed.expireSessions();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    expect(page.url()).toContain("/c/lumen/money");
    await page.getByTestId("signin-google").click();
    await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
    expect(page.url()).toContain("/c/lumen/money");
  });

  test("a founder with several companies can switch, and the last one opened is remembered", async ({ page }) => {
    await founderOf("lumen");
    await seed.company("orbit", me.accountId, { name: "Orbit Mail" });
    await signIn(page);
    await page.goto("/home");
    await expect(page.getByTestId("overview")).toBeVisible();
    await expect(page.getByTestId("company-card")).toHaveCount(2);
    await page.getByTestId("company-switcher").click();
    await page.getByRole("menuitem", { name: /Orbit Mail/ }).click();
    await page.waitForURL("**/c/orbit");
    await expect(page.getByRole("heading", { name: "Orbit Mail" })).toBeVisible();
    // "/" (also the target of alert links) opens the current company
    await page.goto("/");
    await page.waitForURL("**/c/orbit");
    await page.goto("/home");
    await expect(page.getByRole("link", { name: /Continue in Orbit Mail/ })).toBeVisible();
  });

  test("links from emails and alerts open the same page in the current company", async ({ page }) => {
    await founderOf();
    await signIn(page);
    for (const [from, to] of [["/approvals", "/c/lumen/approvals"], ["/settings/keys", "/c/lumen/settings"], ["/audit", "/c/lumen/money"]]) {
      await page.goto(from);
      await page.waitForURL(`**${to}*`);
    }
  });
});

test.describe("from idea to company", () => {
  async function describe(page: Page) {
    await page.goto("/drafts/new");
    await page.getByLabel("What does it do?").fill("A notes app for small teams with sharing, version history and offline drafts.");
    await page.getByLabel("Who is it for?").fill("Teams of 5 to 50 people");
    await page.getByRole("button", { name: "Plan it" }).click();
    await page.waitForURL(/\/drafts\/draft_/);
    await expect(page.getByTestId("draft-review")).toBeVisible();
  }

  test("describe → edit → launch → email → fund → sign → company → approve plan", async ({ page }) => {
    await signIn(page, "wallet");
    await page.getByRole("link", { name: "Describe your product" }).first().click();
    await page.waitForURL("**/drafts/new");
    await describe(page);

    // edit the plan: remove a step, rename the draft
    await expect(page.getByTestId("feature-row")).toHaveCount(6);
    await page.getByRole("button", { name: /^Remove "Nightly backups"/ }).click();
    await expect(page.getByTestId("feature-row")).toHaveCount(5);
    await page.getByRole("button", { name: "A notes app for small" }).click();
    await page.getByLabel("Draft title").fill("Lumen Notes");
    await page.getByLabel("Draft title").press("Enter");
    await expect(page.getByRole("button", { name: "Lumen Notes" })).toBeVisible();
    await expect(page.getByLabel("Estimate")).toContainText("$");

    await page.getByTestId("launch").click();
    const wizard = page.getByTestId("launch-wizard");
    await expect(wizard).toHaveAttribute("data-step", "company");
    await page.getByLabel("Company name").fill("Lumen Notes");
    await page.getByLabel("Web address").fill("lumen-e2e");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(wizard).toHaveAttribute("data-step", "teams");
    await page.getByRole("button", { name: "Continue" }).click();

    // a wallet sign-up adds an email only now, when creating a company, and confirms it through Privy
    await expect(wizard).toHaveAttribute("data-step", "email");
    await page.getByTestId("verify-email-privy").click(); // the person closes Privy's window
    await expect(page.getByTestId("wallet-email")).toContainText("closed before it finished");
    await expect(wizard).toHaveAttribute("data-step", "email");
    await page.evaluate(() => ((window as any).__testWallet = { ...(window as any).__testWallet, privyEmail: "founder@example.com" }));
    await page.getByTestId("verify-email-privy").click(); // this time they confirm the address

    await expect(wizard).toHaveAttribute("data-step", "funding");
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    // the wallet's own address is shown in full, with a copy button, for a deposit from a faucet or another wallet
    await expect(page.getByTestId("deposit-address-value")).toHaveText(me.accountId);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("deposit-address").getByRole("button", { name: "Copy address" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(me.accountId);
    // a deposit that doesn't cover it yet shows up after "Check balance"; the step stays put
    await seed.balance(me.accountId, 3);
    await page.getByTestId("check-balance").click();
    await expect(page.getByTestId("wallet-balance")).toContainText("3");
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByTestId("fund-testnet").click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "Continue" }).click();

    // 1 transaction for the company + 1 per team, signed in order
    await page.getByTestId("create-company").click();
    const sheet = page.getByTestId("signing-sheet");
    for (const step of ["Create the company", "Create the build team", "Create the ops team", "Create the growth team"]) await expect(sheet).toContainText(step);
    await expect(sheet).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("company-created")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("approve-plan").click();
    await signed(page);
    await page.waitForURL("**/c/lumen-e2e");
    await expect(page.getByRole("heading", { name: "Lumen Notes" })).toBeVisible();

    const company = (await seed.state()).companies.find((c: any) => c.slug === "lumen-e2e");
    expect(company.founder).toBe(me.accountId);
    expect(company.teams.map((t: any) => t.name).sort()).toEqual(["build", "growth", "ops"]);
    expect(company.tasks).toBe(5);
    await page.goto(`/c/lumen-e2e/work`);
    await expect(page.getByTestId("task-row")).toHaveCount(5);
  });

  test("a Google sign-in whose email wasn't confirmed at sign-in is confirmed in the wizard without a code", async ({ page }) => {
    await seed.privyEmailOff(me.accountId); // e.g. the server couldn't check the Privy token at sign-in
    await seed.balance(me.accountId, 40);
    await signIn(page);
    await describe(page);
    await page.getByTestId("launch").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    const wizard = page.getByTestId("launch-wizard");
    // no token available: says so, and still offers the code
    await expect(wizard).toHaveAttribute("data-step", "email");
    await expect(page.getByTestId("privy-email-failed")).toContainText("couldn't read an email from your sign-in");
    await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
    // a token the server rejects: its reason is shown
    await page.evaluate(() => ((window as any).__testWallet = { identityToken: "expired" }));
    await page.getByTestId("privy-email-retry").click();
    await expect(page.getByTestId("privy-email-failed")).toContainText("invalid or expired");
    // a good token: verified with one click, no code typed
    await page.evaluate(() => ((window as any).__testWallet = { identityToken: "test-identity:wang@example.com" }));
    await page.getByTestId("privy-email-retry").click();
    await expect(wizard).toHaveAttribute("data-step", "funding");
  });

  test("a wallet sign-up can still confirm with a code from BuilderOS", async ({ page }) => {
    await seed.balance(me.accountId, 40);
    await signIn(page, "wallet");
    await describe(page);
    await page.getByTestId("launch").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    const wizard = page.getByTestId("launch-wizard");
    await expect(wizard).toHaveAttribute("data-step", "email");
    await page.getByTestId("use-own-code").click();
    await page.getByLabel("Email").fill("founder@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    const code = page.getByLabel("6-digit code");
    await code.fill("000000");
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByText(/doesn't match/)).toBeVisible();
    await code.fill((await code.getAttribute("data-dev-code"))!);
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(wizard).toHaveAttribute("data-step", "funding");
  });

  test("launch can be left half-signed and resumed", async ({ page }) => {
    await seed.balance(me.accountId, 40);
    await signIn(page); // Google: the email is verified at sign-in, so there is no email step
    await describe(page);
    await page.getByTestId("launch").click();
    await page.getByLabel("Web address").fill("resume-co");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("launch-wizard")).toHaveAttribute("data-step", "funding");
    await page.getByRole("button", { name: "Continue" }).click();

    // the chain fails on the second transaction
    let calls = 0;
    await page.route("**/__sim/tx", async (route) => (++calls === 2 ? route.fulfill({ status: 400, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "Simulated chain outage" }) }) : route.continue()));
    await page.getByTestId("create-company").click();
    const sheet = page.getByTestId("signing-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "failed");
    await expect(sheet).toContainText("Simulated chain outage");
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await page.unroute("**/__sim/tx");

    // leave, come back later from Home
    await page.goto("/home");
    await page.getByTestId("draft-card").first().click();
    await expect(page.getByText(/Creating your company/)).toBeVisible();
    await page.getByTestId("launch").click();
    await expect(page.getByTestId("launch-wizard")).toHaveAttribute("data-step", "sign");
    await page.getByTestId("create-company").click();
    await expect(sheet).toContainText("Create the ops team"); // only the steps still missing
    await expect(sheet).not.toContainText("Create the company");
    await expect(page.getByTestId("company-created")).toBeVisible({ timeout: 30_000 });
    const company = (await seed.state()).companies.find((c: any) => c.slug === "resume-co");
    expect(company.teams).toHaveLength(3);
  });

  test("a name taken meanwhile sends the founder back to pick another; the draft stays theirs", async ({ page }) => {
    await seed.balance(me.accountId, 40);
    await signIn(page);
    await describe(page);
    await page.getByTestId("launch").click();
    await page.getByLabel("Web address").fill("contested");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await seed.company("contested", other(), { filled: false });
    await page.getByTestId("create-company").click();
    await expect(page.getByTestId("launch-wizard")).toHaveAttribute("data-step", "company");
    await expect(page.getByText(/taken/i).first()).toBeVisible();
    await page.goto("/home");
    await expect(page.getByTestId("draft-card")).toHaveCount(1);
  });

  test("a draft can be added to an existing company, or deleted", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await describe(page);
    await page.getByRole("button", { name: "Add to an existing company" }).click();
    await page.getByRole("button", { name: /Lumen Notes/ }).last().click();
    await page.waitForURL(/\/c\/lumen\/work\/plans\//);
    await expect(page.getByTestId("approve-plan")).toBeVisible();

    await describe(page);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete draft" }).click();
    await page.waitForURL("**/home");
    await expect(page.getByTestId("draft-card")).toHaveCount(0);
  });
});

test.describe("who sees what", () => {
  const visit = async (page: Page, grant: Parameters<typeof seed.grant>[2]) => {
    await seed.company("lumen", other(), { name: "Lumen Notes" });
    await seed.grant("lumen", me.accountId, grant);
    await signIn(page);
    await page.goto("/c/lumen");
    await expect(page.getByRole("heading", { name: "Lumen Notes" })).toBeVisible();
  };

  test("a viewer sees money only", async ({ page }) => {
    await visit(page, { scopes: ["view"] });
    await expect(page.getByTestId("section-money")).toBeVisible();
    await expect(page.getByTestId("section-work")).toHaveCount(0);
    await expect(page.getByTestId("section-control")).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Money" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Work" })).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: /Approvals/ })).toHaveCount(0);
    // typing the URL changes nothing: the server answers 403 and the page says so
    await page.goto("/c/lumen/approvals");
    await expect(page.getByText("Your access doesn't cover this")).toBeVisible();
    await page.goto("/c/lumen/members");
    await expect(page.getByTestId("member-row")).toHaveCount(1);
    await expect(page.getByTestId("invite-member")).toHaveCount(0);
  });

  test("a builder sees work, not money or approvals", async ({ page }) => {
    await visit(page, { scopes: ["builder", "code"] });
    await expect(page.getByTestId("section-work")).toBeVisible();
    await expect(page.getByTestId("section-money")).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Work" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Money" })).toHaveCount(0);
    await page.goto("/c/lumen/teams");
    await expect(page.getByTestId("report-card").first()).toBeVisible();
    await expect(page.getByTestId("report-card").first()).not.toContainText("$"); // cost needs a money scope
  });

  test("an approver sees money and approvals, not work", async ({ page }) => {
    await visit(page, { scopes: ["view", "approve"] });
    await expect(page.getByTestId("section-money")).toBeVisible();
    await expect(page.getByTestId("section-control")).toBeVisible();
    await expect(page.getByTestId("section-work")).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: /Approvals/ })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Work" })).toHaveCount(0);
  });

  test("a team-limited member sees only their team and gets no team filter", async ({ page }) => {
    await visit(page, { scopes: ["view", "builder", "code"], team: "ops" });
    await expect(page.getByLabel("Team", { exact: true })).toHaveCount(0);
    await page.goto("/c/lumen/teams");
    await expect(page.getByTestId("team-card")).toHaveCount(1);
    await expect(page.getByTestId("team-card")).toContainText(/ops/i);
  });

  test("no access decision comes from local storage", async ({ page }) => {
    await seed.company("lumen", other(), { name: "Lumen Notes" });
    await signIn(page);
    await page.evaluate(() => {
      for (const k of ["access", "role", "isFounder", "admin", "builderos.access", "builderos.companies"]) window.localStorage.setItem(k, JSON.stringify({ founder: true, admin: true, scopes: ["view", "approve", "builder", "code"], slug: "lumen" }));
    });
    await page.goto("/c/lumen");
    await expect(page.getByTestId("company-closed")).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    // the only things the app keeps in the browser are the session token and the wallet's own state
    const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("builderos.")));
    expect(keys.sort()).toEqual(["builderos.access", "builderos.companies", "builderos.session", "builderos.test-key"]);
  });

  test("access that changes mid-session is noticed on the next write", async ({ page }) => {
    await seed.company("lumen", other(), { name: "Lumen Notes" });
    await seed.grant("lumen", me.accountId, { scopes: ["view", "approve"] });
    await signIn(page);
    await page.goto("/c/lumen/approvals");
    await expect(page.getByTestId("approval-card")).toHaveCount(2);
    await seed.grant("lumen", me.accountId, { scopes: ["view"] });
    await page.getByTestId("approval-card").first().getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Your access doesn't cover this. Ask the founder.")).toBeVisible();
    await expect(nav(page).getByRole("link", { name: /Approvals/ })).toHaveCount(0);
  });
});

test.describe("agent work", () => {
  test("reports are grouped by team; the detail separates the agent's summary from recorded facts", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/teams");
    await expect(page.getByTestId("team-card")).toHaveCount(3);
    await expect(page.getByTestId("team-report-group")).toHaveCount(3);
    await page.getByTestId("team-card").filter({ hasText: /build/i }).click();
    await page.waitForURL("**/c/lumen/teams/build");
    await expect(page.getByText(/done ·/).first()).toBeVisible();
    await expect(page.getByTestId("report-card").first()).toContainText("Agent's summary");
    await page.getByTestId("report-card").filter({ hasText: "Note editor with autosave" }).first().getByRole("link").first().click();
    await page.waitForURL(/\/c\/lumen\/reports\//);
    await expect(page.getByTestId("agent-summary")).toContainText("Agent's summary");
    const facts = page.getByTestId("recorded-facts");
    await expect(facts).toBeVisible();
    await expect(facts).toContainText(/Checks/);
    await expect(facts).toContainText(/Review/);
    await expect(page.getByText(/Attempt 1/).first()).toBeVisible(); // earlier attempts of the same task
    await expect(page.getByText(/Attempt 2/).first()).toBeVisible();
  });

  test("a paused report links to Approvals", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/teams/growth");
    const paused = page.getByTestId("report-card").filter({ hasText: "Waiting on you" });
    await expect(paused).toBeVisible();
    await paused.getByRole("link", { name: /Approvals/ }).click();
    await page.waitForURL("**/c/lumen/approvals*");
  });

  test("a new plan in the company can be described and approved", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/work");
    await expect(page.getByTestId("plan-card")).toHaveCount(1);
    await expect(page.getByTestId("task-row")).toHaveCount(6);
    await page.getByRole("button", { name: "New plan" }).first().click();
    await page.getByLabel("What does it do?").fill("Add shared folders with per-folder permissions.");
    await page.getByRole("button", { name: /Plan it|Create plan/ }).click();
    await page.waitForURL(/\/work\/plans\//);
    await page.getByTestId("approve-plan").click();
    await signed(page);
    await expect(page.getByTestId("task-row")).toHaveCount(3);
  });

  test("a task can be priced on another tier and changed", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/work");
    await page.getByTestId("task-row").first().getByRole("link").first().click();
    await page.waitForURL(/\/work\/tasks\//);
    await page.getByLabel("Tier", { exact: true }).selectOption("premium");
    await page.getByRole("button", { name: "Estimate" }).click();
    await expect(page.getByTestId("estimate-result")).toContainText("$");
    await page.getByRole("button", { name: "Save change" }).click();
    await signed(page);
  });
});

test.describe("approvals and signing", () => {
  test("approve signs in order and clears the card; a wallet rejection changes nothing and can be retried", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/approvals");
    const cards = page.getByTestId("approval-card");
    await expect(cards).toHaveCount(2);
    await expect(page.getByTestId("approvals-badge")).toHaveText("2");

    // approve + always allow this seller = two transactions, in order
    const seller = cards.filter({ hasText: "namecheap.x402" });
    await expect(seller).toContainText("0x7b1E4c0f2A9d53e8C6B4a1F09d2E7c5B8a3F6D10");
    await seller.getByLabel("Always allow this seller").check();
    await seller.getByRole("button", { name: "Approve" }).click();
    const sheet = page.getByTestId("signing-sheet");
    await expect(sheet).toContainText("Approve the purchase");
    await expect(sheet).toContainText("Update team policy");
    await expect(sheet).toBeHidden({ timeout: 30_000 });
    await expect(cards).toHaveCount(1);
    await expect(page.getByTestId("approvals-badge")).toHaveText("1");

    // the person declines in the wallet: nothing changed
    await page.evaluate(() => ((window as any).__testWallet = { rejectNext: true }));
    await cards.first().getByRole("button", { name: "Reject" }).click();
    await expect(sheet).toHaveAttribute("data-phase", "rejected");
    await expect(sheet).toContainText("safe to repeat");
    await sheet.getByRole("button", { name: "Try again" }).click();
    await expect(sheet).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("Nothing is waiting on you")).toBeVisible();
    await expect(page.getByTestId("approvals-badge")).toHaveCount(0);
  });

  test("a write with the same Idempotency-Key gets the same answer", async ({ page }) => {
    await founderOf();
    await signIn(page);
    const out = await page.evaluate(async () => {
      const { token } = JSON.parse(window.localStorage.getItem("builderos.session")!);
      const call = () => fetch("http://localhost:4010/v1/freeze", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": "same-click" }, body: JSON.stringify({ companyId: "lumen" }) });
      const [a, b] = [await call(), await call()];
      return { replay: b.headers.get("idempotent-replay"), same: JSON.stringify(await a.json()) === JSON.stringify(await b.json()) };
    });
    expect(out).toEqual({ replay: "true", same: true });
  });

  test("pause all, then resume from the banner", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/settings");
    await page.getByTestId("pause-all").click();
    await page.getByTestId("confirm-pause").click();
    await signed(page);
    const banner = page.getByTestId("paused-banner");
    await expect(banner).toBeVisible();
    await page.goto("/c/lumen/teams"); // the banner follows every company page
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Resume" }).click();
    await signed(page);
    await expect(banner).toHaveCount(0);
  });

  test("an admin sees the paused banner without Resume", async ({ page }) => {
    await seed.company("lumen", other(), { name: "Lumen Notes", frozen: true });
    await seed.grant("lumen", me.accountId, { admin: true });
    await signIn(page);
    await page.goto("/c/lumen");
    const banner = page.getByTestId("paused-banner");
    await expect(banner).toContainText("Paused by the founder");
    await expect(banner.getByRole("button", { name: "Resume" })).toHaveCount(0);
    await page.goto("/c/lumen/settings");
    await expect(page.getByTestId("resume-all")).toHaveCount(0);
  });
});

test.describe("members and invites", () => {
  test("invite by email link, accept from a new wallet, then remove and prompt to rotate", async ({ page, browser }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/members");
    await expect(page.getByTestId("member-row")).toHaveCount(1);
    await page.getByTestId("invite-member").click();
    await page.getByTestId("invite-email").fill("ada@example.com");
    await page.getByTestId("invite-role").selectOption("approver");
    await page.getByTestId("invite-team").selectOption("build");
    await page.getByTestId("send-invite").click();
    await signed(page);
    const { outbox } = await seed.state(); // the email goes out only after signing
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("ada@example.com");
    expect(outbox[0].link).toMatch(/^\/invite\?code=/);

    // the invitee: a brand-new wallet, not signed in
    const ada = newIdentity();
    const ctx = await browser.newContext({ baseURL: "http://localhost:3100" });
    const p2 = await ctx.newPage();
    await useIdentity(p2, ada);
    await p2.goto(outbox[0].link);
    await expect(p2.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    await p2.getByTestId("signin-wallet").click();
    await expect(p2.getByTestId("invite-card")).toContainText("You're invited to Lumen Notes");
    await expect(p2.getByTestId("invite-card")).toContainText("Approver");
    // no NEAR for gas yet: explained, with the faucet
    await p2.getByTestId("accept-invite").click();
    await expect(p2.getByTestId("signing-sheet")).toHaveAttribute("data-phase", "failed");
    await expect(p2.getByTestId("signing-sheet")).toContainText("enough NEAR");
    await expect(p2.getByTestId("gas-help").getByRole("link", { name: "Get free testnet NEAR" })).toBeVisible();
    await seed.balance(ada.accountId, 1);
    await p2.getByTestId("signing-sheet").getByRole("button", { name: "Try again" }).click();
    await p2.waitForURL("**/c/lumen");
    await expect(nav(p2).getByRole("link", { name: /Approvals/ })).toBeVisible();
    await expect(nav(p2).getByRole("link", { name: "Work" })).toHaveCount(0);
    await ctx.close();

    // back with the founder: the stream refreshed the list
    await expect(page.getByTestId("member-row")).toHaveCount(2);
    await page.getByTestId("change-role").click();
    await expect(page.getByTestId("role-edit-unavailable")).toContainText("not available yet");
    await page.getByTestId("remove-member").click();
    await page.getByTestId("confirm-remove").click();
    await signed(page);
    await expect(page.getByTestId("rotate-prompt")).toBeVisible();
    await page.getByRole("link", { name: "Open key rotation" }).click();
    await page.waitForURL("**/c/lumen/settings*");
    await expect(page.getByTestId("rotate-key")).toBeVisible();
    expect((await seed.state()).companies[0].members).toHaveLength(0);
  });

  test("an invite sent to a verified email is accepted from the inbox", async ({ page, browser }) => {
    const founder = newIdentity();
    await seed.company("lumen", founder.accountId, { name: "Lumen Notes" });
    const ctx = await browser.newContext({ baseURL: "http://localhost:3100" });
    const fp = await ctx.newPage();
    await useIdentity(fp, founder);
    await signIn(fp);

    await seed.email(me.accountId, "kemi@example.com");
    await seed.balance(me.accountId, 1);
    await signIn(page, "wallet");
    await expect(page.getByTestId("welcome")).toBeVisible();

    await fp.goto("/c/lumen/members");
    await fp.getByTestId("invite-member").click();
    await fp.getByTestId("invite-email").fill("kemi@example.com");
    await fp.getByTestId("invite-role").selectOption("builder");
    await fp.getByTestId("send-invite").click();
    await signed(fp);
    await ctx.close();

    await page.goto("/inbox");
    await page.getByTestId("inbox-action-invite").click();
    await signed(page);
    await page.waitForURL("**/c/lumen");
    await expect(nav(page).getByRole("link", { name: "Work" })).toBeVisible();
  });

  test("an invalid invite link says so", async ({ page }) => {
    await signIn(page);
    await page.goto("/invite?code=not-a-real-code");
    await expect(page.getByText("This invite isn't valid anymore")).toBeVisible();
  });
});

test.describe("inbox and live updates", () => {
  test("the badge updates live, and the stream resumes after a dropped connection", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen");
    const badge = page.getByTestId("inbox-badge");
    await expect(badge).toBeVisible();
    const before = Number(await badge.textContent());

    await seed.approval("lumen", { title: "Extra build minutes", amount: 9.5 });
    await expect(badge).toHaveText(String(before + 1)); // no reload
    await expect(page.getByTestId("approvals-badge")).toHaveText("3");

    await seed.streamStatus(true);
    await expect(page.getByText("Syncing")).toBeVisible();
    await seed.streamStatus(false);
    await expect(page.getByText("Syncing")).toHaveCount(0);

    // the connection drops; the app reconnects from the last event it saw
    expect((await seed.dropStreams()).dropped).toBeGreaterThan(0);
    await seed.approval("lumen", { title: "Sent while offline" });
    await expect(badge).toHaveText(String(before + 2), { timeout: 20_000 });
    const { streamLog } = await seed.state();
    expect(streamLog.length).toBeGreaterThanOrEqual(2);
    expect(streamLog.at(-1).lastEventId).toBeGreaterThan(0);
  });

  test("urgent items come first; opening marks read; mark all read clears the badge", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/inbox");
    const items = page.getByTestId("inbox-item");
    await expect(items.first()).toHaveAttribute("data-urgent", "true");
    const urgent = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-urgent") === "true"));
    expect(urgent).toEqual([...urgent].sort((a, b) => Number(b) - Number(a)));

    await page.getByTestId("inbox-action-report").first().click();
    await page.waitForURL(/\/c\/lumen\/reports\//);
    await page.goBack();
    await expect(page.locator('[data-testid="inbox-item"][data-read="true"]')).toHaveCount(1);

    await page.getByTestId("mark-all-read").click();
    await expect(page.getByTestId("inbox-badge")).toHaveCount(0);
    await page.getByTestId("inbox-action-approval").first().click();
    await page.waitForURL(/\/c\/lumen\/approvals\?card=/);
    await expect(page.getByTestId("approval-card").first()).toBeVisible();
  });

  test("an invite shows on the Welcome home as well", async ({ page, browser }) => {
    const founder = newIdentity();
    await seed.company("lumen", founder.accountId, { name: "Lumen Notes" });
    await seed.email(me.accountId, "new@example.com");
    const ctx = await browser.newContext({ baseURL: "http://localhost:3100" });
    const fp = await ctx.newPage();
    await useIdentity(fp, founder);
    await signIn(fp);
    await fp.goto("/c/lumen/members");
    await fp.getByTestId("invite-member").click();
    await fp.getByTestId("invite-email").fill("new@example.com");
    await fp.getByTestId("send-invite").click();
    await signed(fp);
    await ctx.close();
    await signIn(page, "wallet");
    await expect(page.getByTestId("welcome")).toBeVisible();
    await expect(page.getByTestId("accept-invite")).toBeVisible();
  });
});

test.describe("money", () => {
  test("budgets go up only; daily cap; funding addresses with live deposits; ledger and CSV", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/money");
    await expect(page.getByTestId("budget-row")).toHaveCount(3);

    await page.getByTestId("raise-budget").first().click();
    await page.getByTestId("budget-input").fill("300"); // lower than $400
    await expect(page.getByText(/Budgets can only go up/)).toBeVisible();
    await expect(page.getByTestId("pause-team")).toBeVisible();
    await expect(page.getByTestId("confirm-budget")).toHaveCount(0);
    await page.getByTestId("budget-input").fill("450");
    await page.getByTestId("confirm-budget").click();
    await signed(page);
    await expect(page.getByTestId("team-budget").first()).toHaveText("$450.00");

    await page.getByTestId("change-daily-cap").click();
    await page.getByTestId("daily-cap-input").fill("80");
    await page.getByTestId("confirm-daily-cap").click();
    await signed(page);
    await expect(page.getByText("of $80.00 today")).toBeVisible();

    await expect(page.getByTestId("funding-row")).toHaveCount(3);
    await expect(page.getByTestId("funding-row").first()).toContainText("Base Sepolia");
    await expect(page.getByTestId("funding-row").first()).toContainText("0x");
    await page.getByTestId("funding-row").first().getByRole("button", { name: "QR" }).click();
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await seed.deposit("lumen", "build", 25);
    await expect(page.getByTestId("deposit-balance")).toHaveText("$25.00"); // deposit_received, no reload

    await expect(page.getByTestId("ledger-row").first()).toBeVisible();
    await page.getByTestId("ledger-row").first().click();
    await expect(page.getByTestId("receipt-detail")).toContainText("Verified on chain");
    await page.keyboard.press("Escape");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
    expect(download.suggestedFilename()).toBe("lumen-ledger.csv");

    // stable 501 answers render as honest "not available yet" states
    await expect(page.getByText(/Services: not available yet/)).toBeVisible();
    await expect(page.getByText("Planned")).toBeVisible();
  });

  test("the founder withdraws: plan first, then the wallet signs; a shortfall is explained", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/money");
    await page.getByTestId("withdraw").click();

    // the form checks the address against the chosen network before anything is sent
    await page.getByTestId("withdraw-amount").fill("40");
    await page.getByTestId("withdraw-chain").selectOption("base");
    await page.getByTestId("withdraw-to").fill("alice.testnet");
    await expect(page.getByText("This doesn't look like a Base address.")).toBeVisible();
    await expect(page.getByTestId("review-withdrawal")).toBeDisabled();
    await page.getByTestId("withdraw-to").fill("0x7b1E4c0f2A9d53e8C6B4a1F09d2E7c5B8a3F6D10");

    // nothing withdrawable yet (the testnet situation): said plainly, in dollars
    await page.getByTestId("review-withdrawal").click();
    await expect(page.getByTestId("withdraw-short")).toContainText("There isn't that much to withdraw");
    await expect(page.getByTestId("withdraw-short")).toContainText("$0.00");

    // funds arrive; the same request now returns a plan to review
    await seed.deposit("lumen", "build", 100);
    await page.getByTestId("review-withdrawal").click();
    const plan = page.getByTestId("withdrawal-plan");
    await expect(plan).toContainText("$40.00");
    await expect(plan).toContainText("0x7b1E4c0f2A9d53e8C6B4a1F09d2E7c5B8a3F6D10");
    await expect(plan).toContainText("From company treasury");
    await expect(plan).toContainText("can't be reversed");
    await page.getByTestId("confirm-withdrawal").click();
    await signed(page);

    await expect(page.getByTestId("deposit-balance")).toHaveText("$60.00");
    await expect(page.getByTestId("ledger-row").first()).toContainText("Withdrawal");
    await expect(page.getByTestId("ledger-row").first()).toContainText("$40.00");
  });

  test("only the founder sees Withdraw", async ({ page }) => {
    await seed.company("lumen", other(), { name: "Lumen Notes" });
    await seed.grant("lumen", me.accountId, { admin: true });
    await signIn(page);
    await page.goto("/c/lumen/money");
    await expect(page.getByTestId("budget-row").first()).toBeVisible();
    await expect(page.getByTestId("withdraw")).toHaveCount(0);
  });

  test("a v2 company explains the contract upgrade instead of hiding the feature", async ({ page }) => {
    await founderOf("legacy", { name: "Legacy Co", version: 2 });
    await signIn(page);
    await page.goto("/c/legacy/money");
    await page.getByTestId("raise-budget").first().click();
    await page.getByTestId("budget-input").fill("900");
    await page.getByTestId("confirm-budget").click();
    await expect(page.getByText("This company needs a contract upgrade for this feature.")).toBeVisible();
    await expect(page.getByText(/wait 24 hours/)).toBeVisible();
  });
});

test.describe("settings", () => {
  test("agents: register, pause, resume, remove", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/settings");
    await expect(page.getByTestId("agent-row")).toHaveCount(2);
    await page.getByTestId("register-agent").click();
    await page.getByTestId("agent-key").fill("ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp");
    await page.getByTestId("confirm-agent").click();
    await signed(page);
    await expect(page.getByTestId("agent-row")).toHaveCount(3);

    const first = page.getByTestId("agent-row").first();
    await first.getByTestId("agent-toggle").click();
    await expect(first).toContainText("Paused");
    await first.getByTestId("agent-toggle").click();
    await expect(first).toContainText("Running");
    await first.getByTestId("agent-fire").click();
    await page.getByTestId("confirm-fire").click();
    await signed(page);
    await expect(page.getByTestId("agent-row")).toHaveCount(2);
  });

  test("register this device, then rotate the code key in four steps", async ({ page }) => {
    await founderOf();
    await signIn(page);
    await page.goto("/c/lumen/settings");
    await page.getByTestId("register-device").click();
    await signed(page);
    await expect(page.getByText("Registered", { exact: true })).toBeVisible();
    await expect(page.getByTestId("device-key")).toHaveText(/^[A-Za-z0-9+/]{43}=$/);

    await page.getByTestId("rotate-key").click();
    await expect(page.getByTestId("rotate-done")).toContainText("1 device", { timeout: 30_000 });
    const c = (await seed.state()).companies[0];
    expect(c.codeKeyVersion).toBe(2);
    expect(c.wrapped).toBe(1); // a libsodium-compatible sealed box per device
    // the private half never left the browser
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("builderos.device-key.lumen")!));
    expect(Object.keys(stored).sort()).toEqual(["publicKey", "secretKey"]);
  });

  test("payment setup on a v2 company shows the upgrade notice", async ({ page }) => {
    await founderOf("legacy", { name: "Legacy Co", version: 2 });
    await signIn(page);
    await page.goto("/c/legacy/settings");
    await page.getByTestId("configure-payments").click();
    await expect(page.getByText("This company needs a contract upgrade for this feature.")).toBeVisible();
  });
});

test.describe("demo", () => {
  test("the sample company uses the same screens, read-only, without signing in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "See a sample company" }).click();
    await page.waitForURL("**/demo");
    await expect(page.getByTestId("demo-ribbon")).toContainText("read-only");
    await expect(page.getByRole("heading", { name: "Lumen Notes" })).toBeVisible();
    await expect(page.getByTestId("section-money")).toBeVisible();
    await expect(page.getByTestId("section-work")).toBeVisible();
    await expect(page.getByTestId("inbox-link")).toHaveCount(0);
    await expect(page.getByTestId("company-switcher")).toHaveCount(0);

    await nav(page).getByRole("link", { name: /Approvals/ }).click();
    await page.waitForURL("**/demo/approvals");
    const approve = page.getByTestId("approval-card").first().getByRole("button", { name: "Approve" });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAttribute("title", "Sign in to do this in your own company");

    await nav(page).getByRole("link", { name: "Teams" }).click();
    await expect(page.getByTestId("team-card")).toHaveCount(3);
    await page.getByTestId("report-card").first().getByRole("link").first().click();
    await page.waitForURL(/\/demo\/reports\//);
    await expect(page.getByTestId("agent-summary")).toBeVisible();

    for (const path of ["/demo/work", "/demo/money", "/demo/members", "/demo/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (const b of await page.locator('button[title="Sign in to do this in your own company"]').all()) await expect(b).toBeDisabled();
    }
    await page.goto("/demo/members");
    await expect(page.getByTestId("invite-member")).toBeDisabled();
    await page.getByRole("link", { name: "Sign in to build yours" }).first().click();
    await page.waitForURL(/\/$/);
  });
});

test.describe("account", () => {
  test("change email with a code; the old address stays until confirmed; sign out", async ({ page }) => {
    await signIn(page);
    await page.goto("/account");
    await expect(page.getByTestId("account-email")).toContainText("@privy.test");
    await expect(page.getByTestId("account-email")).toContainText("Verified by sign-in");
    await page.getByTestId("change-email").click();
    await expect(page.getByText("Your current address stays active until the new one is confirmed.")).toBeVisible();
    await page.getByRole("textbox", { name: "Email" }).fill("new@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    const code = page.getByLabel("6-digit code");
    await code.fill((await code.getAttribute("data-dev-code"))!);
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByTestId("account-email")).toContainText("@example.com");

    await page.evaluate(() => window.sessionStorage.setItem("test.signed-out", "1"));
    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/$/);
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  });
});
