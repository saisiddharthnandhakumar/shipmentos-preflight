import { expect, test, type Page } from "@playwright/test";
import { newChat, OPENING, send } from "./helpers";

async function uploadPlanted(page: Page) {
  await page.goto("/upload");
  await page.getByTestId("xlsx-input").setInputFiles("tests/fixtures/planted-errors.xlsx");
  await expect(page).toHaveURL(/\/upload\/[0-9a-f-]{36}$/, { timeout: 60_000 });
}

test("All bookings: four tabs with counts, four columns, Open and Delete on every row", async ({ page }) => {
  await uploadPlanted(page);
  await page.goto("/bookings");
  const tabs = page.getByTestId("booking-tabs").getByRole("tab");
  await expect(tabs).toHaveText([/^All\s*12$/, /^Completed\s*0$/, /^Sync to ERP\s*5$/, /^Drafts\s*7$/]);
  await expect(page.getByTestId("source-chat")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Status" })).toHaveCount(0);
  await expect(page.getByTestId("bookings-table").locator("thead th")).toHaveText(["Booking ID", "Route", "Status", "Updated", "Actions"]);

  await page.getByTestId("tab-draft").click();
  await expect(page).toHaveURL(/tab=draft/);
  await expect(page.getByTestId("booking-row")).toHaveCount(7);
  await expect(page.locator('[data-testid="booking-row"]:not([data-stage="draft"])')).toHaveCount(0);
  await expect(page.getByTestId("open-booking")).toHaveCount(7);
  await expect(page.getByTestId("delete-booking")).toHaveCount(7);

  await page.getByTestId("tab-sync").click();
  await expect(page.getByTestId("booking-row")).toHaveCount(5);
  await page.getByTestId("tab-completed").click();
  await expect(page.getByText("No bookings match these filters")).toBeVisible();

  // Delete asks first; cancel keeps it, confirm removes only that one and updates every count.
  await page.getByTestId("tab-draft").click();
  await page.getByTestId("delete-booking").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("booking-row")).toHaveCount(7);
  await page.getByTestId("delete-booking").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete booking" }).click();
  await expect(page.getByTestId("booking-row")).toHaveCount(6);
  await expect(page.getByTestId("tab-count-draft")).toHaveText("6");
  await expect(page.getByTestId("tab-count-all")).toHaveText("11");

  // Excel rows have no chat, so Open shows their detail page.
  await page.getByTestId("open-booking").first().click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
});

test("All bookings: date filter opens a calendar for a day or a range", async ({ page }) => {
  await uploadPlanted(page);
  await page.goto("/bookings");
  await expect(page.getByTestId("date-filter-value")).toHaveText("Any date");
  await page.getByTestId("date-filter").click();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByTestId("booking-row")).toHaveCount(12);

  // One click is one day, a second click stretches it into a range.
  await page.getByTestId("date-filter").click();
  await page.locator('[data-date$="-01"]').first().click();
  await expect(page.getByTestId("date-filter-value")).not.toContainText("–");
  await page.locator('[data-date$="-03"]').first().click();
  await expect(page.getByTestId("date-filter-value")).toContainText("–");
  await expect(page.getByTestId("date-filter-value")).toContainText(/1 \w{3}.*3 \w{3}/);
  await page.getByTestId("date-filter").click();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("date-filter-value")).toHaveText("Any date");
  await expect(page.getByTestId("booking-row")).toHaveCount(12);
});

test("Dashboard shows All / Completed / Sync to ERP / Drafts, drafts needing attention, a date filter, and no header buttons", async ({ page }) => {
  await uploadPlanted(page);
  await page.goto("/dashboard");
  const stats = page.getByTestId("dashboard-stats");
  await expect(stats.getByRole("link", { name: /^All/ })).toContainText("12");
  await expect(stats.getByRole("link", { name: /^Completed/ })).toContainText("0");
  await expect(stats.getByRole("link", { name: /^Sync to ERP/ })).toContainText("5");
  await expect(stats.getByRole("link", { name: /^Drafts/ })).toContainText("7");
  await expect(stats).not.toContainText("Needs attention");

  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "New booking" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Master Data" })).toHaveCount(0);

  // Everything under "Needs your attention" is a draft.
  const rows = page.getByTestId("attention-row");
  await expect(rows).toHaveCount(7);
  await expect(page.locator('[data-testid="attention-row"] [data-stage="draft"]')).toHaveCount(7);

  // A date range with nothing in it zeroes the cards and says why.
  await page.getByTestId("date-filter").click();
  await page.locator('[data-date$="-01"]').first().click();
  await page.locator('[data-date$="-01"]').first().click();
  await expect(page.getByText("No bookings were updated in this date range")).toBeVisible();
  await expect(stats.getByRole("link", { name: /^All/ })).toContainText("0");
  await page.getByTestId("date-filter").click();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(stats.getByRole("link", { name: /^All/ })).toContainText("12");
  await stats.getByRole("link", { name: /^Drafts/ }).click();
  await expect(page).toHaveURL(/\/bookings\?tab=draft&from=/);
  await expect(page.getByTestId("booking-row")).toHaveCount(7);
});

test("chat: rename the booking, Save as draft, and find it in Drafts under that name; Open returns to the chat", async ({ page }) => {
  await newChat(page);
  await send(page, OPENING);
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const chatUrl = page.url();
  await expect(page.getByTestId("booking-name-value")).toHaveText(/^SOS-[0-9A-F]{8}$/);

  await page.getByTestId("rename-booking").click();
  await page.getByTestId("booking-name-input").fill("Q4 mug order");
  await page.getByTestId("save-name").click();
  await expect(page.getByTestId("booking-name-value")).toHaveText("Q4 mug order");
  await page.reload();
  await expect(page.getByTestId("booking-name-value")).toHaveText("Q4 mug order");
  await expect(page.getByTestId("revision")).toContainText("rev 1"); // renaming is not a new revision

  await page.getByTestId("save-draft").click();
  await expect(page).toHaveURL(/\/bookings\?tab=draft&saved=/);
  await expect(page.getByTestId("saved-notice")).toContainText("Q4 mug order");
  await expect(page.getByTestId("saved-notice")).toContainText("Drafts");
  await expect(page.getByTestId("booking-id").filter({ hasText: "Q4 mug order" })).toBeVisible();

  await page.getByTestId("open-booking").first().click();
  await expect(page).toHaveURL(chatUrl);
  await expect(page.getByTestId("booking-name-value")).toHaveText("Q4 mug order");
});
