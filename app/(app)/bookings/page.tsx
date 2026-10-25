import type { Metadata } from "next";
import { BookingsHistory } from "@/components/bookings/bookings-history";

export const metadata: Metadata = { title: "All bookings" };

export default function BookingsPage() {
  return <BookingsHistory />;
}
