import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  connectorsForWallets,
  RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import { createConfig, http } from "@wagmi/core";

import { WagmiProvider } from "wagmi";
import { berachainTestnet } from "wagmi/chains";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { getRainbowMagicWallet } from "./RainbowMagicConnector";
import App from "./App";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        getRainbowMagicWallet({
          chains: [berachainTestnet],
          apiKey: "YOUR_MAGIC_API_KEY",
        }),
      ],
    },
  ],
  {
    appName: "My RainbowKit App",
    projectId: "project_id",
  }
);

export const config = createConfig({
  chains: [berachainTestnet],
  connectors,
  transports: {
    [berachainTestnet.id]: http("https://artio.rpc.berachain.com"),
  },
});

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

const queryClient = new QueryClient();

root.render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
