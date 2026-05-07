import { http, createConfig } from "wagmi";
import { metaMask } from "wagmi/connectors";
import { berachain } from "./lib/berachain";

export const wagmiConfig = createConfig({
  chains: [berachain],
  connectors: [
    metaMask({
      dappMetadata: {
        name: "Bera Batch Swapper",
        url:
          typeof window !== "undefined"
            ? window.location.origin
            : "https://localhost",
      },
    }),
  ],
  transports: {
    [berachain.id]: http("https://rpc.berachain.com"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
