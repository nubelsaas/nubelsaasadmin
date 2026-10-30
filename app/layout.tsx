import type { Metadata } from "next";
import "./globals.css";
import EnvBanner from "@/components/shared/EnvBanner";
import { getNubelEnv } from "@/lib/environment";

const { env } = getNubelEnv();

export const metadata: Metadata = {
  // En DEV la pestaña del navegador lo dice, para no confundir dos pestañas abiertas.
  title: env === 'dev' ? "[DEV] Nubel Admin" : "Nubel Admin",
  description: "Nubel administration portal",
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
