import { expect, test } from "@playwright/test";
import { DETAILS, OPENING, newChat, send } from "./helpers";

test("chats persist: create two, reopen by URL, continue, refresh, stay private", async ({ page, browser }) => {
  await page.goto("/chat");

  // Chat 1
  await send(page, OPENING);
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const firstUrl = page.url();
  const firstId = firstUrl.split("/").pop()!;
  await expect(page.getByTestId("transcript")).toContainText("What business is sending this?");
  await send(page, DETAILS);
  await send(page, "Seller is Northfield Goods.");
  await expect(page.getByTestId("headline")).toContainText("Ready to submit");
  await expect(page.getByTestId("carrier-cost")).toHaveText("£540");

  // Chat 2 (independent)
  await newChat(page);
  await expect(page.getByTestId("chat-empty")).toBeVisible();
  await send(page, "Sending 2 pallets of cotton t-shirts from London to a shop in Paris, as fast as possible.");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const secondId = page.url().split("/").pop()!;
  expect(secondId).not.toBe(firstId);

  // Reopen chat 1: full transcript and its own state
  await page.goto(firstUrl);
  await expect(page.getByTestId("transcript").locator('[data-role="user"]').first()).toHaveText(OPENING);
  await expect(page.getByTestId("transcript").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("booking-facts").locator('[data-field="pallets"]')).toHaveText("3");
  await expect(page.getByTestId("checklist")).toHaveAttribute("data-complete", "true");

  // Continue the earlier booking: +1 pallet recomputes cost; persisted revision shown
  await send(page, "Actually, add one more pallet.");
  await expect(page.getByTestId("transcript")).toContainText("pallets 3 → 4");
  await expect(page.getByTestId("carrier-cost")).toHaveText("£720");
  await expect(page.getByTestId("revision")).toHaveText("Saved · rev 4");

  // Chat 2 unchanged
  await page.goto(`/chat/${secondId}`);
  await expect(page.getByTestId("booking-facts").locator('[data-field="pallets"]')).toHaveText("2");

  // Refresh restores the selected chat from Neon
  await page.goto(firstUrl);
  await page.reload();
  await expect(page.getByTestId("transcript").locator("li")).toHaveCount(8);
  await expect(page.getByTestId("revision")).toHaveText("Saved · rev 4");

  // A different browser session sees nothing and can't open the URL
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(firstUrl);
  await expect(p2.getByTestId("chat-not-found")).toBeVisible();
  const api = await p2.request.get(`/api/chats/${firstId}/messages`);
  expect([401, 404]).toContain(api.status());
  await other.close();

  // All bookings: chat + Excel upload together
  await page.goto("/upload");
  await page.getByTestId("xlsx-input").setInputFiles("tests/fixtures/clean.xlsx");
  await expect(page).toHaveURL(/\/upload\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId("count-all")).toHaveText("3");
  await page.getByRole("link", { name: "All bookings" }).click();
  await expect(page.getByTestId("booking-row")).toHaveCount(5);
  await expect(page.locator('[data-testid="booking-row"][data-source="excel"]')).toHaveCount(3);
  await page.getByTestId("source-chat").click();
  await expect(page.getByTestId("booking-row")).toHaveCount(2);
});

test("sidebar: Dashboard, no chat shortcuts or history, New booking goes to the three options", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/dashboard$/);
  const rail = page.getByTestId("history-rail");
  await expect(rail.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Upload Excel" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "All bookings" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Chat to book" })).toHaveCount(0);
  await expect(rail).not.toContainText("Previous chats");
  await expect(page.getByTestId("chat-list")).toHaveCount(0);

  await rail.getByTestId("new-chat").click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByTestId("booking-methods").getByRole("button")).toHaveCount(3);
  await expect(page.getByTestId("method-excel")).toContainText("Upload Excel file");
  await expect(page.getByTestId("method-manual")).toContainText("Fill out details manually");
  await expect(page.getByTestId("method-chat")).toContainText("Chat");
});

test("collapsible rail on desktop and menu drawer on mobile", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("history-rail")).toBeVisible();
  await page.getByTestId("toggle-rail").click();
  await expect(page.getByTestId("history-rail").getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await page.getByTestId("toggle-rail").click();
  await expect(page.getByTestId("history-rail").getByRole("link", { name: "Dashboard" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("history-rail")).toBeHidden();
  await page.getByTestId("open-history").click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await expect(drawer.getByTestId("new-chat")).toBeVisible();
  await drawer.getByTestId("new-chat").click();
  await expect(page).toHaveURL(/\/new$/);
});
