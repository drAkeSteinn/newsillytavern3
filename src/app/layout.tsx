import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { PersistenceProvider } from "@/components/persistence-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TavernFlow - AI Character Chat Platform",
  description: "Modern LLM frontend for AI character interactions, similar to SillyTavern but optimized and more configurable.",
  keywords: ["TavernFlow", "AI", "LLM", "Character Cards", "Roleplay", "Chat", "Next.js"],
  authors: [{ name: "TavernFlow Team" }],
  icons: {
    icon: [
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icons/favicon-48.png",
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title: "TavernFlow",
    description: "Modern LLM frontend for AI character interactions",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <PersistenceProvider>
            {children}
          </PersistenceProvider>
          <Toaster />
          {/* Sonner toaster: `toast` from 'sonner' is used across chat components
              (quick replies, SSE tool notifications, proactive messages) */}
          <SonnerToaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
