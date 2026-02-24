import { expect, test } from "@playwright/test";

import { api, createExam, deleteExam, deleteUsersByKeyword, loginApi, registerUser } from "./helpers/api";
import { expectNoBrokenText, loginViaUi } from "./helpers/ui";

test("user can submit an exam through the intended button flow", async ({ page, request }) => {
  const suffix = Date.now();
  const username = `e2e_user_${suffix}`;
  const userKeyword = `e2e_user_${suffix}`;
  const password = "userpass1234";
  const examTitle = `e2e-submit-flow-${suffix}`;

  let examId: number | null = null;
  const adminToken = await loginApi(request, "admin", "admin1234");

  try {
    await registerUser(request, {
      username,
      name: `E2E User ${suffix}`,
      track_name: "데이터 분석 11기",
      password,
    });

    const folderList = await api(request, "GET", "/admin/problem-folders", {
      token: adminToken,
      expected: [200],
    });
    const folders = Array.isArray(folderList.data) ? folderList.data : [];
    let folderId: number | null = null;
    const firstFolder = folders[0] as { id?: unknown } | undefined;
    if (folders.length > 0 && typeof firstFolder?.id === "number") {
      folderId = firstFolder.id;
    } else {
      const createdFolder = await api(request, "POST", "/admin/problem-folders", {
        token: adminToken,
        json: {
          name: `E2E-${suffix}`,
          slug: `e2e-${suffix}`,
        },
        expected: [201],
      });
      const createdFolderId = (createdFolder.data as { id?: unknown } | null)?.id;
      folderId = typeof createdFolderId === "number" ? createdFolderId : null;
    }
    expect(folderId).not.toBeNull();

    const createdExam = await createExam(request, adminToken, {
      title: examTitle,
      description: "리팩터링 회귀 검증용 시험",
      folder_id: folderId,
      exam_kind: "quiz",
      target_track_name: "데이터 분석 11기",
      status: "published",
      duration_minutes: 30,
      questions: [
        {
          type: "multiple_choice",
          prompt_md: "2 + 2 = ?",
          required: true,
          choices: ["3", "4", "5"],
          correct_choice_index: 1,
          answer_key_text: null,
        },
        {
          type: "subjective",
          prompt_md: "한 줄 소개를 작성하세요.",
          required: true,
          choices: null,
          correct_choice_index: null,
          answer_key_text: "자기소개",
        },
      ],
    });
    examId = createdExam.id;

    await loginViaUi(page, username, password);
    await expect(page).toHaveURL(/\/$/);
    await expectNoBrokenText(page);

    await page.getByRole("button", { name: "시험 목록" }).click();
    await expect(page).toHaveURL(/\/problems$/);
    await expectNoBrokenText(page);

    const examCard = page.locator("article").filter({ hasText: examTitle }).first();
    await expect(examCard).toBeVisible({ timeout: 20_000 });
    await examCard.getByRole("link", { name: "시험 시작" }).click();

    await expect(page).toHaveURL(new RegExp(`/problems/${examId}$`));
    await expectNoBrokenText(page);

    const multipleChoiceCard = page.locator("article").filter({ hasText: "2 + 2 = ?" }).first();
    await multipleChoiceCard.locator("input[type='radio']").nth(1).check();

    await page.getByRole("button", { name: "정답 입력" }).first().click();
    const answerModal = page.locator("div").filter({ hasText: "문항 2 답안 입력" }).first();
    await expect(answerModal).toBeVisible();
    await answerModal.getByRole("textbox").fill("자기소개");
    await answerModal.getByRole("button", { name: "닫기" }).click();

    await page.getByRole("button", { name: "시험 제출" }).click();
    await expect(page.getByText("시험지를 제출하시겠습니까?")).toBeVisible();
    await page.getByRole("button", { name: "최종 제출" }).click();

    await expect(page).toHaveURL(/\/problems$/, { timeout: 20_000 });
    const submittedExamCard = page.locator("article").filter({ hasText: examTitle }).first();
    await expect(submittedExamCard.getByText("제출 완료")).toBeVisible();
    await submittedExamCard.getByRole("link", { name: "응답 보기" }).click();

    await expect(page).toHaveURL(new RegExp(`/problems/${examId}$`), { timeout: 20_000 });
    await expect(page.getByText("제출 상태: 제출 완료")).toBeVisible();
    await expectNoBrokenText(page);
  } finally {
    if (examId !== null) {
      await deleteExam(request, adminToken, examId).catch(() => undefined);
    }
    await deleteUsersByKeyword(request, adminToken, userKeyword).catch(() => undefined);
  }
});
