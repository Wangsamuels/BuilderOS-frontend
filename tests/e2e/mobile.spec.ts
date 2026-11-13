import { expect, test } from "@playwright/test";
import { newIdentity, noHorizontalScroll, seed, signed, signIn, useIdentity } from "./helpers";

/** The same flows on a phone: bottom navigation, sheets, and no sideways scrolling anywhere. */
test.beforeEach(async () => void (await seed.reset()));

test("landing, sign-in and the whole workspace fit a phone", async ({ page }) => {
  const me = newIdentity();
  await seed.company("lumen", me.accountId, { name: "Lumen Notes" });
  await useIdentity(page, me);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByTestId("signin-google").scrollIntoViewIfNeeded();
  await page.getByTestId("signin-google").click();
  await page.waitForURL(/\/(home|c\/)/);

  for (const path of ["/home", "/inbox", "/account", "/drafts/new", "/c/lumen", "/c/lumen/teams", "/c/lumen/teams/build", "/c/lumen/work", "/c/lumen/approvals", "/c/lumen/money", "/c/lumen/members", "/c/lumen/settings", "/demo"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    await noHorizontalScroll(page);
  }
});

test("bottom navigation reaches every area, and approving works with a thumb", async ({ page }) => {
  const me = newIdentity();
  await seed.company("lumen", me.accountId, { name: "Lumen Notes" });
  await useIdentity(page, me);
  await signIn(page);
  await page.goto("/c/lumen");
  const bar = page.getByRole("navigation", { name: /Company/ }).last();
  await bar.getByRole("link", { name: /Teams/ }).click();
  await page.waitForURL("**/c/lumen/teams");
  await bar.getByRole("button", { name: /More/ }).click();
  await page.getByRole("link", { name: "Settings" }).last().click();
  await page.waitForURL("**/c/lumen/settings");
  await bar.getByRole("link", { name: /Approvals/ }).click();
  await page.waitForURL("**/c/lumen/approvals");
  await page.getByTestId("approval-card").first().getByRole("button", { name: "Approve" }).click();
  await signed(page);
  await expect(page.getByTestId("approval-card")).toHaveCount(1);
  await noHorizontalScroll(page);
});

test("the launch wizard fits a phone", async ({ page }) => {
  const me = newIdentity();
  await seed.balance(me.accountId, 40);
  await useIdentity(page, me);
  await signIn(page);
  await page.goto("/drafts/new");
  await page.getByLabel("What does it do?").fill("A booking tool for independent tutors with reminders.");
  await page.getByRole("button", { name: "Plan it" }).click();
  await page.waitForURL(/\/drafts\/draft_/);
  await noHorizontalScroll(page);
  await page.getByTestId("launch").click();
  for (const step of ["company", "teams", "funding"]) {
    await expect(page.getByTestId("launch-wizard")).toHaveAttribute("data-step", step);
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByTestId("create-company").click();
  await expect(page.getByTestId("company-created")).toBeVisible({ timeout: 30_000 });
  await noHorizontalScroll(page);
});
