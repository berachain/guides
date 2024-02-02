"use client";

// import { defaultWagmiConfig } from '@web3modal/wagmi/react/config'
// import { createStorage } from 'wagmi'
// import { mainnet, sepolia } from 'wagmi/chains'

// import { createWeb3Modal, defaultWagmiConfig } from '@web3modal/wagmi/react'
// import { WagmiConfig } from 'wagmi'
// import { defineChain } from "viem";


// // 1. Get projectId at https://cloud.walletconnect.com
// const projectId = '35f244b8be6a49eb23f1e2c0922dbe7f'

// // 2. Create wagmiConfig
// const metadata = {
//   name: 'Web3Modal',
//   description: 'Web3Modal Example',
//   url: 'https://web3modal.com',
//   icons: ['https://avatars.githubusercontent.com/u/37784886']
// };

// const chainConfiguration = defineChain({
//   id: parseInt(`${process.env.NEXT_PUBLIC_CHAIN_ID}`),
//   name: `${process.env.NEXT_PUBLIC_NETWORK_NAME}`,
//   network: `${process.env.NEXT_PUBLIC_NETWORK_NAME}`,
//   nativeCurrency: {
//     decimals: parseInt(`${process.env.NEXT_PUBLIC_CURRENCY_DECIMALS}`),
//     name: `${process.env.NEXT_PUBLIC_CURRENCY_NAME}`,
//     symbol: `${process.env.NEXT_PUBLIC_CURRENCY_SYMBOL}`,
//   },
//   rpcUrls: {
//     default: {
//       http: [`${process.env.NEXT_PUBLIC_RPC_URL}`],
//     },
//     public: {
//       http: [`${process.env.NEXT_PUBLIC_RPC_URL}`],
//     },
//   },
//   blockExplorers: {
//     default: { name: `${process.env.NEXT_PUBLIC_BLOCK_EXPLORER_NAME}`, url: `${process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL}` },
//   },
// });

// const chains = [chainConfiguration];
// const wagmiConfig = defaultWagmiConfig({ chains, projectId, metadata });

// // 3. Create modal
// createWeb3Modal({ wagmiConfig, projectId, chains });

// export function Web3Modal({ children }: { children: React.ReactNode }) {
//   return <WagmiConfig config={wagmiConfig}>
//       {children}
//   </WagmiConfig>;
// }