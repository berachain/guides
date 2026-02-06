/**
 * Shared Nosy scan logic: chunked getLogs with delay and log normalization.
 * Used by usePoolEventScan (browser) and scripts/test-nosy-scan.js (CLI).
 * See project/briefs/staking-pool-nosy-mode.md.
 */

import { NOSY_EVENTS_ABI } from './abis.js'
import { ETH_GETLOGS_MAX_RANGE, GETLOGS_DELAY_MS } from '../constants/nosy-mode.js'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Normalize a viem log into the shape stored and displayed (chainId, poolAddress, blockNumber, eventName, args, etc.).
 * @param {{ args?: object, blockNumber?: bigint, address?: string, transactionHash?: string, eventName?: string }} log
 * @param {number} chainIdVal
 * @param {string} poolAddressVal
 * @returns {{ chainId: number, poolAddress: string, blockNumber: number, transactionHash: string, eventName: string, sourceAddress: string, args: object }}
 */
export function normalizeLog(log, chainIdVal, poolAddressVal) {
  const args = {}
  if (log.args && typeof log.args === 'object') {
    for (const [k, v] of Object.entries(log.args)) {
      if (typeof k === 'string' && !/^\d+$/.test(k)) args[k] = v
    }
  }
  return {
    chainId: chainIdVal,
    poolAddress: poolAddressVal.toLowerCase(),
    blockNumber: Number(log.blockNumber),
    transactionHash: log.transactionHash || '',
    eventName: log.eventName || 'Unknown',
    sourceAddress: (log.address || '').toLowerCase(),
    args
  }
}

/**
 * Fetch logs in chunks with at least GETLOGS_DELAY_MS between each chunk (RPC-friendly).
 * @param {import('viem').PublicClient} client
 * @param {number | bigint} fromBlock
 * @param {number | bigint} toBlock
 * @param {string[]} addresses - pool, smartOperator, withdrawalVault
 * @returns {Promise<import('viem').Log[]>}
 */
export async function fetchLogsChunked(client, fromBlock, toBlock, addresses) {
  const from = BigInt(fromBlock)
  const to = BigInt(toBlock)
  const span = Number(to - from + 1n)
  if (span <= ETH_GETLOGS_MAX_RANGE) {
    return client.getLogs({
      address: addresses,
      events: NOSY_EVENTS_ABI,
      fromBlock: from,
      toBlock: to
    })
  }
  const logs = []
  const max = BigInt(ETH_GETLOGS_MAX_RANGE)
  let chunkFrom = from
  while (chunkFrom <= to) {
    const chunkTo = chunkFrom + max - 1n > to ? to : chunkFrom + max - 1n
    const chunk = await client.getLogs({
      address: addresses,
      events: NOSY_EVENTS_ABI,
      fromBlock: chunkFrom,
      toBlock: chunkTo
    })
    logs.push(...chunk)
    chunkFrom = chunkTo + 1n
    if (chunkFrom <= to) await delay(GETLOGS_DELAY_MS)
  }
  return logs
}
