import type { Metadata } from "next";

import "./globals.css";

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
      <body className="font-sans">{children}</body>
    </html>
  );
}
