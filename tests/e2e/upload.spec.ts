import { expect, test } from "@playwright/test";

test("upload planted-error workbook without any chat; open a failed booking", async ({ page }) => {
  await page.goto("/upload");
  await page.getByTestId("xlsx-input").setInputFiles("tests/fixtures/planted-errors.xlsx");
  await expect(page).toHaveURL(/\/upload\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId("count-all")).toHaveText("12");
  await expect(page.getByTestId("count-Blocked")).toHaveText("7");
  await expect(page.getByTestId("count-Needs attention")).toHaveText("4");
  await expect(page.getByTestId("count-Ready to submit")).toHaveText("1");
  await expect(page.getByText("Row 3 is the template's unchanged example (BK-001")).toBeVisible();

  await page.getByTestId("upload-search").fill("BK-212");
  await expect(page.getByTestId("result-row")).toHaveCount(1);
  await page.getByRole("link", { name: "Open details for BK-212" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  const detail = page.getByTestId("booking-detail");
  await expect(detail).toContainText("2 to fix · 1 to check");
  await expect(detail.locator('[data-rule="R-01"]')).toContainText("SKU X-04: HS code 6912 has only 4 digits.");
  await expect(detail.locator('[data-rule="R-03"]')).toContainText("Update cartons to 90 or quantity to 960");
  await expect(detail.locator('[data-rule="R-09"]')).toContainText("missing its country of origin");
  await expect(detail.getByTestId("carrier-panel")).toContainText("tentative");

  // Status filter + reopen after refresh without re-uploading
  await page.goBack();
  await page.getByTestId("upload-search").fill("");
  await page.getByRole("button", { name: /Needs attention/ }).click();
  await expect(page.getByTestId("result-row")).toHaveCount(4);
  await page.reload();
  await expect(page.getByTestId("count-all")).toHaveText("12");
});

test("clicking a red spreadsheet issue opens the editor on the missing field, and saving clears it", async ({ page }) => {
  await page.goto("/upload");
  await page.getByTestId("xlsx-input").setInputFiles("tests/fixtures/sample-missing-fields.xlsx");
  await expect(page).toHaveURL(/\/upload\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.getByTestId("upload-search").fill("BK-402");
  await page.getByRole("link", { name: "Open details for BK-402" }).click();
  const detail = page.getByTestId("booking-detail");
  await detail.getByTestId("issue-card").filter({ hasText: "Seller name" }).click();
  const seller = page.locator('dialog input[name="sellerName"]');
  await expect(seller).toBeFocused();
  await seller.fill("Pennine Textiles");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(detail.getByTestId("issue-card")).toHaveCount(0);
});
