import type { Metadata } from "next";
import "./globals.css";
import "./ui-rules.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "PAPOT AGENCEMENT",
  description: "Application interne PAPOT AGENCEMENT",
  icons: {
    icon: "/papot-icon.svg",
    shortcut: "/papot-icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
