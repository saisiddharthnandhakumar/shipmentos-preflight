import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({ variable: "--font-public", subsets: ["latin"], display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "ShipmentOS", template: "%s · ShipmentOS" },
  description: "Book UK → EU pallet shipments by chat or Excel and catch mistakes before they leave. A booking-preparation demo; no carrier is contacted.",
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#e9ece7" }, { media: "(prefers-color-scheme: dark)", color: "#0c1215" }], width: "device-width", initialScale: 1 };

// Runs before first paint so the chosen theme never flashes. Per-viewer preference only (localStorage, guarded).
const THEME_INIT = `(function(){try{var t=localStorage.getItem("shipmentos.theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${publicSans.variable} ${plexMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
