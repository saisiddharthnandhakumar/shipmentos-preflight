/** Human-friendly draft reference derived from the booking id (mirrors server `draftReference`). */
export function draftReferenceOf(bookingId: string): string {
  return `SOS-${bookingId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
