import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { Providers } from "./providers";
import { config } from "@/lib/wagmi";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "ERC-7715 wallet support",
  description:
    "Check whether your wallet supports ERC-7715 execution permissions",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialState = cookieToInitialState(
    config,
    (await headers()).get("cookie") ?? undefined,
  );

  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#0A0A0A] font-sans text-zinc-100 antialiased">
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
