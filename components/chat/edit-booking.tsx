"use client";

import { useEffect, useRef, useState } from "react";
import { DESTINATION_CITIES, DESTINATION_COUNTRIES, DESTINATION_TYPES, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, SELLER_PRIORITIES } from "@/lib/domain/reference";
import type { DraftBooking, PatchOp } from "@/lib/client/types";
import { HsHint } from "../booking/hs-hint";
import { Button, Notice } from "../ui";

export type ItemForm = { itemId: string | null; sku: string; description: string; hsCode: string; quantityUnits: string; unitPriceGBP: string; unitsPerCarton: string; cartons: string; unitWeightKg: string; countryOfOrigin: string; removed?: boolean };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const ITEM_KEYS = ["sku", "description", "hsCode", "quantityUnits", "unitPriceGBP", "unitsPerCarton", "cartons", "unitWeightKg", "countryOfOrigin"] as const;
const NUMERIC = new Set(["quantityUnits", "unitPriceGBP", "unitsPerCarton", "cartons", "unitWeightKg", "pallets", "totalDeclaredValueGBP", "totalGrossWeightKg"]);

function toValue(key: string, v: string): string | number | null {
  const t = v.trim();
  if (!t) return null;
  if (NUMERIC.has(key)) return Number.isFinite(Number(t)) ? Number(t) : t;
  return t;
}

function humanise(field: string): string {
  const t = field.replace(/([A-Z])/g, " $1").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function summarise(ops: PatchOp[]): string[] {
  return ops.map((o) => {
    if (o.op === "set") return `${humanise(o.field)} → ${typeof o.value === "boolean" ? (o.value ? "Yes" : "No") : String(o.value)}`;
    if (o.op === "remove") return `${humanise(o.field)} cleared`;
    if (o.op === "addItem") return "Item line added";
    if (o.op === "removeItem") return "Item line removed";
    return "Item line updated";
  });
}

export type FormValues = Record<string, string>;

const FIELD_KEYS = ["sellerName", "originCity", "destinationCity", "destinationType", "readyToShipDate", "sellerPriority", "pallets", "cartons", "totalDeclaredValueGBP", "totalGrossWeightKg"] as const;

/** Form text for each field of a draft ("" = unknown). */
export function formFromDraft(draft: DraftBooking): { b: FormValues; items: ItemForm[] } {
  const b: FormValues = Object.fromEntries(FIELD_KEYS.map((k) => [k, s(draft[k])]));
  b.deliveryAppointmentBooked = draft.deliveryAppointmentBooked == null ? "" : draft.deliveryAppointmentBooked ? "yes" : "no";
  return { b, items: draft.items.map((i) => ({ itemId: i.itemId, ...Object.fromEntries(ITEM_KEYS.map((k) => [k, s(i[k])])) }) as ItemForm) };
}

/** The typed patch operations that turn `draft` into what the form now says. */
export function buildOps(draft: DraftBooking, b: FormValues, items: ItemForm[]): PatchOp[] {
  const ops: PatchOp[] = [];
  const cur = formFromDraft(draft).b;
  for (const [k, v] of Object.entries(b)) {
    if (v === cur[k]) continue;
    const field = k as Extract<PatchOp, { op: "set" }>["field"];
    if (!v.trim()) ops.push({ op: "remove", field });
    else if (k === "deliveryAppointmentBooked") ops.push({ op: "set", field, value: v === "yes" });
    else ops.push({ op: "set", field, value: toValue(k, v) });
  }
  for (const it of items) {
    const orig = it.itemId ? draft.items.find((x) => x.itemId === it.itemId) : null;
    if (it.removed && it.itemId) {
      ops.push({ op: "removeItem", target: { itemId: it.itemId } });
      continue;
    }
    if (it.removed) continue;
    const changes: Record<string, string | number | null> = {};
    for (const k of ITEM_KEYS) {
      const before = orig ? s(orig[k]) : "";
      if (it[k] !== before || (!orig && it[k])) {
        // Blank HS code / origin means "seller confirms blank" so the rules can flag it.
        changes[k] = (k === "hsCode" || k === "countryOfOrigin") && !it[k].trim() ? "" : toValue(k, it[k]);
      }
    }
    if (!Object.keys(changes).length) continue;
    if (orig) ops.push({ op: "updateItem", target: { itemId: orig.itemId }, changes: changes as never });
    else ops.push({ op: "addItem", item: changes as never });
  }
  return ops;
}

export function BookingFormFields({ b, setB, items, setItems }: { b: FormValues; setB: (v: FormValues) => void; items: ItemForm[]; setItems: (v: ItemForm[]) => void }) {
  const input = "h-9 w-full rounded-lg border border-control bg-sheet px-2.5 text-small";
  const field = (key: string, label: string, el?: React.ReactNode) => (
    <label className="block">
      <span className="mb-1 block text-caption font-medium text-muted">{label}</span>
      {el ?? <input name={key} autoComplete="off" inputMode={NUMERIC.has(key) ? "decimal" : undefined} className={input} value={b[key] ?? ""} onChange={(e) => setB({ ...b, [key]: e.target.value })} />}
    </label>
  );
  const select = (key: string, options: readonly string[]) => (
    <select name={key} className={input} value={b[key] ?? ""} onChange={(e) => setB({ ...b, [key]: e.target.value })}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
  const allCities = DESTINATION_COUNTRIES.flatMap((c) => DESTINATION_CITIES[c].map((city) => city));

  return (
    <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {field("sellerName", "Seller name")}
            {field("originCity", "Collect from", select("originCity", ORIGIN_CITIES))}
            {field("destinationCity", "Deliver to", select("destinationCity", allCities))}
            {field("destinationType", "Destination type", select("destinationType", DESTINATION_TYPES))}
            {field("readyToShipDate", "Ready to ship", <input type="date" name="readyToShipDate" className={input} value={b.readyToShipDate ?? ""} onChange={(e) => setB({ ...b, readyToShipDate: e.target.value })} />)}
            {field("sellerPriority", "Priority", select("sellerPriority", SELLER_PRIORITIES))}
            {field("pallets", "Pallets")}
            {field("cartons", "Total cartons")}
            {field("totalGrossWeightKg", "Gross weight (kg)")}
            {field("totalDeclaredValueGBP", "Declared value (£)")}
            {field(
              "deliveryAppointmentBooked",
              "Delivery appointment",
              <select name="deliveryAppointmentBooked" className={input} value={b.deliveryAppointmentBooked ?? ""} onChange={(e) => setB({ ...b, deliveryAppointmentBooked: e.target.value })}>
                <option value="">—</option>
                <option value="yes">Booked</option>
                <option value="no">Not booked</option>
              </select>,
            )}
          </div>
          <h3 className="mt-6 text-small font-semibold">Items</h3>
          <div className="mt-2 space-y-3">
            {items.map((it, idx) =>
              it.removed ? null : (
                <fieldset key={it.itemId ?? `new-${idx}`} className="rounded-lg border border-border p-3">
                  <legend className="px-1 text-caption text-muted">{it.sku || `Item ${idx + 1}`}</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {(
                      [
                        ["sku", "SKU"],
                        ["description", "Description"],
                        ["hsCode", "HS code"],
                        ["quantityUnits", "Quantity"],
                        ["unitPriceGBP", "Unit price (£)"],
                        ["unitsPerCarton", "Units / carton"],
                        ["cartons", "Cartons"],
                        ["unitWeightKg", "Unit weight (kg)"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="block">
                        <span className="mb-1 block text-caption text-muted">{label}</span>
                        <input name={`items.${idx}.${k}`} autoComplete="off" spellCheck={k === "description"} inputMode={NUMERIC.has(k) ? "decimal" : undefined} className={input} value={it[k]} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, [k]: e.target.value } : x)))} />
                      </label>
                    ))}
                    <label className="block">
                      <span className="mb-1 block text-caption text-muted">Country of origin</span>
                      <select name={`items.${idx}.countryOfOrigin`} className={input} value={it.countryOfOrigin} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, countryOfOrigin: e.target.value } : x)))}>
                        <option value="">—</option>
                        {ITEM_ORIGIN_COUNTRIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <HsHint description={it.description} hsCode={it.hsCode} onUse={(code) => setItems(items.map((x, i) => (i === idx ? { ...x, hsCode: code } : x)))} />
                    <div className="flex items-end">
                      <Button type="button" size="sm" variant="danger" onClick={() => setItems(items.map((x, i) => (i === idx ? { ...x, removed: true } : x)))}>
                        Remove line
                      </Button>
                    </div>
                  </div>
                </fieldset>
              ),
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => setItems([...items, { itemId: null, sku: "", description: "", hsCode: "", quantityUnits: "", unitPriceGBP: "", unitsPerCarton: "", cartons: "", unitWeightKg: "", countryOfOrigin: "" }])}
            >
              + Add item line
            </Button>
          </div>
    </>
  );
}

/** Manual editor: produces the same typed patch operations as the chat, saved via the version-safe PATCH. */
export function EditBookingDialog({ open, draft, onClose, onSubmit, busy, error, focusField }: { focusField?: string | null; open: boolean; draft: DraftBooking; onClose: () => void; onSubmit: (ops: PatchOp[]) => void; busy: boolean; error: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [b, setB] = useState<Record<string, string>>({});
  const [items, setItems] = useState<ItemForm[]>([]);
  const [pending, setPending] = useState<PatchOp[] | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      // Reset the form from the latest draft each time the dialog opens.
      /* eslint-disable react-hooks/set-state-in-effect */
      setPending(null);
      setB(formFromDraft(draft).b);
      setItems(formFromDraft(draft).items);
      /* eslint-enable react-hooks/set-state-in-effect */
      if (!d.open) d.showModal();
      if (focusField) {
        // Wait for the form to render the reset values, then jump to the field the user clicked through from.
        requestAnimationFrame(() => {
          const el = d.querySelector<HTMLElement>(`[name="${focusField}"]`);
          el?.scrollIntoView({ block: "center" });
          el?.focus();
        });
      }
    } else if (d.open) d.close();
  }, [open, draft, focusField]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="edit-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto max-h-[92dvh] w-[min(860px,calc(100vw-24px))] rounded-2xl border border-border bg-sheet p-0 text-text shadow-[0_12px_40px_rgba(0,0,0,0.22)]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return onSubmit(pending);
          const ops = buildOps(draft, b, items);
          if (ops.length) setPending(ops);
          else onClose();
        }}
        className="relative flex max-h-[92dvh] flex-col"
      >
        {pending && (
          <div role="alertdialog" aria-labelledby="edit-confirm-title" className="absolute inset-0 z-10 flex flex-col justify-center gap-4 rounded-2xl bg-sheet px-6 py-6">
            <h3 id="edit-confirm-title" className="text-heading">
              Update your conversation?
            </h3>
            <p className="text-small text-muted">
              Saving adds these changes to the chat. The assistant will thank you for them and ask for anything still missing.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-small">
              {summarise(pending).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setPending(null)} disabled={busy}>
                Keep editing
              </Button>
              <Button type="submit" variant="primary" disabled={busy} autoFocus>
                {busy ? "Saving…" : "Save and continue"}
              </Button>
            </div>
          </div>
        )}
        <header className="border-b border-border px-5 py-4">
          <h2 id="edit-title" className="text-heading">
            Edit booking
          </h2>
          <p className="mt-0.5 text-small text-muted">Changes are checked against all 10 rules and saved as a new revision. Leave a field blank if it&apos;s unknown.</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <BookingFormFields b={b} setB={setB} items={items} setItems={setItems} />
          {error && (
            <div className="mt-4">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
