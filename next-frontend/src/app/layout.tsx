import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";

import "./globals.css";

// Public Sans: a neutral workhorse UI face with tabular figures, self-hosted by next/font at
// build time so the browser makes no request to Google.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ACME Compensation Manager",
    template: "%s | ACME Compensation Manager",
  },
  description: "Synthetic-data demo of an HR compensation ledger.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f7f5f1",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
