/**
 * Scratch-pad shipping maths for the sidebar calculator. It reuses the same carrier engine and the same
 * arithmetic as rules R-02 to R-07, but nothing here is saved or scored against a booking.
 */
import { assessCarriers } from "./carriers";
import { CARRIER_OPTIONS, type DestinationCountry, type SellerPriority } from "./reference";
import type { CarrierAssessment } from "./schemas";

export type CalcLine = { quantity: number | null; unitPrice: number | null; unitsPerCarton: number | null; cartons: number | null; unitWeightKg: number | null };

export type LineResult = {
  value: number | null;
  /** units per carton × cartons, compared with quantity (R-03). */
  cartonUnits: number | null;
  cartonsMatch: boolean | null;
  /** Cartons needed for the quantity, rounded up. */
  cartonsNeeded: number | null;
  weightKg: number | null;
};

export type CalcInput = {
  destination: DestinationCountry | null;
  pallets: number | null;
  grossWeightKg: number | null;
  priority: SellerPriority | null;
  lines: CalcLine[];
};

export type CalcResult = {
  lines: LineResult[];
  /** Σ quantity × unit price: what total declared value should be (R-02, 1% tolerance). */
  itemsValue: number | null;
  declaredRange: [number, number] | null;
  /** Σ cartons across lines: what total cartons should be (R-04). */
  totalCartons: number | null;
  /** Σ unit weight × quantity: total gross weight must be at least this (R-07). */
  minGrossWeightKg: number | null;
  /** The weight the carrier maths used: typed gross weight, else the item-weight estimate. */
  weightUsedKg: number | null;
  weightIsEstimate: boolean;
  carrier: CarrierAssessment;
};

const sumOrNull = (xs: (number | null)[]) => (xs.length && xs.every((x) => x != null) ? (xs as number[]).reduce((a, b) => a + b, 0) : null);
const money = (x: number) => Math.round(x * 10_000) / 10_000;

export function calculate(input: CalcInput): CalcResult {
  const lines: LineResult[] = input.lines.map((l) => {
    const cartonUnits = l.unitsPerCarton != null && l.cartons != null ? l.unitsPerCarton * l.cartons : null;
    return {
      value: l.quantity != null && l.unitPrice != null ? money(l.quantity * l.unitPrice) : null,
      cartonUnits,
      cartonsMatch: cartonUnits != null && l.quantity != null ? cartonUnits === l.quantity : null,
      cartonsNeeded: l.quantity != null && l.unitsPerCarton ? Math.ceil(l.quantity / l.unitsPerCarton) : null,
      weightKg: l.quantity != null && l.unitWeightKg != null ? money(l.quantity * l.unitWeightKg) : null,
    };
  });
  const itemsValue = sumOrNull(lines.map((l) => l.value));
  const minGross = sumOrNull(lines.map((l) => l.weightKg));
  const typed = input.grossWeightKg;
  const weightUsedKg = typed ?? minGross;
  const carrier = assessCarriers(
    { destinationCountry: input.destination, pallets: input.pallets, totalGrossWeightKg: weightUsedKg, sellerPriority: input.priority, selectedCarrierKey: null },
    CARRIER_OPTIONS,
  );
  return {
    lines,
    itemsValue: itemsValue == null ? null : money(itemsValue),
    declaredRange: itemsValue == null ? null : [money(itemsValue * 0.99), money(itemsValue * 1.01)],
    totalCartons: sumOrNull(input.lines.map((l) => l.cartons)),
    minGrossWeightKg: minGross == null ? null : money(minGross),
    weightUsedKg,
    weightIsEstimate: typed == null && minGross != null,
    carrier,
  };
}
