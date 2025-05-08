// Main entry point for the RainbowKit Vite demo app
// ========================================================
// This file sets up global styles, providers, and renders the root React component.

import "./polyfills";
import "./global.css";
import "@rainbow-me/rainbowkit/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Import providers and configuration utilities
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { berachainTestnet } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Configure Wagmi and RainbowKit for Berachain testnet
const config = getDefaultConfig({
  appName: "RainbowKit demo",
  projectId: "2093a03c8449d5e6d0066f2cfbdb1727",
  chains: [berachainTestnet],
});

// Set up React Query client for state management
const queryClient = new QueryClient();

// Render the app with all necessary providers
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
