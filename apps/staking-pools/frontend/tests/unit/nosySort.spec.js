import { describe, it, expect } from 'vitest'
import {
  sortShareholders,
  nextSortState,
  sortAriaLabel,
  sortButtonLabel
} from '../../src/utils/nosySort.js'

function makeShareholders() {
  return [
    { address: '0xbbb', currentShares: 200n, sharesAcquired: 300n, sharesDisposed: 100n, firstBlock: 10, zeroedBlock: null },
    { address: '0xaaa', currentShares: 500n, sharesAcquired: 500n, sharesDisposed: 0n, firstBlock: 5, zeroedBlock: null },
    { address: '0xccc', currentShares: 0n, sharesAcquired: 100n, sharesDisposed: 100n, firstBlock: 20, zeroedBlock: 30 }
  ]
}

describe('nosySort', () => {
  describe('sortShareholders', () => {
    it('returns empty for empty list', () => {
      expect(sortShareholders([], 'currentShares', 'desc')).toEqual([])
    })

    it('sorts by currentShares descending', () => {
      const sorted = sortShareholders(makeShareholders(), 'currentShares', 'desc')
      expect(sorted[0].address).toBe('0xaaa')
      expect(sorted[1].address).toBe('0xbbb')
      expect(sorted[2].address).toBe('0xccc')
    })

    it('sorts by currentShares ascending', () => {
      const sorted = sortShareholders(makeShareholders(), 'currentShares', 'asc')
      expect(sorted[0].address).toBe('0xccc')
      expect(sorted[1].address).toBe('0xbbb')
      expect(sorted[2].address).toBe('0xaaa')
    })

    it('sorts by address ascending (locale)', () => {
      const sorted = sortShareholders(makeShareholders(), 'address', 'asc')
      expect(sorted[0].address).toBe('0xaaa')
      expect(sorted[1].address).toBe('0xbbb')
      expect(sorted[2].address).toBe('0xccc')
    })

    it('sorts by firstBlock descending', () => {
      const sorted = sortShareholders(makeShareholders(), 'firstBlock', 'desc')
      expect(sorted[0].address).toBe('0xccc')
      expect(sorted[1].address).toBe('0xbbb')
      expect(sorted[2].address).toBe('0xaaa')
    })

    it('sorts by zeroedBlock with null (-1 fallback) descending', () => {
      const sorted = sortShareholders(makeShareholders(), 'zeroedBlock', 'desc')
      // 0xccc has zeroedBlock=30, others have null (-1 fallback)
      expect(sorted[0].address).toBe('0xccc')
    })

    it('does not mutate the original array', () => {
      const original = makeShareholders()
      const firstAddr = original[0].address
      sortShareholders(original, 'address', 'asc')
      expect(original[0].address).toBe(firstAddr)
    })
  })

  describe('nextSortState', () => {
    it('toggles direction when clicking same column', () => {
      expect(nextSortState('currentShares', 'desc', 'currentShares')).toEqual({ column: 'currentShares', direction: 'asc' })
      expect(nextSortState('currentShares', 'asc', 'currentShares')).toEqual({ column: 'currentShares', direction: 'desc' })
    })

    it('defaults to asc for address column', () => {
      expect(nextSortState('currentShares', 'desc', 'address')).toEqual({ column: 'address', direction: 'asc' })
    })

    it('defaults to desc for non-address columns', () => {
      expect(nextSortState('address', 'asc', 'sharesAcquired')).toEqual({ column: 'sharesAcquired', direction: 'desc' })
      expect(nextSortState('address', 'asc', 'firstBlock')).toEqual({ column: 'firstBlock', direction: 'desc' })
    })
  })

  describe('sortAriaLabel', () => {
    it('shows none when column is not active', () => {
      expect(sortAriaLabel('address', 'currentShares', 'desc')).toBe('Address, sort none. Click to sort.')
    })

    it('shows ascending when active and asc', () => {
      expect(sortAriaLabel('currentShares', 'currentShares', 'asc')).toBe('Current shares, sort ascending. Click to sort.')
    })

    it('shows descending when active and desc', () => {
      expect(sortAriaLabel('currentShares', 'currentShares', 'desc')).toBe('Current shares, sort descending. Click to sort.')
    })
  })

  describe('sortButtonLabel', () => {
    it('returns plain name when column is not active', () => {
      expect(sortButtonLabel('address', 'currentShares', 'desc')).toBe('Address')
    })

    it('appends up arrow for active ascending', () => {
      expect(sortButtonLabel('currentShares', 'currentShares', 'asc')).toBe('Current shares \u2191')
    })

    it('appends down arrow for active descending', () => {
      expect(sortButtonLabel('currentShares', 'currentShares', 'desc')).toBe('Current shares \u2193')
    })
  })
})
