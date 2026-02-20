import { expect, test, type Page } from "@playwright/test";

const problemId = process.env.PW_PROBLEM_ID ?? "1";

async function loginAsStudent(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("email").fill("user@example.com");
  await page.getByPlaceholder("password").fill("user1234");
  await page.getByRole("button", { name: /로그인|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("email").fill("admin@example.com");
  await page.getByPlaceholder("password").fill("admin1234");
  await page.getByRole("button", { name: /로그인|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openProblemPage(page: Page) {
  await page.getByTestId("problem-id-input").fill(problemId);
  await page.getByTestId("open-problem-button").click();
  await expect(page).toHaveURL(new RegExp(`/problems/${problemId}$`));
  await expect(page.getByTestId("problem-workbench")).toBeVisible();
  await expect(page.getByTestId("workbench-ready")).toHaveAttribute("data-ready", "1");
}

test("login -> open problem -> show submit workbench", async ({ page }) => {
  await loginAsStudent(page);
  await openProblemPage(page);

  await expect(page.getByTestId("submit-button")).toBeVisible();
  await expect(page.getByTestId("submission-status-timeline")).toContainText("-");
});

test("login -> submit -> status transition -> show score", async ({ page }) => {
  await loginAsStudent(page);
  await openProblemPage(page);

  await page.getByTestId("submit-button").click();

  const timeline = page.getByTestId("submission-status-timeline");
  await expect(timeline).toContainText("QUEUED", { timeout: 20_000 });
  await expect(timeline).toContainText(/GRADED|FAILED/, { timeout: 90_000 });

  const score = page.getByTestId("submission-score");
  await expect(score).toContainText(/\d+\/\d+/, { timeout: 90_000 });
});

test("admin -> problems manager -> create skill success", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/problems");
  await expect(page.getByRole("heading", { name: "Problem and Bundle Manager" })).toBeVisible();

  const skillName = `pw-skill-${Date.now()}`;
  await page.getByPlaceholder("skill name").fill(skillName);
  await page.getByPlaceholder("description (optional)").fill("playwright admin flow");
  await page.getByRole("button", { name: "Create skill" }).click();

  await expect(page.getByText(/Skill created \(id=\d+\)/)).toBeVisible({ timeout: 30_000 });
});
