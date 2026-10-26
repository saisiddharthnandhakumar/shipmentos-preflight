import { expect, type Page } from "@playwright/test";

export async function send(page: Page, text: string) {
  const composer = page.getByTestId("composer");
  await expect(composer).toBeEnabled();
  await composer.fill(text);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("pending-message")).toHaveCount(0, { timeout: 60_000 });
}

export const OPENING = "I need 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready 5 Nov. Cheapest please.";
export const DETAILS =
  "Seller is Northfield Goods. SKU MUG-01, 1080 mugs, 12 units each, 90 cartons, £5 each, 0.5 kg each, HS 691200, made in United Kingdom. Gross weight 620 kg, declared £5400, 90 cartons in total. I have booked the appointment.";

/** New booking → Chat card: a fresh, independent chat. */
export async function newChat(page: Page) {
  await page.goto("/new");
  await page.getByTestId("method-chat").click();
  await expect(page).toHaveURL(/\/chat\?new=/);
}
