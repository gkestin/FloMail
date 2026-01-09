import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "FloMail - Voice-First Email Assistant",
  description: "Draft emails with your voice, powered by AI",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FloMail",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${sora.variable} antialiased`}>
        <AuthProvider>
        {children}
        </AuthProvider>
      </body>
    </html>
  );
}
