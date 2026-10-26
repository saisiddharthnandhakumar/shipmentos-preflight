import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatThreadPage({ params }: PageProps<"/chat/[bookingId]">) {
  const { bookingId } = await params;
  return <ChatWorkspace key={bookingId} initialBookingId={bookingId} />;
}
