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

