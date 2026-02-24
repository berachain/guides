import { createConfig, http } from 'wagmi'
import { anvil } from 'wagmi/chains'

export const config = createConfig({
  chains: [anvil],
  transports: {
    [anvil.id]: http('http://localhost:8545'),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
