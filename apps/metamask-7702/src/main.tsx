import "./global.css";
import "@rainbow-me/rainbowkit/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { metaMask } from "@wagmi/connectors";
import { Chain } from "wagmi/chains";

const berachainBepolia: Chain = {
  id: 80085,
  name: "Berachain Bepolia",
  nativeCurrency: { name: "Bera", symbol: "BERA", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://bepolia.rpc.berachain.com"] },
    public: { http: ["https://bepolia.rpc.berachain.com"] },
  },
  blockExplorers: {
    default: { name: "Berascan", url: "https://testnet.berascan.com" },
    secondary: { name: "BeraTrail", url: "https://bepolia.beratrail.io" },
  },
  testnet: true,
};

const config = createConfig({
  connectors: [metaMask()],
  chains: [berachainBepolia],
  transports: {
    [berachainBepolia.id]: http("https://bepolia.rpc.berachain.com"),
  },
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
); 