"use client";

// Imports
// ------------------------------------------------------------
import { PrivyProvider } from "@privy-io/react-auth";
import { berachain, berachainBepolia } from "viem/chains";
import dynamic from "next/dynamic";

// Provider
// ------------------------------------------------------------
const Privy = ({ children }: { children: React.ReactNode }) => {
  return (
    <PrivyProvider 
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID as string}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID as string}
      config={{
        // Chain configuration
        defaultChain: berachainBepolia,
        supportedChains: [berachain, berachainBepolia],
        // Allow for users to create an embedded wallet on login
        embeddedWallets: {
          ethereum: {
            createOnLogin: "off", // "all-users", // 'all-users' | 'users-without-wallets' | 'off'
          },
        },
      }}
      >
      {children}
    </PrivyProvider>
  );
};

// Exports
// ------------------------------------------------------------
/**
 * @dev this is to fix the hydration issues
 */
export default dynamic(() => Promise.resolve(Privy), {
  ssr: false,
});