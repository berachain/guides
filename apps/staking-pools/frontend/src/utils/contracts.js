import { STAKING_POOL_FACTORY_ABI, DELEGATION_HANDLER_FACTORY_ABI } from './abis.js'
import { getChainConstants } from '../constants/chains.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Resolve core staking pool contracts for a validator pubkey via the factory.
 * Returns null if chain is not configured or the call fails.
 */
export async function resolveCoreContracts(publicClient, chainId, pubkey) {
  const chain = getChainConstants(chainId)
  if (!chain?.stakingPoolFactoryAddress) return null
  const core = await publicClient.readContract({
    address: chain.stakingPoolFactoryAddress,
    abi: STAKING_POOL_FACTORY_ABI,
    functionName: 'getCoreContracts',
    args: [pubkey]
  })
  if (!core) return null
  return {
    smartOperator: core[0] || null,
    stakingPool: core[1] || null,
    stakingRewardsVault: core[2] || null,
    incentiveCollector: core[3] || null
  }
}

/**
 * Resolve the delegation handler address for a validator pubkey.
 * Returns null if not configured, not deployed, or zero address.
 */
export async function resolveDelegationHandler(publicClient, chainId, pubkey) {
  const chain = getChainConstants(chainId)
  if (!chain?.delegationHandlerFactoryAddress) return null
  const addr = await publicClient.readContract({
    address: chain.delegationHandlerFactoryAddress,
    abi: DELEGATION_HANDLER_FACTORY_ABI,
    functionName: 'delegationHandlers',
    args: [pubkey]
  })
  return addr && addr !== ZERO_ADDRESS ? addr : null
}
