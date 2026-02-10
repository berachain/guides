/**
 * Chain-specific constants keyed by chain ID.
 * Config selects the chain via config.network.chainId; this module provides
 * the rest (factories, GraphQL, Hub URL). Supports single-pool mode (one chain,
 * one or more pools in config) and discovery mode (same chain constants apply).
 *
 * Factory addresses (stakingPoolFactoryAddress, delegationHandlerFactoryAddress)
 * match docs/packages/config/constants.json under contracts.stakingPools
 * (stakingPoolContractsFactory, delegationHandlerFactory). Update both when
 * redeploying.
 */

export const CHAIN_IDS = {
  MAINNET: 80094,
  BEPOLIA: 80069
}

/** @type {Record<number, { name: string, rpcUrl: string, stakingPoolFactoryAddress: string, delegationHandlerFactoryAddress: string, graphqlEndpoint: string, hubBaseUrl: string, explorerUrl: string, chainEnum: string, bgtAddress?: string, knownIncentiveTokenAddresses?: string[] }>} */
export const CHAINS = {
  [CHAIN_IDS.MAINNET]: {
    name: 'Berachain',
    rpcUrl: 'https://rpc.berachain.com',
    stakingPoolFactoryAddress: '0xb79b43dBA821Cb67751276Ce050fF4111445fB99',
    delegationHandlerFactoryAddress: '0xAd17932a5B1aaeEa73D277a6AE670623F176E0D0',
    graphqlEndpoint: 'https://api.berachain.com/graphql',
    hubBaseUrl: 'https://hub.berachain.com',
    explorerUrl: 'https://berascan.com',
    chainEnum: 'BERACHAIN',
    bgtAddress: '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba',
    knownIncentiveTokenAddresses: ['0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce'] // HONEY
  },
  [CHAIN_IDS.BEPOLIA]: {
    name: 'Bepolia',
    rpcUrl: 'https://bepolia.rpc.berachain.com',
    stakingPoolFactoryAddress: '0x176c081E95C82CA68DEa20CA419C7506Aa063C24',
    delegationHandlerFactoryAddress: '0x8b472791aC2f9e9Bd85f8919401b8Ce3bdFd464c',
    graphqlEndpoint: 'https://bepolia-api.berachain.com/graphql',
    hubBaseUrl: 'https://bepolia.hub.berachain.com',
    explorerUrl: 'https://testnet.berascan.com',
    chainEnum: 'BEPOLIA',
    bgtAddress: null,
    knownIncentiveTokenAddresses: []
  }
}

/**
 * @param {number} chainId
 * @returns {typeof CHAINS[number] | null}
 */
export function getChainConstants(chainId) {
  if (chainId == null || typeof chainId !== 'number') return null
  return CHAINS[chainId] ?? null
}
