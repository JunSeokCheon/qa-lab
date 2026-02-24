import { expect, test } from "@playwright/test";

import { expectNoBrokenText, loginViaUi } from "./helpers/ui";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn7n5kAAAAASUVORK5CYII=",
  "base64",
);

test("admin exam builder supports multi-image attach/remove and scrolls to top on create validation error", async ({
  page,
}) => {
  await loginViaUi(page, "admin", "admin1234");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/admin/problems");
  await expect(page).toHaveURL(/\/admin\/problems$/);
  await expectNoBrokenText(page);

  const firstQuestionCard = page.locator("article.rounded-2xl.border").first();
  const imageInput = firstQuestionCard.locator("input[type='file'][accept='image/*'][multiple]");
  await expect(imageInput).toHaveCount(1);

  await imageInput.setInputFiles([
    { name: "e2e-image-1.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "e2e-image-2.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);

  const removeButtons = firstQuestionCard.locator("button[aria-label^='Remove image']");
  await expect(removeButtons).toHaveCount(2);

  const firstRemoveButton = removeButtons.first();
  await firstRemoveButton.hover();
  await firstRemoveButton.click();
  await expect(removeButtons).toHaveCount(1);

  const titleInput = page.locator("form input").first();
  await titleInput.fill(`e2e-scroll-${Date.now()}`);

  const questionTextarea = firstQuestionCard.locator("textarea").first();
  await questionTextarea.fill("E2E question prompt");

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });

  const createSubmitButton = page.locator("form button:not([type='button'])").first();
  await createSubmitButton.click();

  const confirmModal = page.locator("div.fixed.inset-0").last();
  await expect(confirmModal).toBeVisible();
  await confirmModal.locator("button").last().click();

  const errorBanner = page.locator("p.qa-card.text-sm.text-destructive").first();
  await expect(errorBanner).toBeVisible();

  await expect
    .poll(async () => page.evaluate(() => window.scrollY), {
      timeout: 5000,
    })
    .toBeLessThan(120);
});
