import { formatEther } from 'viem'

/**
 * Display-only formatting helpers.
 *
 * Never use these for inputs; they add grouping separators (commas) which will
 * break numeric parsing (e.g. parseFloat('1,234') === 1).
 */

/**
 * Exchange rate from pool totalAssets/totalSupply (bigint). Returns 1 if supply is zero.
 * @param {bigint} totalAssets
 * @param {bigint} totalSupply
 * @returns {number}
 */
export function calculateExchangeRate(totalAssets, totalSupply) {
  if (totalSupply === 0n) return 1
  const scaled = (totalAssets * 1_000_000n) / totalSupply
  return Number(scaled) / 1_000_000
}

/**
 * Formats a numeric BERA amount with thousands separators.
 *
 * @param {number|string|bigint|null|undefined} value
 * @param {{decimals?: number}} [opts]
 * @returns {string|null}
 */
export function formatBeraDisplay(value, opts = {}) {
  if (value === null || value === undefined) return null

  const decimals = Number.isFinite(opts.decimals) ? opts.decimals : 4

  const n =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : Number(value)

  if (!Number.isFinite(n)) return null

  return new Intl.NumberFormat('en-US', {
    useGrouping: true,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n)
}

/**
 * @param {number|string} value
 * @param {number} [decimals=2]
 * @param {{ prefix?: string }} [opts] - e.g. { prefix: '$' } for delegation display
 */
export function formatNumber(value, decimals = 2, opts = {}) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  const prefix = opts.prefix ?? ''
  if (num >= 1_000_000) {
    return prefix + (num / 1_000_000).toFixed(decimals === 0 ? 0 : 2) + 'M'
  }
  if (num >= 1_000) {
    return prefix + (num / 1_000).toFixed(decimals === 0 ? 0 : 2) + 'K'
  }
  return prefix + num.toFixed(decimals)
}

export function formatTimeRemaining(seconds) {
  if (seconds <= 0) return 'Ready'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `~${hours}h ${minutes}m`
  return `~${minutes}m`
}

export function formatAssets(assets) {
  const s = formatEther(assets)
  return formatBeraDisplay(s, { decimals: 4 }) || '0.0000'
}

export function shortAddress(address, prefixLen = 6, suffixLen = 4) {
  if (!address || typeof address !== 'string') return ''
  if (address.length <= prefixLen + suffixLen + 2) return address
  return `${address.slice(0, prefixLen)}…${address.slice(-suffixLen)}`
}

export function defaultPoolName(stakingPoolAddress) {
  if (!stakingPoolAddress || typeof stakingPoolAddress !== 'string') return 'Staking Pool'
  const a = stakingPoolAddress.toLowerCase()
  if (!a.startsWith('0x') || a.length < 6) return 'Staking Pool'
  return `Staking Pool ${a.slice(-4)}`
}

export function validateAmount(input) {
  if (input === null || input === undefined) {
    return { valid: false, value: null, error: 'Enter an amount.' }
  }
  const raw = typeof input === 'string' ? input.trim() : String(input)
  if (!raw) {
    return { valid: false, value: null, error: 'Enter an amount.' }
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    return { valid: false, value: null, error: 'Enter a valid amount.' }
  }
  return { valid: true, value, error: null }
}

