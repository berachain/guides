// Imports
// ------------------------------------------------------------
import type { Metadata } from "next";
import "./globals.css";
import RootProvider from "@/providers";
import Nav from "@/components/Nav";

// Metadata
// ------------------------------------------------------------
export const metadata: Metadata = {
  title: "Berachain - NextJS Privy Implementation",
  description: "Demonstrating how to use Privy with NextJS on Berachain.",
};

// Main Layout
// ------------------------------------------------------------
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="p-8">
        <RootProvider>
          {children}
        </RootProvider>
        </main>
      </body>
    </html>
  );
};
