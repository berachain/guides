import { describe, it, expect } from 'vitest'
import { formatWei, formatWeiCompact, formatProtocolFee, shortAddr } from '../../src/utils/nosyFormat.js'

describe('nosyFormat', () => {
  describe('formatWei', () => {
    it('returns em-dash for null/undefined', () => {
      expect(formatWei(null)).toBe('\u2014')
      expect(formatWei(undefined)).toBe('\u2014')
    })

    it('formats 0n', () => {
      expect(formatWei(0n)).toBe('0.0000')
    })

    it('formats 1 ETH (10^18 wei)', () => {
      const oneEth = 10n ** 18n
      expect(formatWei(oneEth)).toBe('1.0000')
    })

    it('formats large values with grouping', () => {
      const val = 1_234_567n * 10n ** 14n // 123.4567 ETH
      expect(formatWei(val)).toBe('123.4567')
    })
  })

  describe('formatWeiCompact', () => {
    it('returns em-dash for null/undefined', () => {
      expect(formatWeiCompact(null)).toBe('\u2014')
      expect(formatWeiCompact(undefined)).toBe('\u2014')
    })

    it('formats 0n', () => {
      expect(formatWeiCompact(0n)).toBe('0.0')
    })

    it('formats large values with K/M suffix', () => {
      const val = 1500n * 10n ** 18n // 1500 ETH
      expect(formatWeiCompact(val)).toBe('1.50K')
    })
  })

  describe('formatProtocolFee', () => {
    it('returns em-dash for null nosy', () => {
      expect(formatProtocolFee(null)).toBe('\u2014')
    })

    it('returns em-dash when bgtHeld or rebaseable is null', () => {
      expect(formatProtocolFee({ bgtBalanceOfSmartOperator: null, bgtFeeState: null, rebaseableBgtAmount: null })).toBe('\u2014')
    })

    it('returns em-dash when fee is zero or negative', () => {
      expect(formatProtocolFee({
        bgtBalanceOfSmartOperator: 100n,
        rebaseableBgtAmount: 100n
      })).toBe('\u2014')

      expect(formatProtocolFee({
        bgtBalanceOfSmartOperator: 50n,
        rebaseableBgtAmount: 100n
      })).toBe('\u2014')
    })

    it('formats positive fee in parentheses', () => {
      const fee = 10n ** 18n // 1 ETH fee
      const result = formatProtocolFee({
        bgtBalanceOfSmartOperator: 2n * 10n ** 18n,
        rebaseableBgtAmount: 1n * 10n ** 18n
      })
      expect(result).toBe('(1.0000)')
    })

    it('falls back to bgtFeeState.currentBalance when bgtBalanceOfSmartOperator is null', () => {
      const result = formatProtocolFee({
        bgtBalanceOfSmartOperator: null,
        bgtFeeState: { currentBalance: 2n * 10n ** 18n },
        rebaseableBgtAmount: 1n * 10n ** 18n
      })
      expect(result).toBe('(1.0000)')
    })
  })

  describe('shortAddr', () => {
    it('returns empty string for null/undefined/non-string', () => {
      expect(shortAddr(null)).toBe('')
      expect(shortAddr(undefined)).toBe('')
      expect(shortAddr(42)).toBe('')
    })

    it('returns full address when short enough', () => {
      expect(shortAddr('0x1234567890ab')).toBe('0x1234567890ab')
    })

    it('truncates long addresses', () => {
      const addr = '0x1234567890123456789012345678901234567890'
      expect(shortAddr(addr)).toBe('0x123456\u20267890')
    })

    it('handles addresses without 0x prefix', () => {
      const addr = '1234567890123456789012345678901234567890'
      expect(shortAddr(addr)).toBe('0x123456\u20267890')
    })
  })
})
