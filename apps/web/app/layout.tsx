import type { Metadata } from "next";

import { OfflineBanner } from "../components/offline-banner";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Driftline",
  description: "Your messages live on your device, not ours.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Providers>
          <OfflineBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
