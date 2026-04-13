import type { Metadata } from "next";
import "./globals.css";
import PassengerNav from "@/components/nav";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Nairobi Transit — Cashless Matatu Payments",
  description:
    "Pay your matatu fare with M-Pesa via QR code or USSD. No cash needed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#F3F7F3] text-gray-900">
        {/* ── Header ───────────────────────────────────────────── */}
        <header className="bg-transit-green text-white px-5 h-14 flex items-center justify-between sticky top-0 z-50 shadow-md border-b-2 border-transit-green-dark">
          {/* Brand mark: white NT badge + wordmark */}
          <Link href="/" className="flex items-center gap-2.5">
            <span className="bg-white text-transit-green font-black text-sm w-8 h-8 rounded-lg flex items-center justify-center leading-none select-none">
              NT
            </span>
            <span className="text-white text-lg font-bold tracking-tight">
              Nairobi<span className="font-light"> Transit</span>
            </span>
          </Link>
          {/* Crew access — visible pill badge */}
          <Link
            href="/crew"
            className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 border border-white/50 text-white text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
            Crew
          </Link>
        </header>

        {/* ── Page content — padded at bottom for mobile nav ─── */}
        <main className="flex-1 pb-20">{children}</main>

        {/* ── Passenger bottom nav ──────────────────────────── */}
        <PassengerNav />
      </body>
    </html>
  );
}
