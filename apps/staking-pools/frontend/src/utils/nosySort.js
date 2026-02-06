/**
 * Nosy Mode shareholder sort logic.
 * Pure functions extracted from NosyView for testability.
 */

/** @type {Record<string, string>} */
export const SORT_LABELS = {
  address: 'Address',
  currentShares: 'Current shares',
  sharesAcquired: 'Acquired',
  sharesDisposed: 'Disposed',
  firstBlock: 'First block',
  zeroedBlock: 'Zeroed block'
}

const BIGINT_COLUMNS = new Set(['currentShares', 'sharesAcquired', 'sharesDisposed'])

/**
 * Sort shareholders by column and direction.
 * @param {Array} list
 * @param {string} col
 * @param {'asc'|'desc'} dir
 * @returns {Array}
 */
export function sortShareholders(list, col, dir) {
  if (!list.length) return list
  const mult = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    let cmp = 0
    if (col === 'address') {
      cmp = (a.address || '').toLowerCase().localeCompare((b.address || '').toLowerCase())
    } else if (BIGINT_COLUMNS.has(col)) {
      const va = a[col] ?? 0n
      const vb = b[col] ?? 0n
      cmp = va < vb ? -1 : va > vb ? 1 : 0
    } else {
      const va = a[col] ?? -1
      const vb = b[col] ?? -1
      cmp = va < vb ? -1 : va > vb ? 1 : 0
    }
    return cmp * mult
  })
}

/**
 * Compute next sort state when a column header is clicked.
 * @param {string} currentCol
 * @param {'asc'|'desc'} currentDir
 * @param {string} clickedCol
 * @returns {{ column: string, direction: 'asc'|'desc' }}
 */
export function nextSortState(currentCol, currentDir, clickedCol) {
  if (currentCol === clickedCol) {
    return { column: clickedCol, direction: currentDir === 'asc' ? 'desc' : 'asc' }
  }
  return { column: clickedCol, direction: clickedCol === 'address' ? 'asc' : 'desc' }
}

/**
 * Aria label for a sort button.
 * @param {string} col
 * @param {string} activeCol
 * @param {'asc'|'desc'} activeDir
 * @returns {string}
 */
export function sortAriaLabel(col, activeCol, activeDir) {
  const name = SORT_LABELS[col] || col
  const dir = activeCol === col ? (activeDir === 'asc' ? 'ascending' : 'descending') : 'none'
  return `${name}, sort ${dir}. Click to sort.`
}

/**
 * Display label for a sort button (includes arrow when active).
 * @param {string} col
 * @param {string} activeCol
 * @param {'asc'|'desc'} activeDir
 * @returns {string}
 */
export function sortButtonLabel(col, activeCol, activeDir) {
  const name = SORT_LABELS[col] || col
  if (activeCol !== col) return name
  return activeDir === 'asc' ? `${name} \u2191` : `${name} \u2193`
}
