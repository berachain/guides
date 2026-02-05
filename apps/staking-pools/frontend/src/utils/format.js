import { formatEther } from 'viem'

/**
 * Display-only formatting helpers.
 *
 * Never use these for inputs; they add grouping separators (commas) which will
 * break numeric parsing (e.g. parseFloat('1,234') === 1).
 */

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

export function formatNumber(value, decimals = 2) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '—'
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + 'M'
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + 'K'
  }
  return num.toFixed(decimals)
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

