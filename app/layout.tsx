import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nubel Admin",
  description: "Nubel administration portal",
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
