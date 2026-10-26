import { expect, test } from "@playwright/test";

test("a new chat opens on Get started, greets first, and creates nothing until you send", async ({ page }) => {
  await page.goto("/chat");
  await expect(page.getByTestId("get-started")).toBeVisible();
  await expect(page.getByTestId("composer")).toHaveCount(0);
  await expect(page.getByTestId("send")).toHaveCount(0);

  await page.getByTestId("get-started").click();
  await expect(page.getByTestId("transcript")).toContainText("Tell me where it's going");
  await expect(page.getByTestId("composer")).toBeFocused();
  await expect(page.getByTestId("send")).toBeDisabled();
  await expect(page.getByTestId("get-started")).toHaveCount(0);
  await expect(page.getByTestId("chat-list")).toContainText("No chats yet in this browser");

  // An example drops into the box for review; the greeting stays above the conversation after sending.
  await page.getByTestId("examples").getByRole("button").first().click();
  await expect(page.getByTestId("composer")).toHaveValue(/3 pallets of ceramic mugs/);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("pending-message")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId("transcript")).toContainText("Tell me where it's going");
  await expect(page.getByTestId("examples")).toHaveCount(0);
  await expect(page.getByTestId("chat-item")).toHaveCount(1);
});

test("voice: record, transcribe, and the words land in the message box for review", async ({ page }) => {
  await page.goto("/chat");
  await page.getByTestId("get-started").click();
  const mic = page.getByTestId("voice-button");
  await mic.click();
  await expect(page.getByTestId("voice-status")).toContainText("Listening");
  await page.waitForTimeout(1500);
  await mic.click();
  await expect(page.getByTestId("composer")).toHaveValue(/3 pallets of ceramic mugs from Manchester/);
  await expect(page.getByTestId("send")).toBeEnabled();
});

test("upload results: ask in words, rows narrow, chips remove, status updates", async ({ page }) => {
  await page.goto("/upload");
  await page.getByTestId("xlsx-input").setInputFiles("tests/fixtures/planted-errors.xlsx");
  await expect(page).toHaveURL(/\/upload\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId("result-row")).toHaveCount(12);
  await expect(page.getByTestId("ask-status")).toHaveText("Showing all 12 bookings.");

  await page.getByTestId("ask-input").fill("give me rows 1 to 7");
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("result-row")).toHaveCount(7);
  await expect(page.getByTestId("ask-status")).toHaveText("Showing 7 of 12 bookings.");
  await expect(page.getByRole("button", { name: "Remove filter: Rows 1–7" })).toBeVisible();

  // Refine in words, then drop one filter by hand.
  await page.getByTestId("ask-input").fill("only blocked");
  await page.getByTestId("ask-submit").click();
  await expect(page.getByRole("button", { name: "Remove filter: Blocked" })).toBeVisible();
  await page.getByRole("button", { name: "Remove filter: Rows 1–7" }).click();
  await expect(page.getByTestId("result-row")).toHaveCount(7);
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("result-row")).toHaveCount(12);
  await expect(page.getByTestId("ask-status")).toHaveText("Showing all 12 bookings.");

  // Voice works here too.
  await page.getByTestId("voice-button").click();
  await page.waitForTimeout(1500);
  await page.getByTestId("voice-button").click();
  await expect(page.getByTestId("ask-input")).toHaveValue(/pallets of ceramic mugs/);
});
