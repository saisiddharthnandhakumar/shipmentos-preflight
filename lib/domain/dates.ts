/**
 * UK-local calendar helpers. All "today" comparisons use Europe/London, never the server's
 * timezone. Dates are ISO strings (YYYY-MM-DD); UI shows DD-MM-YYYY like the template.
 */
const ukFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayUK(now: Date = new Date()): string {
  return ukFormatter.format(now); // en-CA gives YYYY-MM-DD
}

export function isValidISODate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string | null {
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidISODate(s) ? s : null;
}

/** Strict template format DD-MM-YYYY (also accepts / or . separators). */
export function parseDDMMYYYY(text: string): string | null {
  const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$/.exec(text);
  if (!m) return null;
  return iso(Number(m[3]), Number(m[2]), Number(m[1]));
}

/** Excel date cell → ISO. ExcelJS returns JS Dates at UTC midnight for date cells. */
export function excelDateToISO(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  // Round to the nearest day to absorb Excel's floating time component.
  const rounded = new Date(Math.round(d.getTime() / 86_400_000) * 86_400_000);
  return iso(rounded.getUTCFullYear(), rounded.getUTCMonth() + 1, rounded.getUTCDate());
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}

export function formatUK(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function formatLong(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(dt);
}

export type ChatDateResult =
  | { ok: true; iso: string; note: "year_assumed" | "confirm_year" | null }
  | { ok: false; reason: string };

/** Window in which a year-less date that just passed is assumed to mean this year (and flagged). */
const RECENT_PAST_DAYS = 60;

/**
 * Parse the seller's own date wording deterministically (the AI only copies the text).
 * UK day-first order: "05/11" is 5 November.
 */
export function parseChatDate(raw: string, today: string): ChatDateResult {
  const text = raw.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  if (!text) return { ok: false, reason: "empty date" };
  if (text === "today") return { ok: true, iso: today, note: null };
  if (text === "tomorrow") return { ok: true, iso: addDays(today, 1), note: null };
  if (text === "yesterday") return { ok: true, iso: addDays(today, -1), note: null };

  // ISO
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) {
    const v = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    return v ? { ok: true, iso: v, note: null } : { ok: false, reason: "not a real calendar date" };
  }
  // DD-MM-YYYY / DD/MM/YY
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const v = iso(year, Number(m[2]), Number(m[1]));
    return v ? { ok: true, iso: v, note: null } : { ok: false, reason: "not a real calendar date" };
  }
  // DD/MM (no year)
  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return inferYear(Number(m[1]), Number(m[2]), today);

  // "5 nov [2026]" / "nov 5 [2026]" with optional weekday prefix
  const cleaned = text.replace(new RegExp(`^(on )?(${WEEKDAYS.join("|")}|mon|tue|wed|thu|fri|sat|sun) `), "").replace(/^the /, "").replace(/ of /, " ");
  m = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(cleaned) ?? null;
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  if (m && MONTHS[m[2]]) {
    day = Number(m[1]);
    month = MONTHS[m[2]];
    year = m[3] ? Number(m[3]) : null;
  } else {
    const m2 = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(cleaned);
    if (m2 && MONTHS[m2[1]]) {
      day = Number(m2[2]);
      month = MONTHS[m2[1]];
      year = m2[3] ? Number(m2[3]) : null;
    }
  }
  if (day && month) {
    if (year) {
      const v = iso(year, month, day);
      return v ? { ok: true, iso: v, note: null } : { ok: false, reason: "not a real calendar date" };
    }
    return inferYear(day, month, today);
  }

  // "next friday" / "friday"
  const wd = /^(next |this )?([a-z]+)$/.exec(text);
  if (wd && WEEKDAYS.includes(wd[2])) {
    const target = WEEKDAYS.indexOf(wd[2]);
    const [y, mo, d] = today.split("-").map(Number);
    const cur = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    let delta = (target - cur + 7) % 7;
    if (delta === 0) delta = 7;
    return { ok: true, iso: addDays(today, delta), note: null };
  }
  return { ok: false, reason: `couldn't read "${raw.trim()}" as a date` };
}

function inferYear(day: number, month: number, today: string): ChatDateResult {
  const thisYear = Number(today.slice(0, 4));
  const candidate = iso(thisYear, month, day);
  if (!candidate) {
    const next = iso(thisYear + 1, month, day); // e.g. 29 Feb
    return next ? { ok: true, iso: next, note: "year_assumed" } : { ok: false, reason: "not a real calendar date" };
  }
  if (candidate >= today) return { ok: true, iso: candidate, note: "year_assumed" };
  if (diffDays(today, candidate) <= RECENT_PAST_DAYS) return { ok: true, iso: candidate, note: "confirm_year" };
  const next = iso(thisYear + 1, month, day);
  return next ? { ok: true, iso: next, note: "year_assumed" } : { ok: false, reason: "not a real calendar date" };
}
