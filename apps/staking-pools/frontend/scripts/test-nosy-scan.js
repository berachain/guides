#!/usr/bin/env node
/**
 * CLI test for Nosy activity scan: fetch events for a pool using the same
 * fetchLogsChunked + normalizeLog as the frontend. Resolve addresses from
 * validator pubkey via StakingPoolFactory.getCoreContracts(pubkey) and
 * factory.withdrawalVault(), so we scan the exact contracts that can emit
 * the events we care about. Event-to-contract mapping and signatures are
 * documented in src/utils/abis.js (NOSY_EVENTS_ABI) and project/briefs/staking-pool-nosy-mode.md;
 * verify against vendor/contracts-staking-pools when available.
 *
 * Usage (from frontend dir):
 *   By pubkey (recommended): node scripts/test-nosy-scan.js --pubkey <0x98-char-hex> [--chain 80094] [--from N] [--to N]
 *   By addresses:           node scripts/test-nosy-scan.js --pool <addr> --operator <addr> --vault <addr> [--chain 80094] [--from N] [--to N]
 *
 * If --from/--to omitted, scans the last 20_000 blocks from current.
 */

import { createPublicClient, http, defineChain } from 'viem'
import { getChainConstants } from '../src/constants/chains.js'
import { STAKING_POOL_FACTORY_ABI } from '../src/utils/abis.js'
import { fetchLogsChunked, normalizeLog } from '../src/utils/nosyScanCore.js'

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { pubkey: null, pool: null, operator: null, vault: null, chainId: 80094, fromBlock: null, toBlock: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pubkey' && args[i + 1]) { out.pubkey = args[i + 1]; i++; continue }
    if (args[i] === '--pool' && args[i + 1]) { out.pool = args[i + 1]; i++; continue }
    if (args[i] === '--operator' && args[i + 1]) { out.operator = args[i + 1]; i++; continue }
    if (args[i] === '--vault' && args[i + 1]) { out.vault = args[i + 1]; i++; continue }
    if (args[i] === '--chain' && args[i + 1]) { out.chainId = parseInt(args[i + 1], 10); i++; continue }
    if (args[i] === '--from' && args[i + 1]) { out.fromBlock = parseInt(args[i + 1], 10); i++; continue }
    if (args[i] === '--to' && args[i + 1]) { out.toBlock = parseInt(args[i + 1], 10); i++; continue }
  }
  return out
}

/** Resolve stakingPool, smartOperator, withdrawalVault from factory using validator pubkey. */
async function resolveAddressesFromPubkey(client, factoryAddress, pubkeyHex) {
  const pubkey = pubkeyHex.startsWith('0x') ? pubkeyHex : '0x' + pubkeyHex
  if (pubkey.length !== 98) throw new Error('Pubkey must be 0x-prefixed 96 hex chars (48 bytes)')
  const core = await client.readContract({
    address: factoryAddress,
    abi: STAKING_POOL_FACTORY_ABI,
    functionName: 'getCoreContracts',
    args: [pubkey]
  })
  const vault = await client.readContract({
    address: factoryAddress,
    abi: STAKING_POOL_FACTORY_ABI,
    functionName: 'withdrawalVault'
  })
  const zero = '0x0000000000000000000000000000000000000000'
  const stakingPool = (core?.stakingPool || core?.[1] || '').toLowerCase()
  const smartOperator = (core?.smartOperator || core?.[0] || '').toLowerCase()
  const withdrawalVault = (typeof vault === 'string' ? vault : vault ?? '').toLowerCase()
  if (stakingPool === zero || !stakingPool) throw new Error('No staking pool for this pubkey (getCoreContracts returned zero pool)')
  if (!withdrawalVault || withdrawalVault === zero) throw new Error('Factory withdrawalVault is zero')
  return { pool: stakingPool, operator: smartOperator, vault: withdrawalVault }
}

async function main() {
  const { pubkey, pool, operator, vault, chainId, fromBlock, toBlock } = parseArgs()
  const usePubkey = !!pubkey
  const useAddresses = !!(pool && operator && vault)
  if (!usePubkey && !useAddresses) {
    console.error('Usage:')
    console.error('  --pubkey <0x98-char-hex>   Resolve pool/operator/vault from StakingPoolFactory (recommended)')
    console.error('  --pool, --operator, --vault   Or pass addresses explicitly')
    console.error('  [--chain 80094] [--from N] [--to N]')
    process.exit(1)
  }

  let poolAddr = pool
  let operatorAddr = operator
  let vaultAddr = vault

  const chainConfig = getChainConstants(chainId)
  if (!chainConfig?.rpcUrl) {
    console.error('No RPC URL for chain', chainId)
    process.exit(1)
  }

  const chain = defineChain({
    id: chainId,
    name: chainConfig.name || 'Custom',
    nativeCurrency: { name: 'BERA', symbol: 'BERA', decimals: 18 },
    rpcUrls: { default: { http: [chainConfig.rpcUrl] } }
  })

  const client = createPublicClient({
    chain,
    transport: http(chainConfig.rpcUrl)
  })

  if (usePubkey) {
    const factoryAddress = chainConfig.stakingPoolFactoryAddress
    if (!factoryAddress) {
      console.error('No stakingPoolFactoryAddress for chain', chainId)
      process.exit(1)
    }
    console.log('Resolving addresses from factory for pubkey', pubkey.slice(0, 18) + '…')
    const resolved = await resolveAddressesFromPubkey(client, factoryAddress, pubkey)
    poolAddr = resolved.pool
    operatorAddr = resolved.operator
    vaultAddr = resolved.vault
    console.log('Resolved:', { pool: poolAddr.slice(0, 10) + '…', operator: operatorAddr.slice(0, 10) + '…', vault: vaultAddr.slice(0, 10) + '…' })
  }

  let from = fromBlock
  let to = toBlock
  if (from == null || to == null) {
    const current = Number(await client.getBlockNumber())
    const span = 20_000
    to = to ?? current
    from = from ?? Math.max(0, to - span + 1)
  }

  const addresses = [poolAddr, operatorAddr, vaultAddr].map((a) => a.toLowerCase())
  console.log('Fetching logs', { from, to, addresses: addresses.map((a) => a.slice(0, 10) + '…') })
  const logs = await fetchLogsChunked(client, from, to, addresses)
  console.log('Raw logs count:', logs.length)

  const normalized = logs.map((log) => normalizeLog(log, chainId, poolAddr))
  console.log('Normalized events count:', normalized.length)
  const byName = {}
  for (const ev of normalized) {
    byName[ev.eventName] = (byName[ev.eventName] || 0) + 1
  }
  console.log('By event name:', byName)

  if (normalized.length > 0) {
    console.log('\nFirst 10 events:')
    normalized.slice(0, 10).forEach((ev, i) => {
      console.log(`  ${i + 1}. ${ev.eventName} block=${ev.blockNumber} tx=${(ev.transactionHash || '').slice(0, 18)}…`)
    })
  } else {
    console.log('\nNo events in range. Try a different block range or check pool/operator/vault addresses.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
