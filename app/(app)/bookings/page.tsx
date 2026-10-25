import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingsHistory } from "@/components/bookings/bookings-history";

export const metadata: Metadata = { title: "All bookings" };

export default function BookingsPage() {
  return (
    <Suspense>
      <BookingsHistory />
    </Suspense>
  );
}
