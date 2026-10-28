import type { Metadata } from "next";
import { CurrencyConverter } from "@/components/tools/currency-converter";

export const metadata: Metadata = { title: "Currency converter" };

export default function CurrencyPage() {
  return <CurrencyConverter />;
}
