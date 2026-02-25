import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { api, createExam, deleteExam, deleteUsersByKeyword, loginApi } from "./helpers/api";
import { loginViaUi } from "./helpers/ui";

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000";
const WEB_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const TRACK_NAME = "데이터 분석 11기";

type AuthTokens = {
  access_token: string;
  refresh_token: string;
};

async function loginTokensApi(request: APIRequestContext, username: string, password: string): Promise<AuthTokens> {
  const result = await api(request, "POST", "/auth/login", {
    json: { username, password },
    expected: [200],
  });
  const payload = result.data as Partial<AuthTokens> | null;
  expect(payload?.access_token).toBeTruthy();
  expect(payload?.refresh_token).toBeTruthy();
  return {
    access_token: payload?.access_token as string,
    refresh_token: payload?.refresh_token as string,
  };
}

async function uploadResource(
  request: APIRequestContext,
  adminToken: string,
  examId: number,
  fileName: string,
  content: string,
): Promise<number> {
  const response = await request.fetch(`${API_BASE_URL}/admin/exams/${examId}/resources`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    multipart: {
      file: {
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from(content, "utf-8"),
      },
    },
  });

  expect(response.status(), "resource upload must succeed").toBe(201);
  const payload = (await response.json()) as { id?: number };
  expect(typeof payload.id).toBe("number");
  return payload.id as number;
}

async function overwriteCookie(page: Page, name: string, value: string) {
  const domain = new URL(WEB_BASE_URL).hostname;
  await page.context().addCookies([
    {
      name,
      value,
      domain,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test("exam submit succeeds even if access token is invalid during the exam", async ({ page, request }) => {
  const suffix = Date.now();
  const username = `e2e_token_submit_${suffix}`;
  const userKeyword = `e2e_token_submit_${suffix}`;
  const password = "userpass1234";
  const examTitle = `e2e-token-submit-${suffix}`;

  const adminToken = await loginApi(request, "admin", "admin1234");
  let examId: number | null = null;

  try {
    await api(request, "POST", "/auth/register", {
      json: {
        username,
        name: `Token Submit ${suffix}`,
        track_name: TRACK_NAME,
        password,
      },
      expected: [201],
    });

    const createdExam = await createExam(request, adminToken, {
      title: examTitle,
      description: "토큰 만료/손상 제출 복구 검증",
      exam_kind: "quiz",
      target_track_name: TRACK_NAME,
      status: "published",
      duration_minutes: 60,
      questions: [
        {
          type: "multiple_choice",
          prompt_md: "1 + 1 = ?",
          required: true,
          choices: ["1", "2", "3"],
          correct_choice_index: 1,
          answer_key_text: null,
        },
        {
          type: "subjective",
          prompt_md: "짧은 소개를 적으세요.",
          required: true,
          choices: null,
          correct_choice_index: null,
          answer_key_text: "소개",
        },
      ],
    });
    examId = createdExam.id;

    await loginViaUi(page, username, password);
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "시험 목록" }).click();
    await expect(page).toHaveURL(/\/problems$/);

    const examCard = page.locator("article").filter({ hasText: examTitle }).first();
    await expect(examCard).toBeVisible({ timeout: 20_000 });
    await examCard.getByRole("link", { name: "시험 시작" }).click();
    await expect(page).toHaveURL(new RegExp(`/problems/${examId}$`));

    await page.locator("article").filter({ hasText: "1 + 1 = ?" }).first().locator("input[type='radio']").nth(1).check();
    await page.getByRole("button", { name: "정답 입력" }).first().click();
    const modal = page.locator("div").filter({ hasText: "문항 2 답안 입력" }).first();
    await expect(modal).toBeVisible();
    await modal.getByRole("textbox").fill("소개");
    await modal.getByRole("button", { name: "닫기" }).click();

    await overwriteCookie(page, "access_token", "broken-access-token-value");

    await page.getByRole("button", { name: "시험 제출" }).click();
    await expect(page.getByText("시험지를 제출하시겠습니까?")).toBeVisible();
    await page.getByRole("button", { name: "최종 제출" }).click();

    await expect(page).toHaveURL(/\/problems$/, { timeout: 20_000 });
    const submittedExamCard = page.locator("article").filter({ hasText: examTitle }).first();
    await expect(submittedExamCard.getByText("제출 완료")).toBeVisible();
  } finally {
    if (examId !== null) {
      await deleteExam(request, adminToken, examId).catch(() => undefined);
    }
    await deleteUsersByKeyword(request, adminToken, userKeyword).catch(() => undefined);
  }
});

test("resource list/download recovers from invalid access token via refresh token", async ({ page, request }) => {
  const suffix = Date.now();
  const username = `e2e_token_resource_${suffix}`;
  const userKeyword = `e2e_token_resource_${suffix}`;
  const password = "userpass1234";
  const examTitle = `e2e-token-resource-${suffix}`;

  const adminToken = await loginApi(request, "admin", "admin1234");
  let examId: number | null = null;

  try {
    await api(request, "POST", "/auth/register", {
      json: {
        username,
        name: `Token Resource ${suffix}`,
        track_name: TRACK_NAME,
        password,
      },
      expected: [201],
    });

    const createdExam = await createExam(request, adminToken, {
      title: examTitle,
      description: "토큰 손상 상태 리소스 다운로드 복구 검증",
      exam_kind: "quiz",
      target_track_name: TRACK_NAME,
      status: "published",
      duration_minutes: 60,
      questions: [
        {
          type: "multiple_choice",
          prompt_md: "리소스 다운로드 검증 문항",
          required: true,
          choices: ["A", "B", "C"],
          correct_choice_index: 0,
          answer_key_text: null,
        },
      ],
    });
    examId = createdExam.id;

    const resourceId = await uploadResource(request, adminToken, examId, `token-resource-${suffix}.txt`, "resource-ok");

    await loginViaUi(page, username, password);
    await expect(page).toHaveURL(/\/$/);

    await overwriteCookie(page, "access_token", "broken-access-token-value");

    const resourcesRes = await page.request.get(`/api/exams/${examId}/resources`);
    expect(resourcesRes.status()).toBe(200);
    const resourceList = (await resourcesRes.json()) as Array<{ id?: number }>;
    expect(resourceList.some((item) => item.id === resourceId)).toBeTruthy();

    const downloadRes = await page.request.get(`/api/exams/${examId}/resources/${resourceId}/download`);
    expect(downloadRes.status()).toBe(200);
    await expect(downloadRes.text()).resolves.toContain("resource-ok");
  } finally {
    if (examId !== null) {
      await deleteExam(request, adminToken, examId).catch(() => undefined);
    }
    await deleteUsersByKeyword(request, adminToken, userKeyword).catch(() => undefined);
  }
});

test("submit returns 401 gracefully when both access and refresh tokens are invalid", async ({ page, request }) => {
  const suffix = Date.now();
  const username = `e2e_token_fail_${suffix}`;
  const userKeyword = `e2e_token_fail_${suffix}`;
  const password = "userpass1234";
  const examTitle = `e2e-token-fail-${suffix}`;

  const adminToken = await loginApi(request, "admin", "admin1234");
  let examId: number | null = null;
  let questionId: number | null = null;

  try {
    await api(request, "POST", "/auth/register", {
      json: {
        username,
        name: `Token Fail ${suffix}`,
        track_name: TRACK_NAME,
        password,
      },
      expected: [201],
    });

    const createdExam = await createExam(request, adminToken, {
      title: examTitle,
      description: "무효 토큰 401 응답 검증",
      exam_kind: "quiz",
      target_track_name: TRACK_NAME,
      status: "published",
      duration_minutes: 60,
      questions: [
        {
          type: "multiple_choice",
          prompt_md: "무효 토큰 테스트",
          required: true,
          choices: ["A", "B", "C"],
          correct_choice_index: 0,
          answer_key_text: null,
        },
      ],
    });
    examId = createdExam.id;
    questionId = createdExam.questions[0]?.id ?? null;
    expect(questionId).not.toBeNull();

    await loginViaUi(page, username, password);
    await expect(page).toHaveURL(/\/$/);

    await overwriteCookie(page, "access_token", "invalid-access-token");
    await overwriteCookie(page, "refresh_token", "invalid-refresh-token");

    const submitRes = await page.request.post(`/api/exams/${examId}/submit`, {
      data: {
        answers: [{ question_id: questionId, selected_choice_index: 0 }],
      },
    });
    expect(submitRes.status()).toBe(401);
  } finally {
    if (examId !== null) {
      await deleteExam(request, adminToken, examId).catch(() => undefined);
    }
    await deleteUsersByKeyword(request, adminToken, userKeyword).catch(() => undefined);
  }
});

test("auth invariants: case-insensitive signup conflict and token-type misuse rejection", async ({ request }) => {
  const suffix = Date.now();
  const baseUsername = `e2e_case_user_${suffix}`;
  const upperUsername = baseUsername.toUpperCase();
  const lowerUsername = baseUsername.toLowerCase();
  const password = "userpass1234";
  const adminToken = await loginApi(request, "admin", "admin1234");

  try {
    await api(request, "POST", "/auth/register", {
      json: {
        username: upperUsername,
        name: `Case User ${suffix}`,
        track_name: TRACK_NAME,
        password,
      },
      expected: [201],
    });

    await api(request, "POST", "/auth/register", {
      json: {
        username: lowerUsername,
        name: `Case User Duplicate ${suffix}`,
        track_name: TRACK_NAME,
        password,
      },
      expected: [409],
    });

    const tokens = await loginTokensApi(request, lowerUsername, password);

    await api(request, "POST", "/auth/refresh", {
      json: { refresh_token: tokens.access_token },
      expected: [401],
    });

    await api(request, "GET", "/me", {
      token: tokens.refresh_token,
      expected: [401],
    });
  } finally {
    await deleteUsersByKeyword(request, adminToken, baseUsername).catch(() => undefined);
  }
});
