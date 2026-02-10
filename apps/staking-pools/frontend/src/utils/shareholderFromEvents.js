/**
 * Compute shareholder registry from cached Nosy events.
 * Per-address: shares acquired, disposed, current; first acquisition block; zeroed-out block (dust).
 * See project/briefs/staking-pool-nosy-mode.md.
 */

import { DUST_THRESHOLD_WEI } from '../constants/nosy-mode.js'

/**
 * @typedef {Object} ShareholderStatus
 * @property {string} address
 * @property {bigint} sharesAcquired
 * @property {bigint} sharesDisposed
 * @property {bigint} currentShares
 * @property {number|null} firstBlock
 * @property {number|null} zeroedBlock
 */

/**
 * Normalize address to lowercase for keying.
 * @param {string} addr
 * @returns {string}
 */
function norm(addr) {
  if (!addr || typeof addr !== 'string') return ''
  return addr.toLowerCase()
}

/**
 * @param {Array<{ eventName: string, blockNumber: number, args: Record<string, unknown> }>} events
 * @returns {ShareholderStatus[]}
 */
export function computeShareholderRegistry(events) {
  if (!Array.isArray(events) || events.length === 0) return []

  const sorted = [...events].sort((a, b) => (a.blockNumber || 0) - (b.blockNumber || 0))
  /** @type {Map<string, { acquired: bigint, disposed: bigint, firstBlock: number | null, zeroedBlock: number | null }>} */
  const byAddress = new Map()

  function ensure(addr) {
    const key = norm(addr)
    if (!key) return null
    if (!byAddress.has(key)) {
      byAddress.set(key, { acquired: 0n, disposed: 0n, firstBlock: null, zeroedBlock: null })
    }
    return byAddress.get(key)
  }

  function toBigInt(v) {
    if (v == null) return 0n
    if (typeof v === 'bigint') return v
    if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.floor(v))
    if (typeof v === 'string') {
      if (v.startsWith('0x')) return BigInt(v)
      const n = Number(v)
      return Number.isFinite(n) ? BigInt(Math.floor(n)) : 0n
    }
    return 0n
  }

  for (const ev of sorted) {
    const block = ev.blockNumber ?? 0
    const args = ev.args || {}

    switch (ev.eventName) {
      // SharesMinted is emitted for both activation deposits and regular deposits
      case 'SharesMinted': {
        const to = args.to
        const amount = toBigInt(args.amount)
        if (to && amount > 0n) {
          const r = ensure(to)
          if (r) {
            r.acquired += amount
            if (r.firstBlock == null) r.firstBlock = block
          }
        }
        break
      }
      // SharesBurned is emitted when shares are burned (withdrawals)
      case 'SharesBurned': {
        const from = args.from
        const amount = toBigInt(args.amount)
        if (from && amount > 0n) {
          const f = ensure(from)
          if (f) {
            f.disposed += amount
            const current = f.acquired - f.disposed
            if (current < DUST_THRESHOLD_WEI) f.zeroedBlock = block
          }
        }
        break
      }
      // Transfer tracks share movements between addresses (not mint/burn)
      case 'Transfer': {
        const from = args.from
        const to = args.to
        const value = toBigInt(args.value)
        // Skip mint (from=0) and burn (to=0) - handled by SharesMinted/SharesBurned
        const zeroAddr = '0x0000000000000000000000000000000000000000'
        const isFromZero = !from || norm(from) === zeroAddr
        const isToZero = !to || norm(to) === zeroAddr
        if (value > 0n && !isFromZero && !isToZero) {
          const f = ensure(from)
          if (f) {
            f.disposed += value
            const current = f.acquired - f.disposed
            if (current < DUST_THRESHOLD_WEI) f.zeroedBlock = block
          }
          const t = ensure(to)
          if (t) {
            t.acquired += value
            if (t.firstBlock == null) t.firstBlock = block
          }
        }
        break
      }
      default:
        break
    }
  }

  const result = []
  for (const [address, data] of byAddress.entries()) {
    const current = data.acquired - data.disposed
    result.push({
      address: address.startsWith('0x') ? address : '0x' + address,
      sharesAcquired: data.acquired,
      sharesDisposed: data.disposed,
      currentShares: current,
      firstBlock: data.firstBlock,
      zeroedBlock: data.zeroedBlock
    })
  }
  return result
}
