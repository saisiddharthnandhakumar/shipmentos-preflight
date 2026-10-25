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
  await page.getByRole("button", { name: "Open details for BK-212" }).click();
  const detail = page.getByTestId("booking-detail");
  await expect(detail).toContainText("Blocked — 2 Red, 1 Amber");
  await expect(detail.locator('[data-rule="R-01"]')).toContainText("SKU X-04: HS code 6912 has only 4 digits.");
  await expect(detail.locator('[data-rule="R-03"]')).toContainText("Update cartons to 90 or quantity to 960");
  await expect(detail.locator('[data-rule="R-09"]')).toContainText("missing its country of origin");
  await expect(detail.getByTestId("carrier-panel")).toContainText("tentative");

  // Status filter + reopen after refresh without re-uploading
  await page.getByRole("button", { name: "Close booking details" }).click();
  await page.getByTestId("upload-search").fill("");
  await page.getByRole("button", { name: /Needs attention/ }).click();
  await expect(page.getByTestId("result-row")).toHaveCount(4);
  await page.reload();
  await expect(page.getByTestId("count-all")).toHaveText("12");
});
