import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { themeInitScript } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "Linear Staking (sample dApp)",
  description:
    "Sample project: stake an ERC-20 token and earn linear, time-based rewards. Not audited. Test tokens only.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07080c" },
    { media: "(prefers-color-scheme: light)", color: "#f4f5f9" },
  ],
};

// Geist Sans (variable, for the interface and every number) and Geist Mono (for addresses
// and hashes only) ship inside the `geist` npm package and are served from this app's own
// origin through next/font/local. Nothing is fetched from a font CDN.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The inline script sets data-theme before the first paint, which is why the attribute
    // may differ from what the server rendered.
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh font-sans text-body text-ink antialiased">{children}</body>
    </html>
  );
}
