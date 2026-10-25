export type { BookingSnapshot } from "@/lib/server/booking-service";
export type { TurnResponse } from "@/lib/server/turns";
export type { BookingListItem, StoredMessage } from "@/lib/db/repo";
export type { Evaluation, RuleResult, DraftBooking, DraftItem, CarrierAssessment, InputIssue, MissingField, PatchOp } from "@/lib/domain/schemas";

export type ChatListResponse = { items: import("@/lib/db/repo").BookingListItem[]; nextCursor: string | null };
export type MessagesResponse = { messages: import("@/lib/db/repo").StoredMessage[]; nextCursor: string | null };
