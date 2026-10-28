import type { ReactNode } from "react";

export type NavItem = { href: string; label: string; match: (p: string) => boolean; icon: ReactNode };

const svg = (d: string) => (
  <svg viewBox="0 0 16 16" className="size-4 flex-none" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", match: (p) => p === "/" || p.startsWith("/dashboard") || p.startsWith("/today"), icon: svg("M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5Z") },
  { href: "/upload", label: "Master Data", match: (p) => p.startsWith("/upload"), icon: svg("M8 10.5v-8M5 5.5l3-3 3 3M3 10.5V13h10v-2.5") },
  { href: "/bookings", label: "All bookings", match: (p) => p.startsWith("/bookings"), icon: svg("M3 4h10M3 8h10M3 12h10") },
  { href: "/calculator", label: "Shipping calculator", match: (p) => p.startsWith("/calculator"), icon: svg("M4 2.5h8a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5ZM5.5 5h5M5.5 8h.01M8 8h.01M10.5 8h.01M5.5 10.5h.01M8 10.5h.01M10.5 10.5h.01") },
  { href: "/currency", label: "Currency converter", match: (p) => p.startsWith("/currency"), icon: svg("M2.5 6h10l-2.5-2.5M13.5 10h-10l2.5 2.5") },
];
