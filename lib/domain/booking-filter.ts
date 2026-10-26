/**
 * The filter an upload-results chat message turns into. Gemini only fills this shape in from the
 * seller's words; applying it, counting rows and describing it are fixed rules below.
 */
import { z } from "zod";
import { DESTINATION_COUNTRIES } from "./reference";

const STATUSES = ["Draft", "Blocked", "Needs attention", "Ready to submit"] as const;
const text = z.string().trim().min(1).max(80);

export const BookingFilterSchema = z.object({
  destinationCountries: z.array(z.enum(DESTINATION_COUNTRIES)).max(3).optional(),
  originCities: z.array(text).max(10).optional(),
  destinationCities: z.array(text).max(10).optional(),
  statuses: z.array(z.enum(STATUSES)).max(4).optional(),
  sellers: z.array(text).max(10).optional(),
  inputIssuesOnly: z.boolean().optional(),
  /** 1-based positions in the results table. */
  rowFrom: z.number().int().min(1).max(100_000).optional(),
  rowTo: z.number().int().min(1).max(100_000).optional(),
});
export type BookingFilter = z.infer<typeof BookingFilterSchema>;

export type FilterableBooking = {
  status: string;
  sellerName: string | null;
  originCity: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
};

/** Drop empty lists, false flags and inverted ranges so "no filter" is always `{}`. */
export function normaliseFilter(f: BookingFilter): BookingFilter {
  const out: BookingFilter = {};
  if (f.destinationCountries?.length) out.destinationCountries = [...new Set(f.destinationCountries)];
  if (f.originCities?.length) out.originCities = [...new Set(f.originCities)];
  if (f.destinationCities?.length) out.destinationCities = [...new Set(f.destinationCities)];
  if (f.statuses?.length) out.statuses = [...new Set(f.statuses)];
  if (f.sellers?.length) out.sellers = [...new Set(f.sellers)];
  if (f.inputIssuesOnly) out.inputIssuesOnly = true;
  let { rowFrom, rowTo } = f;
  if (rowFrom && rowTo && rowFrom > rowTo) [rowFrom, rowTo] = [rowTo, rowFrom];
  if (rowFrom) out.rowFrom = rowFrom;
  if (rowTo) out.rowTo = rowTo;
  return out;
}

export function isEmptyFilter(f: BookingFilter): boolean {
  return Object.keys(normaliseFilter(f)).length === 0;
}

const same = (a: string | null, b: string) => a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
const has = (list: string[] | undefined, v: string | null) => !list?.length || list.some((x) => same(v, x));

export function matchesFilter(b: FilterableBooking, row: number, hasInputIssue: boolean, f: BookingFilter): boolean {
  if (f.rowFrom && row < f.rowFrom) return false;
  if (f.rowTo && row > f.rowTo) return false;
  if (f.statuses?.length && !f.statuses.includes(b.status as (typeof STATUSES)[number])) return false;
  if (f.inputIssuesOnly && !hasInputIssue) return false;
  return has(f.destinationCountries, b.destinationCountry) && has(f.originCities, b.originCity) && has(f.destinationCities, b.destinationCity) && has(f.sellers, b.sellerName);
}

export type FilterChip = { key: string; label: string; remove: (f: BookingFilter) => BookingFilter };

/** One removable chip per active criterion, in reading order. */
export function filterChips(f: BookingFilter): FilterChip[] {
  const chips: FilterChip[] = [];
  const list = (key: "destinationCountries" | "originCities" | "destinationCities" | "statuses" | "sellers", prefix: string) => {
    for (const v of f[key] ?? []) chips.push({ key: `${key}:${v}`, label: `${prefix}${v}`, remove: (cur) => normaliseFilter({ ...cur, [key]: (cur[key] as string[] | undefined)?.filter((x) => x !== v) }) });
  };
  if (f.rowFrom || f.rowTo) {
    const label = f.rowFrom && f.rowTo ? (f.rowFrom === f.rowTo ? `Row ${f.rowFrom}` : `Rows ${f.rowFrom}–${f.rowTo}`) : f.rowFrom ? `Row ${f.rowFrom} onwards` : `Up to row ${f.rowTo}`;
    chips.push({ key: "rows", label, remove: (cur) => normaliseFilter({ ...cur, rowFrom: undefined, rowTo: undefined }) });
  }
  list("originCities", "From ");
  list("destinationCountries", "To ");
  list("destinationCities", "To ");
  list("statuses", "");
  list("sellers", "Seller ");
  if (f.inputIssuesOnly) chips.push({ key: "issues", label: "With input issues", remove: (cur) => normaliseFilter({ ...cur, inputIssuesOnly: undefined }) });
  return chips;
}

/** The one-line status that sits under the chat box. Counts come from the data, never the model. */
export function filterSummary(shown: number, total: number, f: BookingFilter): string {
  if (isEmptyFilter(f)) return `Showing all ${total} booking${total === 1 ? "" : "s"}.`;
  if (shown === 0) return `No bookings match (0 of ${total}). Remove a filter below or ask for something broader.`;
  return `Showing ${shown} of ${total} booking${total === 1 ? "" : "s"}.`;
}
