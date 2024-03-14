import type { AppProps } from "next/app";
import { ThirdwebProvider } from "@thirdweb-dev/react";
import { BerachainArtio } from "@thirdweb-dev/chains";
import { ChakraProvider, extendTheme } from "@chakra-ui/react";
import NavBar from "../components/NavBar";
import { metamaskWallet, coinbaseWallet, okxWallet } from "@thirdweb-dev/react";
import darkTheme from "../styles/theme";

const activeChain = BerachainArtio;

const customTheme = extendTheme({
  ...darkTheme,
  config: {
    initialColorMode: "dark",
    useSystemColorMode: true,
  },
});

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ThirdwebProvider
      supportedWallets={[metamaskWallet({ recommended: true }), coinbaseWallet({}), okxWallet({})]}
      clientId={process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID}
      activeChain={activeChain}
    >
      <ChakraProvider theme={customTheme}>
        <NavBar />
        <Component {...pageProps} />
      </ChakraProvider>
    </ThirdwebProvider>
  );
}

export default MyApp;