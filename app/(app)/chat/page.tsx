import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata: Metadata = { title: "Chat" };

export default async function NewChatPage({ searchParams }: PageProps<"/chat">) {
  const { new: nonce } = await searchParams;
  return <ChatWorkspace key={typeof nonce === "string" ? nonce : "new"} initialBookingId={null} />;
}
