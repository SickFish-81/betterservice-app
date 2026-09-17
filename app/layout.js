import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthGate from "./AuthGate";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// metadataBase makes every relative canonical and social image resolve against
// the real domain. The title template means each page supplies only its own
// half — the old site had three pages sharing one title, which tells Google
// they aren't distinct pages. Staff pages keep the plain default; they're
// disallowed in robots.js and nobody searches for them.
export const metadata = {
  metadataBase: new URL("https://betterservice.co.nz"),
  title: {
    default: "Betterservice ATV — motorcycle & ATV servicing, Te Puke",
    template: "%s · Betterservice ATV",
  },
  description:
    "Motorcycle and ATV servicing, repairs and used quad sales in Te Puke. Over 25 years in the Bay of Plenty.",
  // Google Search Console ownership. Next renders this as the
  // <meta name="google-site-verification"> tag Google looks for on the home
  // page. Leave it in place permanently — removing it un-verifies the property
  // and we lose the search performance data and the ability to request indexing.
  verification: { google: "00FaYS65Pmq4xwbjytAaIeRIxN8uxfrS0gZmcsL5t3k" },
  // The app can be added to a phone's Home Screen, which is not a nicety: iOS
  // only allows push notifications to an app opened from the Home Screen, so
  // without the manifest and the Apple icon there is no way to notify an iPhone
  // at all. appleWebApp makes it open without Safari's chrome around it.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Betterservice", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport = {
  themeColor: "#dc2626",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-NZ" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-50 text-zinc-900">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
