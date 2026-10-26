import type { Metadata } from "next";
import { NewBooking } from "@/components/new-booking/new-booking";

export const metadata: Metadata = { title: "New booking" };

export default function NewBookingPage() {
  return <NewBooking />;
}
