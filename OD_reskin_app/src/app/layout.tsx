import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OneDigital — Officeworks Campaign & CRM",
  description: "Cross-banner campaign management for Officeworks, using Bunnings and Kmart signals",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
