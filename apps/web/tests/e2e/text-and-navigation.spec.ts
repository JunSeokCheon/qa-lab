import { expect, test } from "@playwright/test";

import { expectNoBrokenText, loginViaUi } from "./helpers/ui";

test.describe("text rendering and admin navigation", () => {
  test("public pages render without broken characters", async ({ page }) => {
    const paths = ["/", "/login", "/signup", "/forgot-password"];

    for (const path of paths) {
      await page.goto(path);
      await expectNoBrokenText(page);
    }
  });

  test("admin quick-action buttons navigate as expected", async ({ page }) => {
    await loginViaUi(page, "admin", "admin1234");
    await expect(page).toHaveURL(/\/$/);
    await expectNoBrokenText(page);

    const adminNavCases = [
      { label: "자동채점 관리", url: /\/admin\/grading$/ },
      { label: "시험지 관리", url: /\/admin\/problems$/ },
      { label: "시험 목록", url: /\/admin\/exams$/ },
      { label: "사용자 관리", url: /\/admin\/users$/ },
      { label: "대시보드", url: /\/dashboard$/ },
    ];

    for (const navCase of adminNavCases) {
      await page.goto("/");
      await page.getByRole("button", { name: navCase.label }).click();
      await expect(page).toHaveURL(navCase.url);
      await expectNoBrokenText(page);
    }
  });
});

