import { cookieStorage, createConfig, createStorage, http } from 'wagmi'
import { berachain, berachainTestnetbArtio } from 'viem/chains'
import { metaMask } from 'wagmi/connectors'

// TODO: Phase 2 — add transports or wallet-only flows if execution permission requests need dedicated RPCs per chain.

export const config = createConfig({
  chains: [berachain, berachainTestnetbArtio],
  connectors: [metaMask()],
  transports: {
    [berachain.id]: http(),
    [berachainTestnetbArtio.id]: http(),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
})
