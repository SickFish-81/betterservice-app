import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthGate from "./AuthGate";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "Betterservice Tepuke",
  description: "Shop management",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-50 text-zinc-900">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
