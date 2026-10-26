import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardScreen />
    </Suspense>
  );
}
