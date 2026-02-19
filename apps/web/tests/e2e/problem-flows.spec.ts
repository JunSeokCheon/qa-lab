import { expect, test, type Page } from "@playwright/test";

const problemId = process.env.PW_PROBLEM_ID ?? "1";

async function loginAsStudent(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("email").fill("user@example.com");
  await page.getByPlaceholder("password").fill("user1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openProblemPage(page: Page) {
  await page.getByTestId("problem-id-input").fill(problemId);
  await page.getByTestId("open-problem-button").click();
  await expect(page).toHaveURL(new RegExp(`/problems/${problemId}$`));
  await expect(page.getByTestId("problem-workbench")).toBeVisible();
  await expect(page.getByTestId("workbench-ready")).toHaveAttribute("data-ready", "1");
}

test("login -> 문제 열기 -> run public tests -> pass/summary 표시", async ({ page }) => {
  await loginAsStudent(page);
  await openProblemPage(page);

  await page.getByTestId("run-public-button").click();
  const panel = page.getByTestId("public-result-panel");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("public-status")).toContainText(/PASS|PASSED|FAILED/i);
  await expect(page.getByTestId("public-summary")).toContainText(/summary: passed/i);
});

test("login -> 문제 제출 -> 상태 전환 -> 점수 표시", async ({ page }) => {
  await loginAsStudent(page);
  await openProblemPage(page);

  await page.getByTestId("submit-button").click();

  const timeline = page.getByTestId("submission-status-timeline");
  await expect(timeline).toContainText("QUEUED", { timeout: 20_000 });
  await expect(timeline).toContainText(/GRADED|FAILED/, { timeout: 90_000 });

  const score = page.getByTestId("submission-score");
  await expect(score).toContainText(/\d+\/\d+/, { timeout: 90_000 });
});
