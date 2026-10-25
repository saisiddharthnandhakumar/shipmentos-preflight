import { carrierRowToOption, verifyReference } from "../db/reference";
import { carrierOptions } from "../db/schema";
import type { Exec } from "../db/repo";
import type { CarrierOption } from "../domain/reference";
import { ApiError } from "./http";

let cache: { options: CarrierOption[]; loadedAt: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

/**
 * Loads the seeded rate card from Neon. Refuses to evaluate if the database copy diverges from the
 * checked-in, source-derived fixture (e.g. a manual edit), so judges always get the template rates.
 */
export async function getCarrierOptions(db: Exec): Promise<CarrierOption[]> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.options;
  const report = await verifyReference(db);
  if (!report.ok) {
    console.error("Reference data parity failed:", report.problems.join("; "));
    throw new ApiError(500, "REFERENCE_MISMATCH", "Fixed carrier/rule reference data is not in the expected state. Run the seed.");
  }
  const rows = await db.select().from(carrierOptions);
  const options = rows.map(carrierRowToOption).sort((a, b) => a.key.localeCompare(b.key));
  cache = { options, loadedAt: Date.now() };
  return options;
}

export function clearReferenceCache() {
  cache = null;
}
