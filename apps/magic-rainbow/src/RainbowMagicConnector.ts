import { dedicatedWalletConnector } from "@magiclabs/wagmi-connector";
import { Wallet, WalletDetailsParams } from "@rainbow-me/rainbowkit";

import { Chain } from "wagmi/chains";
import { createConnector as createWagmiConnector } from "wagmi";

export const getRainbowMagicWallet = (options: any) => {
  return () => rainbowMagicWallet(options);
};

export const rainbowMagicWallet = ({
  chains,
  apiKey,
}: {
  chains: Chain[];
  apiKey: string;
}): Wallet => ({
  id: "magic",
  name: "Magic",
  rdns: "Magic",
  iconUrl: "https://dashboard.magic.link/images/logo.svg",
  iconBackground: "#fff",
  installed: true,
  downloadUrls: {},
  createConnector: (walletDetails: WalletDetailsParams) =>
    createWagmiConnector((config) => ({
      ...dedicatedWalletConnector({
        chains: chains,
        options: {
          apiKey: apiKey,
          networks: [
            {
              rpcUrl: "https://artio.rpc.berachain.com",
              chainId: 80085,
            },
          ],
          magicSdkConfiguration: {
            network: {
              rpcUrl: "https://artio.rpc.berachain.com",
              chainId: 80085,
            },
          },
        },
      })(config),
      ...walletDetails,
    })),
});
