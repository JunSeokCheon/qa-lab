import { expect, type Page } from "@playwright/test";

export async function expectNoBrokenText(page: Page) {
  const bodyText = await page.locator("body").innerText();
  expect(bodyText.includes("\uFFFD"), `Found replacement char on ${page.url()}`).toBeFalsy();
}

export async function loginViaUi(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("아이디").fill(username);
  await page.getByPlaceholder("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

