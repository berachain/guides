"use client";

// Imports
// ------------------------------------------------------------
import {WagmiProvider, createConfig} from '@privy-io/wagmi';
import { berachain } from 'viem/chains';
import { http } from 'viem';

// Config
// ------------------------------------------------------------
const config = createConfig({
  chains: [berachain],
  transports: {
    [berachain.id]: http(),
  },
});

// Provider
// ------------------------------------------------------------
const Wagmi = ({ children }: { children: React.ReactNode }) => {
  return (<WagmiProvider config={config}>
    {children}
  </WagmiProvider>);
};

// Exports
// ------------------------------------------------------------
export default Wagmi;