/**
 * Applies typed patch operations to the previous canonical draft. The result is a NEW draft;
 * untouched fields are preserved exactly. All value normalisation happens here (not in the AI).
 */
import { formatUK, parseChatDate } from "./dates";
import { formatGBP, formatNumber } from "./decimal";
import { BOOKING_FIELD_LABELS, ITEM_FIELD_LABELS } from "./missing";
import {
  CARRIER_OPTIONS,
  DESTINATION_CITIES,
  DESTINATION_COUNTRIES,
  ITEM_ORIGIN_COUNTRIES,
  ORIGIN_CITIES,
  SELLER_PRIORITIES,
  countryForDestinationCity,
  type DestinationCountry,
} from "./reference";
import { normalizeHsCode } from "./rules";
import {
  DraftBookingSchema,
  LIMITS,
  emptyItem,
  type BookingField,
  type DraftBooking,
  type DraftItem,
  type ItemChanges,
  type ItemField,
  type PatchOp,
} from "./schemas";

export type Change = { field: string; label: string; before: string; after: string; itemId?: string };
export type PatchResult = { draft: DraftBooking; changes: Change[]; warnings: string[] };
export type PatchContext = { todayUK: string; newId: () => string };

/** Short labels for the change log and replies (questions use the longer BOOKING_FIELD_LABELS). */
const CHANGE_LABEL: Record<string, string> = {
  sellerName: "seller", originCity: "from", destinationCity: "to", destinationCountry: "country", destinationType: "destination type",
  readyToShipDate: "ready date", sellerPriority: "priority", pallets: "pallets", cartons: "total cartons",
  totalDeclaredValueGBP: "declared value", totalGrossWeightKg: "gross weight", deliveryAppointmentBooked: "delivery appointment",
  selectedCarrierKey: "carrier", sku: "SKU", description: "description", hsCode: "HS code", quantityUnits: "quantity",
  unitPriceGBP: "unit price", unitsPerCarton: "units per carton", unitWeightKg: "unit weight", countryOfOrigin: "country of origin",
};

function show(field: string, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v === "") return "(blank)";
  if (field === "readyToShipDate" && typeof v === "string") return formatUK(v);
  if ((field === "totalDeclaredValueGBP" || field === "unitPriceGBP") && typeof v === "number") return formatGBP(v);
  if ((field === "totalGrossWeightKg" || field === "unitWeightKg") && typeof v === "number") return `${formatNumber(v, 4)} kg`;
  if (field === "deliveryAppointmentBooked" && typeof v === "boolean") return v ? "booked" : "not booked";
  if (field === "selectedCarrierKey" && typeof v === "string") return CARRIER_OPTIONS.find((o) => o.key === v)?.carrier ?? v;
  if (typeof v === "number") return formatNumber(v, 4);
  return String(v);
}

const display = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (v === "") return "(blank)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
};

function ciMatch<T extends string>(list: readonly T[], raw: string): T | null {
  const v = raw.trim().toLowerCase();
  return list.find((x) => x.toLowerCase() === v) ?? null;
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "United Kingdom", "u.k.": "United Kingdom", britain: "United Kingdom", "great britain": "United Kingdom",
  england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom", gb: "United Kingdom",
  prc: "China", "people's republic of china": "China", "viet nam": "Vietnam", turkiye: "Turkey", "türkiye": "Turkey",
  deutschland: "Germany", "the netherlands": "Netherlands", holland: "Netherlands", nl: "Netherlands", de: "Germany", fr: "France",
};

const CITY_ALIASES: Record<string, string> = { "frankfurt am main": "Frankfurt", "frankfurt/main": "Frankfurt" };

export function normalizeDestinationCountry(raw: string): DestinationCountry | null {
  const v = raw.trim().toLowerCase();
  const alias = COUNTRY_ALIASES[v];
  return ciMatch(DESTINATION_COUNTRIES, alias ?? raw);
}

export function normalizeItemCountry(raw: string): string {
  const v = raw.trim().replace(/^made in /i, "");
  if (!v) return "";
  const alias = COUNTRY_ALIASES[v.toLowerCase()];
  return ciMatch(ITEM_ORIGIN_COUNTRIES, alias ?? v) ?? v;
}

export function normalizeDestinationType(raw: string): DraftBooking["destinationType"] {
  const v = raw.trim().toLowerCase();
  if (/warehouse|fulfil+ment|distribution|\bdc\b|\bfc\b|amazon/.test(v)) return "Warehouse";
  if (/business|shop|store|office|retail|showroom|customer/.test(v)) return "Business address";
  return null;
}

export function normalizePriority(raw: string): DraftBooking["sellerPriority"] {
  const v = raw.trim().toLowerCase();
  const exact = ciMatch(SELLER_PRIORITIES, v);
  if (exact) return exact;
  if (/cheap|low(est)? cost|budget|economy|price/.test(v)) return "Cheapest";
  if (/fast|quick|urgent|express|soon/.test(v)) return "Fastest";
  if (/reliab|on[- ]time|depend/.test(v)) return "Most reliable";
  if (/balanc|trade[- ]?off|no (strong )?preference|either|best overall|mix/.test(v)) return "Balanced";
  return null;
}

export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[£,\s]|gbp|kgs?|kilos?|units?|pallets?|cartons?/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (["yes", "y", "true", "booked", "done"].includes(s)) return true;
  if (["no", "n", "false", "not booked", "none"].includes(s)) return false;
  return null;
}

function carrierKeyFor(raw: string, country: DestinationCountry | null): string | null | "invalid" {
  const v = raw.trim().toLowerCase();
  if (!v || ["auto", "none", "recommended", "any"].includes(v)) return null;
  const letter = /(?:carrier\s*)?\b([abc])\b/.exec(v)?.[1]?.toUpperCase();
  const byKey = CARRIER_OPTIONS.find((o) => o.key.toLowerCase() === v);
  if (byKey) return byKey.destinationCountry === country ? byKey.key : "invalid";
  if (!letter || !country) return "invalid";
  return CARRIER_OPTIONS.find((o) => o.destinationCountry === country && o.carrier === `Carrier ${letter}`)?.key ?? "invalid";
}

type Ok<T> = { ok: true; value: T } | { ok: false; warning: string };

function intField(v: unknown, label: string, min: number, max: number = LIMITS.maxCount): Ok<number> {
  const num = parseNumber(v);
  if (num === null) return { ok: false, warning: `I couldn't read "${display(v)}" as a number for ${label}.` };
  if (!Number.isInteger(num)) return { ok: false, warning: `${label} must be a whole number (got ${num}).` };
  if (num < min) return { ok: false, warning: `${label} must be at least ${min} (got ${num}).` };
  if (num > max) return { ok: false, warning: `${label} looks too large (${num}).` };
  return { ok: true, value: num };
}

function decField(v: unknown, label: string, max: number): Ok<number> {
  const num = parseNumber(v);
  if (num === null) return { ok: false, warning: `I couldn't read "${display(v)}" as a number for ${label}.` };
  if (num < 0) return { ok: false, warning: `${label} can't be negative (got ${num}).` };
  if (num > max) return { ok: false, warning: `${label} looks too large (${num}).` };
  return { ok: true, value: Math.round(num * 10_000) / 10_000 };
}

function normalizeItemValue(field: ItemField, v: unknown): Ok<DraftItem[ItemField]> {
  const label = ITEM_FIELD_LABELS[field];
  if (v === null || v === undefined) return { ok: true, value: null };
  switch (field) {
    case "sku":
    case "description": {
      const s = String(v).trim().slice(0, LIMITS.maxText);
      return s ? { ok: true, value: s } : { ok: true, value: null };
    }
    case "hsCode": {
      if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? { ok: true, value: String(v) } : { ok: false, warning: `HS code "${v}" isn't a valid code.` };
      const s = normalizeHsCode(String(v));
      return { ok: true, value: s.slice(0, 32) }; // "" = seller confirmed no HS code (R-01 will flag)
    }
    case "countryOfOrigin":
      return { ok: true, value: normalizeItemCountry(String(v)).slice(0, LIMITS.maxText) };
    case "quantityUnits":
    case "cartons":
      return intField(v, label, 0);
    case "unitsPerCarton":
      return intField(v, label, 1);
    case "unitPriceGBP":
      return decField(v, label, LIMITS.maxMoneyGBP);
    case "unitWeightKg":
      return decField(v, label, LIMITS.maxWeightKg);
  }
}

export function applyPatch(prev: DraftBooking, ops: PatchOp[], ctx: PatchContext): PatchResult {
  const draft: DraftBooking = structuredClone(prev);
  const changes: Change[] = [];
  const warnings: string[] = [];

  const setBooking = <K extends BookingField>(field: K, value: DraftBooking[K]) => {
    const before = draft[field];
    if (before === value) return;
    draft[field] = value;
    changes.push({ field, label: CHANGE_LABEL[field] ?? BOOKING_FIELD_LABELS[field], before: show(field, before), after: show(field, value) });
  };

  const setItem = (item: DraftItem, field: ItemField, value: DraftItem[ItemField]) => {
    const before = item[field];
    if (before === value) return;
    const name = field === "sku" ? (item.description ?? "item") : (item.sku ?? item.description ?? "item");
    (item as Record<ItemField, unknown>)[field] = value;
    changes.push({
      field: `item.${field}`,
      itemId: item.itemId,
      label: `${name} ${field === "cartons" ? "cartons" : (CHANGE_LABEL[field] ?? ITEM_FIELD_LABELS[field])}`,
      before: show(field, before),
      after: show(field, value),
    });
  };

  const findItem = (target: { itemId?: string | null; sku?: string | null }): DraftItem | null => {
    if (target.itemId) {
      const byId = draft.items.find((i) => i.itemId === target.itemId);
      if (byId) return byId;
    }
    if (target.sku) {
      const s = target.sku.trim().toLowerCase();
      const bySku = draft.items.filter((i) => i.sku?.toLowerCase() === s);
      if (bySku.length === 1) return bySku[0];
      if (bySku.length > 1) {
        warnings.push(`More than one line has SKU ${target.sku}; please say which one.`);
        return null;
      }
      // Description match as a fallback ("the mugs")
      const byDesc = draft.items.filter((i) => i.description && i.description.toLowerCase().includes(s));
      if (byDesc.length === 1) return byDesc[0];
    }
    // A single line whose SKU isn't known yet is unambiguous.
    if (draft.items.length === 1 && !draft.items[0].sku) return draft.items[0];
    warnings.push(`I couldn't find the item ${target.sku ?? target.itemId ?? ""} to change.`);
    return null;
  };

  const applyItemChanges = (item: DraftItem, ch: ItemChanges) => {
    for (const [k, v] of Object.entries(ch) as [ItemField, unknown][]) {
      if (v === undefined) continue;
      const r = normalizeItemValue(k, v);
      if (r.ok) setItem(item, k, r.value);
      else warnings.push(r.warning);
    }
  };

  const setDestinationCountry = (country: DestinationCountry) => {
    setBooking("destinationCountry", country);
    if (draft.destinationCity && !DESTINATION_CITIES[country].includes(draft.destinationCity)) {
      warnings.push(`${draft.destinationCity} isn't in ${country}, so I've cleared the city. Which city in ${country}: ${DESTINATION_CITIES[country].join(", ")}?`);
      setBooking("destinationCity", null);
    }
    if (draft.selectedCarrierKey && !CARRIER_OPTIONS.some((o) => o.key === draft.selectedCarrierKey && o.destinationCountry === country)) {
      setBooking("selectedCarrierKey", null);
    }
  };

  for (const op of ops) {
    switch (op.op) {
      case "set":
      case "remove": {
        const value = op.op === "remove" ? null : op.value;
        const f = op.field;
        if (value === null || value === "") {
          if (f === "destinationCountry") {
            setBooking("destinationCountry", null);
            setBooking("destinationCity", null);
          } else if (f === "readyToShipDate") {
            setBooking("readyToShipDate", null);
            draft.readyDateNote = null;
          } else setBooking(f, null as never);
          break;
        }
        switch (f) {
          case "sellerName":
            setBooking(f, String(value).trim().slice(0, LIMITS.maxText) || null);
            break;
          case "originCity": {
            const city = ciMatch(ORIGIN_CITIES, String(value));
            if (city) setBooking(f, city);
            else warnings.push(`We can collect from ${ORIGIN_CITIES.join(", ")} only — "${display(value)}" isn't one of them.`);
            break;
          }
          case "destinationCity": {
            const rawCity = String(value).trim();
            const aliased = CITY_ALIASES[rawCity.toLowerCase()] ?? rawCity;
            const all = DESTINATION_COUNTRIES.flatMap((c) => DESTINATION_CITIES[c]);
            const city = ciMatch(all, aliased);
            if (!city) {
              warnings.push(`We deliver to ${all.join(", ")} only — "${rawCity}" isn't one of them.`);
              break;
            }
            const country = countryForDestinationCity(city)!;
            if (draft.destinationCountry !== country) setDestinationCountry(country);
            setBooking("destinationCity", city);
            break;
          }
          case "destinationCountry": {
            const country = normalizeDestinationCountry(String(value));
            if (country) setDestinationCountry(country);
            else warnings.push(`We ship to Germany, France or the Netherlands only — "${display(value)}" isn't supported.`);
            break;
          }
          case "destinationType": {
            const t = normalizeDestinationType(String(value));
            if (t) setBooking(f, t);
            else warnings.push(`Is the destination a warehouse or a business address? ("${display(value)}" wasn't clear.)`);
            break;
          }
          case "readyToShipDate": {
            const r = parseChatDate(String(value), ctx.todayUK);
            if (r.ok) {
              setBooking("readyToShipDate", r.iso);
              draft.readyDateNote = r.note;
            } else warnings.push(`I couldn't use that ready date: ${r.reason}. Please give it as DD-MM-YYYY.`);
            break;
          }
          case "sellerPriority": {
            const p = normalizePriority(String(value));
            if (p) setBooking(f, p);
            else warnings.push(`Priority must be Cheapest, Fastest, Most reliable or Balanced.`);
            break;
          }
          case "pallets": {
            const r = intField(value, "Pallets", 1, LIMITS.maxPallets);
            if (r.ok) setBooking(f, r.value);
            else warnings.push(r.warning);
            break;
          }
          case "cartons": {
            const r = intField(value, "Total cartons", 0);
            if (r.ok) setBooking(f, r.value);
            else warnings.push(r.warning);
            break;
          }
          case "totalDeclaredValueGBP": {
            const r = decField(value, "Declared value", LIMITS.maxMoneyGBP);
            if (r.ok) setBooking(f, r.value);
            else warnings.push(r.warning);
            break;
          }
          case "totalGrossWeightKg": {
            const r = decField(value, "Gross weight", LIMITS.maxWeightKg);
            if (r.ok) setBooking(f, r.value);
            else warnings.push(r.warning);
            break;
          }
          case "deliveryAppointmentBooked": {
            const b = parseBool(value);
            if (b === null) warnings.push(`Is the delivery appointment booked — yes or no?`);
            else setBooking(f, b);
            break;
          }
          case "selectedCarrierKey": {
            const key = carrierKeyFor(String(value), draft.destinationCountry);
            if (key === "invalid") warnings.push(`I couldn't match "${display(value)}" to a carrier on this route (Carrier A, B or C).`);
            else setBooking(f, key);
            break;
          }
        }
        break;
      }
      case "increment": {
        const current = draft[op.field];
        if (current == null) {
          warnings.push(`I don't have a ${BOOKING_FIELD_LABELS[op.field]} yet, so I can't add to it — what's the total?`);
          break;
        }
        const next = Math.round((current + op.by) * 10_000) / 10_000;
        if (op.field === "pallets" || op.field === "cartons") {
          const r = intField(next, op.field === "pallets" ? "Pallets" : "Total cartons", op.field === "pallets" ? 1 : 0, op.field === "pallets" ? LIMITS.maxPallets : LIMITS.maxCount);
          if (r.ok) setBooking(op.field, r.value);
          else warnings.push(r.warning);
        } else {
          const r = decField(next, BOOKING_FIELD_LABELS[op.field], op.field === "totalDeclaredValueGBP" ? LIMITS.maxMoneyGBP : LIMITS.maxWeightKg);
          if (r.ok) setBooking(op.field, r.value);
          else warnings.push(r.warning);
        }
        break;
      }
      case "addItem": {
        if (draft.items.length >= LIMITS.maxItemsPerBooking) {
          warnings.push(`A booking can have at most ${LIMITS.maxItemsPerBooking} item lines.`);
          break;
        }
        if (op.item.sku && draft.items.some((i) => i.sku?.toLowerCase() === op.item.sku!.trim().toLowerCase())) {
          // Seller re-described an existing SKU: treat as an update instead of a duplicate line.
          applyItemChanges(draft.items.find((i) => i.sku?.toLowerCase() === op.item.sku!.trim().toLowerCase())!, op.item);
          break;
        }
        const item = emptyItem(ctx.newId());
        draft.items.push(item);
        changes.push({ field: "items", itemId: item.itemId, label: "new item", before: "—", after: `${op.item.sku ?? op.item.description ?? "product line"}` });
        applyItemChanges(item, op.item);
        break;
      }
      case "updateItem": {
        const item = findItem(op.target);
        if (item) applyItemChanges(item, op.changes);
        break;
      }
      case "incrementItem": {
        const item = findItem(op.target);
        if (!item) break;
        const current = item[op.field];
        if (current == null) {
          warnings.push(`I don't have ${ITEM_FIELD_LABELS[op.field]} for ${item.sku ?? "that item"} yet — what's the total?`);
          break;
        }
        const r = normalizeItemValue(op.field, current + op.by);
        if (r.ok) setItem(item, op.field, r.value);
        else warnings.push(r.warning);
        break;
      }
      case "removeItem": {
        const item = findItem(op.target);
        if (!item) break;
        draft.items = draft.items.filter((i) => i.itemId !== item.itemId);
        changes.push({ field: "items", itemId: item.itemId, label: "removed item", before: "—", after: item.sku ?? item.description ?? "item" });
        break;
      }
    }
  }

  // Final structural guard: the merged draft must still satisfy the canonical schema.
  const parsed = DraftBookingSchema.safeParse(draft);
  if (!parsed.success) {
    return { draft: prev, changes: [], warnings: [...warnings, "That change produced an invalid booking, so nothing was changed."] };
  }
  return { draft: parsed.data, changes, warnings };
}
