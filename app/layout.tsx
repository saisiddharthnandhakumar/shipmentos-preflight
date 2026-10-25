import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "ShipmentOS", template: "%s · ShipmentOS" },
  description: "Book UK → EU pallet shipments by chat or Excel and catch mistakes before they leave. A booking-preparation demo; no carrier is contacted.",
};

export const viewport: Viewport = { themeColor: "#f3f5f7", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${plexMono.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
