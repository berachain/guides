import { createThirdwebClient } from "thirdweb";
import { http } from "viem";
import { berachain, berachainBepolia } from "viem/chains";
import { createConfig, injected } from "wagmi";

export const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 80094);

export const activeChain =
  chainId === berachainBepolia.id ? berachainBepolia : berachain;

export const thirdwebClient = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID,
});

export const wagmiConfig = createConfig({
  chains: [berachain, berachainBepolia],
  connectors: [injected()],
  transports: {
    [berachain.id]: http(),
    [berachainBepolia.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
