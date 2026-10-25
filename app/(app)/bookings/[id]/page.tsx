import type { Metadata } from "next";
import { BookingPage } from "@/components/booking/booking-page";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingRoute({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  return <BookingPage bookingId={id} />;
}
