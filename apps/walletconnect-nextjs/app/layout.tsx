// Imports
// ========================================================
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { cookieToInitialState } from 'wagmi';
import { config } from '@/config';
import ContextProvider from '@/context';

// Metadata
// ========================================================
export const metadata: Metadata = {
  title: 'Web3Modal Berachain',
  description: 'Web3Modal Example With Berachain',
};

// Main Layout
// ========================================================
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const initialState = cookieToInitialState(config, headers().get('cookie'));
  return (
    <html lang="en">
      <body>
        <ContextProvider initialState={initialState}>{children}</ContextProvider>
      </body>
    </html>
  )
};