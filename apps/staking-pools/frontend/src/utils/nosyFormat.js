/**
 * Nosy Mode formatting helpers.
 * Pure functions extracted from NosyView for testability.
 */

import { formatEther } from 'viem'
import { formatBeraDisplay, formatNumber } from './format.js'

/**
 * Format a wei BigInt value to a display string with 4-decimal grouping.
 * @param {bigint|null|undefined} wei
 * @returns {string}
 */
export function formatWei(wei) {
  if (wei == null || wei === undefined) return '\u2014'
  const ether = Number(formatEther(wei))
  return formatBeraDisplay(ether) ?? '\u2014'
}

/**
 * Format a wei BigInt value to a compact display string (e.g. "1.5K").
 * @param {bigint|null|undefined} wei
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatWeiCompact(wei, decimals = 1) {
  if (wei == null || wei === undefined) return '\u2014'
  const ether = Number(formatEther(wei))
  return formatNumber(ether, decimals)
}

/**
 * Format the protocol fee as "(amount)" or em-dash if not applicable.
 * @param {{ bgtBalanceOfSmartOperator?: bigint|null, bgtFeeState?: { currentBalance?: bigint }|null, rebaseableBgtAmount?: bigint|null }|null} nosy
 * @returns {string}
 */
export function formatProtocolFee(nosy) {
  if (!nosy) return '\u2014'
  const bgtHeld = nosy.bgtBalanceOfSmartOperator ?? nosy.bgtFeeState?.currentBalance
  const rebaseable = nosy.rebaseableBgtAmount
  if (bgtHeld == null || rebaseable == null) return '\u2014'
  const fee = bgtHeld - rebaseable
  if (fee <= 0n) return '\u2014'
  return '(' + formatWei(fee) + ')'
}

/**
 * Truncate an address to 0xABCDEF...1234 form.
 * @param {string|null|undefined} addr
 * @returns {string}
 */
export function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return ''
  const a = addr.startsWith('0x') ? addr.slice(2) : addr
  if (a.length <= 12) return addr
  return '0x' + a.slice(0, 6) + '\u2026' + a.slice(-4)
}
