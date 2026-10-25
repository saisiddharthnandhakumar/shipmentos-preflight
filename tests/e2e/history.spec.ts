import { expect, test } from "@playwright/test";
import { DETAILS, OPENING, send } from "./helpers";

test("previous chats: create two, reopen, continue, refresh, isolate, delete", async ({ page, browser }) => {
  await page.goto("/chat");
  const list = page.getByTestId("chat-list");
  await expect(list).toContainText("No chats yet in this browser");

  // Chat 1
  await send(page, OPENING);
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const firstUrl = page.url();
  const firstId = firstUrl.split("/").pop()!;
  await expect(page.getByTestId("transcript")).toContainText("What business is sending this?");
  await expect(page.getByTestId("chat-item")).toHaveCount(1);
  await expect(page.getByTestId("chat-item").first()).toContainText("Manchester → Frankfurt");
  await send(page, DETAILS);
  await send(page, "Seller is Northfield Goods.");
  await expect(page.getByTestId("headline")).toContainText("Ready to submit");
  await expect(page.getByTestId("carrier-cost")).toHaveText("£540");

  // Chat 2 (independent)
  await page.getByTestId("new-chat").click();
  await expect(page).toHaveURL(/\/chat\?new=/);
  await expect(page.getByTestId("chat-empty")).toBeVisible();
  await send(page, "Sending 2 pallets of cotton t-shirts from London to a shop in Paris, as fast as possible.");
  await expect(page.getByTestId("chat-item")).toHaveCount(2);
  await expect(page.getByTestId("chat-item").first()).toContainText("London → Paris");
  const secondId = page.url().split("/").pop()!;
  expect(secondId).not.toBe(firstId);

  // Reopen chat 1 from the sidebar: full transcript and its own state
  await page.getByTestId("chat-item").filter({ hasText: "Manchester → Frankfurt" }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.getByTestId("transcript").locator('[data-role="user"]').first()).toHaveText(OPENING);
  await expect(page.getByTestId("transcript").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("booking-facts").locator('[data-field="pallets"]')).toHaveText("3");
  await expect(page.getByTestId("missing-fields")).toHaveCount(0);

  // Continue the earlier booking: +1 pallet recomputes cost; persisted revision shown
  await send(page, "Actually, add one more pallet.");
  await expect(page.getByTestId("transcript")).toContainText("pallets 3 → 4");
  await expect(page.getByTestId("carrier-cost")).toHaveText("£720");
  await expect(page.getByTestId("revision")).toHaveText("Saved · rev 4");
  await expect(page.getByTestId("chat-item").first()).toContainText("Manchester → Frankfurt");

  // Chat 2 unchanged
  await page.getByTestId("chat-item").filter({ hasText: "London → Paris" }).click();
  await expect(page.getByTestId("booking-facts").locator('[data-field="pallets"]')).toHaveText("2");

  // Refresh restores the selected chat from Neon
  await page.goto(firstUrl);
  await page.reload();
  await expect(page.getByTestId("transcript").locator("li")).toHaveCount(8);
  await expect(page.getByTestId("revision")).toHaveText("Saved · rev 4");
  await expect(page.locator('[data-testid="chat-item"][aria-current="page"]')).toContainText("Manchester → Frankfurt");

  // A different browser session sees nothing and can't open the URL
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(firstUrl);
  await expect(p2.getByTestId("chat-not-found")).toBeVisible();
  await expect(p2.getByTestId("chat-list")).toContainText("No chats yet");
  const api = await p2.request.get(`/api/chats/${firstId}/messages`);
  expect([401, 404]).toContain(api.status());
  await other.close();

  // Delete chat 2: cancel keeps it, confirm removes only it
  const second = page.getByTestId("chat-item").filter({ hasText: "London → Paris" });
  await page.locator("li").filter({ has: second }).getByTestId("delete-chat").click({ force: true });
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("chat-item")).toHaveCount(2);
  await page.locator("li").filter({ has: second }).getByTestId("delete-chat").click({ force: true });
  await page.getByRole("dialog").getByRole("button", { name: "Delete conversation" }).click();
  await expect(page.getByTestId("chat-item")).toHaveCount(1);
  await expect(page.getByTestId("chat-item").first()).toContainText("Manchester → Frankfurt");
  expect((await page.request.get(`/api/bookings/${secondId}`)).status()).toBe(404);

  // All bookings: chat + Excel upload together; Previous chats stays chat-only
  await page.goto("/upload");
  await page.getByTestId("xlsx-input").setInputFiles("tests/fixtures/clean.xlsx");
  await expect(page).toHaveURL(/\/upload\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId("count-all")).toHaveText("3");
  await page.getByRole("link", { name: "All bookings" }).click();
  await expect(page.getByTestId("booking-row")).toHaveCount(4);
  await expect(page.locator('[data-testid="booking-row"][data-source="excel"]')).toHaveCount(3);
  await expect(page.getByTestId("chat-item")).toHaveCount(1);
  await page.getByTestId("source-chat").click();
  await expect(page.getByTestId("booking-row")).toHaveCount(1);
});

test("collapsible rail on desktop and history drawer on mobile", async ({ page }) => {
  await page.goto("/chat");
  await send(page, OPENING);
  await expect(page.getByTestId("history-rail")).toBeVisible();
  await page.getByTestId("toggle-rail").click();
  await expect(page.getByTestId("chat-list")).toHaveCount(0);
  await page.getByTestId("toggle-rail").click();
  await expect(page.getByTestId("chat-list")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat");
  await expect(page.getByTestId("history-rail")).toBeHidden();
  await page.getByTestId("open-history").click();
  const drawer = page.getByRole("dialog", { name: "Chat history" });
  await expect(drawer.getByTestId("chat-item")).toHaveCount(1);
  await drawer.getByTestId("chat-item").first().press("Enter");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("transcript")).toContainText(OPENING);
  await page.getByTestId("tab-booking").click();
  await expect(page.getByTestId("booking-panel")).toBeVisible();
  await expect(page.getByTestId("booking-facts").locator('[data-field="pallets"]')).toHaveText("3");
});
