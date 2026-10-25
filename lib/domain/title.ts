import type { DraftBooking } from "./schemas";

/** Deterministic, non-sensitive thread/booking title (never model-generated). */
export function bookingTitle(b: Pick<DraftBooking, "originCity" | "destinationCity" | "destinationCountry" | "externalBookingId">): string {
  const to = b.destinationCity ?? b.destinationCountry;
  const route = b.originCity && to ? `${b.originCity} → ${to}` : b.originCity ? `From ${b.originCity}` : to ? `To ${to}` : null;
  if (b.externalBookingId) return route ? `${b.externalBookingId} · ${route}` : b.externalBookingId;
  return route ?? "New shipment";
}
