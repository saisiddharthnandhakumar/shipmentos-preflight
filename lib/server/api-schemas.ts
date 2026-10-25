import { z } from "zod";
import { LIMITS, PatchOpSchema } from "../domain/schemas";

const requestId = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
const uuid = z.string().uuid();

export const CreateBookingBody = z.object({ clientKey: requestId });
export const ChatTurnBody = z.object({
  bookingId: uuid,
  expectedRevision: z.number().int().min(0),
  requestId,
  message: z.string().trim().min(1).max(LIMITS.maxMessageChars),
});
export const EditBody = z.object({
  expectedRevision: z.number().int().min(0),
  requestId,
  operations: z.array(PatchOpSchema).min(1).max(60),
});
export const ConfirmBody = z.object({ expectedRevision: z.number().int().min(0), requestId });

export function pageLimit(v: string | null, def = 30, max = 100): number {
  const n = Number(v ?? def);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : def;
}
