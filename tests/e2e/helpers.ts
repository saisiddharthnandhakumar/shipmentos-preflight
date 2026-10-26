import { expect, type Page } from "@playwright/test";

export async function send(page: Page, text: string) {
  const composer = page.getByTestId("composer");
  const start = page.getByTestId("get-started");
  // A brand-new chat opens on "Get started"; the message box appears once it's pressed.
  await expect(start.or(composer)).toBeVisible();
  if (await start.isVisible()) await start.click();
  await expect(composer).toBeEnabled();
  await composer.fill(text);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("pending-message")).toHaveCount(0, { timeout: 60_000 });
}

export const OPENING = "I need 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready 5 Nov. Cheapest please.";
export const DETAILS =
  "Seller is Northfield Goods. SKU MUG-01, 1080 mugs, 12 units each, 90 cartons, £5 each, 0.5 kg each, HS 691200, made in United Kingdom. Gross weight 620 kg, declared £5400, 90 cartons in total. I have booked the appointment.";
