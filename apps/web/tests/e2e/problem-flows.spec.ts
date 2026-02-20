import { expect, test, type Page } from "@playwright/test";

const apiBaseUrl = process.env.PW_API_BASE_URL ?? "http://127.0.0.1:8000";

async function resolveProblemId(page: Page): Promise<string> {
  if (process.env.PW_PROBLEM_ID) return process.env.PW_PROBLEM_ID;

  const response = await page.request.get(`${apiBaseUrl}/problems`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as Array<{ id: number }>;
  expect(payload.length).toBeGreaterThan(0);
  return String(payload[0].id);
}

async function loginAsStudent(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("아이디").fill("user");
  await page.getByPlaceholder("비밀번호").fill("user1234");
  await page.getByRole("button", { name: /로그인|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("아이디").fill("admin");
  await page.getByPlaceholder("비밀번호").fill("admin1234");
  await page.getByRole("button", { name: /로그인|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openProblemPage(page: Page) {
  const problemId = await resolveProblemId(page);
  await page.getByTestId("problem-id-input").fill(problemId);
  await page.getByTestId("open-problem-button").click();
  await expect(page).toHaveURL(new RegExp(`/problems/${problemId}$`));
  await expect(page.getByTestId("problem-workbench")).toBeVisible();
  await expect(page.getByTestId("workbench-ready")).toHaveAttribute("data-ready", "1");
}

async function answerCurrentProblem(page: Page) {
  const radioOptions = page.locator(`input[type="radio"]`);
  if ((await radioOptions.count()) > 0) {
    await radioOptions.first().check();
    return;
  }

  const codeEditor = page.getByTestId("code-input");
  if (await codeEditor.isVisible()) {
    return;
  }

  const subjective = page.getByPlaceholder("답안을 입력하세요.");
  if (await subjective.isVisible()) {
    await subjective.fill("정답");
  }
}

test("login -> open problem -> show submit workbench", async ({ page }) => {
  await loginAsStudent(page);
  await openProblemPage(page);

  await expect(page.getByTestId("submit-button")).toBeVisible();
  await expect(page.getByTestId("submission-status-timeline")).toContainText("-");
});

test("login -> category buttons -> show filtered problems", async ({ page }) => {
  await loginAsStudent(page);
  await page.goto("/problems");

  await page.getByRole("button", { name: "전처리" }).click();
  await expect(page.getByRole("link", { name: "문제 풀기" })).toHaveCount(2);
});

test("login -> submit -> status transition -> show score", async ({ page }) => {
  await loginAsStudent(page);
  await openProblemPage(page);
  await answerCurrentProblem(page);

  await page.getByTestId("submit-button").click();

  const timeline = page.getByTestId("submission-status-timeline");
  await expect(timeline).toContainText(/대기|채점 완료|채점 실패|QUEUED|GRADED|FAILED/, { timeout: 20_000 });
  await expect(timeline).toContainText(/채점 완료|채점 실패|GRADED|FAILED/, { timeout: 90_000 });

  const score = page.getByTestId("submission-score");
  await expect(score).toContainText(/\d+\/\d+/, { timeout: 90_000 });
});

test("admin -> problems manager -> create skill success", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/problems");
  await expect(page.getByRole("heading", { name: "문제/번들 관리" })).toBeVisible();

  const skillName = `pw-skill-${Date.now()}`;
  await page.getByPlaceholder("스킬 이름").fill(skillName);
  await page.getByPlaceholder("설명 (선택)").fill("playwright admin flow");
  await page.getByRole("button", { name: "스킬 생성" }).click();

  await expect(page.getByText(/스킬 생성 완료 \(id=\d+\)/)).toBeVisible({ timeout: 30_000 });
});
