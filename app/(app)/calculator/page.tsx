import type { Metadata } from "next";
import { ShippingCalculator } from "@/components/tools/shipping-calculator";

export const metadata: Metadata = { title: "Shipping calculator" };

export default function CalculatorPage() {
  return <ShippingCalculator />;
}
