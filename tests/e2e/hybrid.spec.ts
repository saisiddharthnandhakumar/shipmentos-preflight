import { expect, test } from "@playwright/test";
import { newChat } from "./helpers";

test("New booking offers three ways; Chat opens the chatbot with its greeting and creates nothing until you send", async ({ page }) => {
  await page.goto("/new");
  await expect(page.getByTestId("booking-methods").getByRole("button")).toHaveCount(3);
  await page.getByTestId("method-chat").click();
  await expect(page.getByTestId("transcript")).toContainText("Tell me where it's going");
  await expect(page.getByTestId("composer")).toBeFocused();
  await expect(page.getByTestId("send")).toBeDisabled();
  await expect(page.getByTestId("get-started")).toHaveCount(0);
  expect((await (await page.request.get("/api/chats")).json()).items).toHaveLength(0);

  // An example drops into the box for review; the greeting stays above the conversation after sending.
  await page.getByTestId("chat-empty").getByRole("button").first().click();
  await expect(page.getByTestId("composer")).toHaveValue(/3 pallets of ceramic mugs/);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("pending-message")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId("transcript")).toContainText("Tell me where it's going");
  await expect(page.getByTestId("chat-empty")).toHaveCount(0);
  expect((await (await page.request.get("/api/chats")).json()).items).toHaveLength(1);
});

test("Upload Excel card: pick a file, land in chat, extraction message then a summary of what's there and missing", async ({ page }) => {
  await page.goto("/new");
  await page.getByTestId("method-excel-input").setInputFiles("tests/fixtures/single-incomplete.xlsx");
  await expect(page).toHaveURL(/\/chat(\/[0-9a-f-]{36})?(\?new=.*)?$/);
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toContainText("I've read single-incomplete.xlsx", { timeout: 60_000 });
  await expect(transcript).toContainText("Uploaded single-incomplete.xlsx");
  await expect(transcript).toContainText("Found:");
  await expect(transcript).toContainText("Manchester → Frankfurt (Warehouse)");
  await expect(transcript).toContainText("Still missing:");
  await expect(transcript).toContainText("What business is sending this?");
  await expect(transcript).not.toContainText("Tell me where it's going");
  await expect(page.getByTestId("booking-facts").locator('[data-field="pallets"]')).toHaveText("3");

  // Uploading again from inside the chat asks first; cancel keeps everything, continue replaces it.
  await page.getByTestId("attach-input").setInputFiles("tests/fixtures/single-incomplete.xlsx");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Replace the uploaded file?");
  await expect(dialog).toContainText("There's already a file in this chat");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(transcript.getByText("Uploaded single-incomplete.xlsx")).toHaveCount(1);
  await page.getByTestId("attach-input").setInputFiles("tests/fixtures/single-incomplete.xlsx");
  await dialog.getByRole("button", { name: "Continue and replace" }).click();
  await expect(transcript).toContainText("The earlier details in this chat were replaced.", { timeout: 60_000 });
});

test("Upload Excel card with several bookings goes to the upload results", async ({ page }) => {
  await page.goto("/new");
  await page.getByTestId("method-excel-input").setInputFiles("tests/fixtures/clean.xlsx");
  await expect(page).toHaveURL(/\/upload\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId("count-all")).toHaveText("3");
});

test("Upload Excel card rejects a non-xlsx file before leaving the page", async ({ page }) => {
  await page.goto("/new");
  await page.getByTestId("method-excel-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("isn't an .xlsx file")).toBeVisible();
  await expect(page).toHaveURL(/\/new$/);
});

test("Fill out details manually: the form is on the page itself, saves, and opens the booking", async ({ page }) => {
  await page.goto("/new");
  await page.getByTestId("method-manual").click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByTestId("manual-form")).toBeVisible();
  await page.getByTestId("manual-save").click();
  await expect(page.getByText("Fill in at least one detail first.")).toBeVisible();
  await page.locator('input[name="sellerName"]').fill("Northfield Goods");
  await page.locator('input[name="pallets"]').fill("3");
  await page.locator('select[name="originCity"]').selectOption("Manchester");
  await page.getByTestId("manual-save").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId("booking-facts").locator('[data-field="pallets"]')).toHaveText("3");
  await expect(page.getByTestId("transcript")).toContainText("Edited directly");
});

test("chat has an upload button too", async ({ page }) => {
  await newChat(page);
  await expect(page.getByTestId("attach-file")).toBeVisible();
  await page.getByTestId("attach-input").setInputFiles("tests/fixtures/single-incomplete.xlsx");
  await expect(page.getByTestId("transcript")).toContainText("I've read single-incomplete.xlsx", { timeout: 60_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("voice: record, transcribe, and the words land in the message box for review", async ({ page }) => {
  await newChat(page);
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

test("checklist and tap-to-answer: options for each question, ticks as you go, no typing needed", async ({ page }) => {
  await newChat(page);
  const checklist = page.getByTestId("checklist");
  await expect(checklist).toHaveAttribute("data-done", "0");
  await expect(checklist.locator("li[data-key]").first()).toContainText("Collection city");
  await expect(checklist.locator('li[data-key="originCity"]')).toContainText("Next");

  // Route: three questions, answered by tapping.
  const quick = page.getByTestId("quick-replies");
  await expect(quick.locator('[data-choice-group="originCity"] [data-choice]')).toHaveCount(4);
  await expect(quick.locator('[data-choice-group="destinationCity"] [data-choice]')).toHaveCount(7);
  await quick.getByRole("button", { name: "Manchester" }).click();
  await expect(page.getByTestId("transcript")).toContainText("Collecting from Manchester");
  await expect(checklist.locator('li[data-key="originCity"]')).toHaveAttribute("data-done", "true");
  await expect(quick.locator('[data-choice-group="originCity"]')).toHaveCount(0);

  await quick.getByRole("button", { name: /Frankfurt/ }).click();
  await expect(checklist.locator('li[data-key="destinationCity"]')).toHaveAttribute("data-done", "true");
  // Destination known: only that country's cities were ever offered next time, and the type question remains.
  await quick.getByRole("button", { name: "Warehouse" }).click();
  await expect(checklist.locator('li[data-key="destinationType"]')).toHaveAttribute("data-done", "true");
  await expect(checklist.locator('li[data-key="deliveryAppointmentBooked"]')).toHaveAttribute("data-done", "false");

  // Next: date and priority come as options; seller name is free text so it has none.
  await expect(quick.locator('[data-choice-group="readyToShipDate"] [data-choice]')).toHaveCount(4);
  await quick.getByRole("button", { name: "Fastest" }).click();
  await expect(checklist.locator('li[data-key="sellerPriority"]')).toHaveAttribute("data-done", "true");
  await quick.getByRole("button", { name: /In a week/ }).click();
  await expect(checklist.locator('li[data-key="readyToShipDate"]')).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("checklist-count")).toContainText("5 of");
  await expect(page.getByTestId("composer")).toBeEnabled();
});
