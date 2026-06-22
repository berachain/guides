import { FC } from "react";
import type { AppProps } from "next/app";
import { ThirdwebProvider, metamaskWallet } from "@thirdweb-dev/react";
import "../styles/globals.css";
import type { Chain } from "@thirdweb-dev/chains";

// This is the chain your dApp will work on.
// Change this to the chain your app is built for.
// You can also import additional chains from `@thirdweb-dev/chains` and pass them directly.
const berachainBepolia: Chain = {
  name: "Berachain Bepolia",
  chain: "BERA",
  rpc: ["https://bepolia.rpc.berachain.com"],
  nativeCurrency: {
    name: "BERA Token",
    symbol: "BERA",
    decimals: 18,
  },
  shortName: "berachainBepolia",
  chainId: 80069,
  testnet: true,
  slug: "berachain-bepolia",
  explorers: [
    {
      name: "Beratrail",
      url: "https://bepolia.beratrail.io",
      standard: "EIP3091",
    },
  ],
};

const MyApp: FC<AppProps> = ({ Component, pageProps }) => (
  <ThirdwebProvider
    clientId={process.env.NEXT_PUBLIC_TEMPLATE_CLIENT_ID}
    activeChain={berachainBepolia}
    supportedWallets={[metamaskWallet()]}
  >
    <Component {...pageProps} />
  </ThirdwebProvider>
);

export default MyApp;
