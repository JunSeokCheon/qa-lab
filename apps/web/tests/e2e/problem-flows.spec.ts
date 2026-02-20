import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBaseUrl = process.env.PW_API_BASE_URL ?? "http://127.0.0.1:8000";

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

async function createExamViaApi(request: APIRequestContext): Promise<number> {
  const loginResponse = await request.post(`${apiBaseUrl}/auth/login`, {
    data: { username: "admin", password: "admin1234" },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginPayload = (await loginResponse.json()) as { access_token: string };

  const examResponse = await request.post(`${apiBaseUrl}/admin/exams`, {
    headers: {
      Authorization: `Bearer ${loginPayload.access_token}`,
    },
    data: {
      title: `playwright 시험 ${Date.now()}`,
      description: "e2e 제출 테스트용",
      exam_kind: "quiz",
      status: "published",
      questions: [
        {
          type: "multiple_choice",
          prompt_md: "다음 중 정답을 고르세요.",
          required: true,
          choices: ["A", "B", "C"],
          correct_choice_index: 0,
        },
        {
          type: "subjective",
          prompt_md: "간단한 소감을 작성하세요.",
          required: true,
        },
      ],
    },
  });
  expect(examResponse.ok()).toBeTruthy();
  const examPayload = (await examResponse.json()) as { id: number };
  return examPayload.id;
}

test("login -> open exam list -> start exam page", async ({ page, request }) => {
  const examId = await createExamViaApi(request);
  await loginAsStudent(page);
  await page.goto("/problems");

  await expect(page.getByRole("heading", { name: "시험 목록" })).toBeVisible();
  await page.locator(`a[href='/problems/${examId}']`).first().click();
  await expect(page).toHaveURL(new RegExp(`/problems/${examId}$`));
  await expect(page.getByRole("button", { name: "시험 제출" })).toBeVisible();
});

test("login -> show exams in list", async ({ page, request }) => {
  await createExamViaApi(request);
  await loginAsStudent(page);
  await page.goto("/problems");

  await expect(page.getByRole("link", { name: /시험 시작|응답 보기/ }).first()).toBeVisible();
});

test("login -> submit exam once", async ({ page, request }) => {
  const examId = await createExamViaApi(request);
  await loginAsStudent(page);
  await page.goto(`/problems/${examId}`);

  await page.locator("input[type='radio']").first().check();
  await page.getByPlaceholder("답안을 입력하세요.").fill("Playwright 제출");
  await page.getByRole("button", { name: "시험 제출" }).click();
  await expect(page.getByText("시험이 제출되었습니다. 채점은 관리자 검토 후 진행됩니다.")).toBeVisible();
});

test("admin -> create exam via builder", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/problems");
  await expect(page.getByRole("heading", { name: "시험지 관리" })).toBeVisible();

  const examName = `관리자 생성 시험 ${Date.now()}`;
  await page.getByPlaceholder("시험 제목 (예: 파이썬 퀴즈)").fill(examName);
  await page.getByPlaceholder("문항 내용을 입력하세요.").first().fill("관리자 문항 테스트");
  await page.getByRole("button", { name: "시험지 생성" }).click();
  await expect(page.getByText(/시험이 생성되었습니다\. \(시험 ID:/)).toBeVisible({ timeout: 30_000 });
});
