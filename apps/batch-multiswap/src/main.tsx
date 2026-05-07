import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MetaMaskSDK from "@metamask/sdk";
import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import App from "./App";
import { wagmiConfig } from "./wagmi";
import "./index.css";

if (typeof window !== "undefined") {
  // Initializes MetaMask SDK for extension / mobile deeplinks alongside wagmi.
  new MetaMaskSDK({
    dappMetadata: {
      name: "Bera Batch Swapper",
      url: window.location.href,
    },
    injectProvider: true,
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
