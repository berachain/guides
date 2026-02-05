import { describe, it, expect } from 'vitest'
import {
  calculateExchangeRate,
  formatBeraDisplay,
  formatNumber,
  formatTimeRemaining,
  shortAddress,
  validateAmount
} from '../../src/utils/format.js'

describe('format.js', () => {
  describe('calculateExchangeRate', () => {
    it('returns 1 when totalSupply is zero', () => {
      expect(calculateExchangeRate(1000n, 0n)).toBe(1)
    })
    it('returns correct rate when supply and assets are equal', () => {
      expect(calculateExchangeRate(1000n, 1000n)).toBe(1)
    })
    it('returns correct rate for non-trivial values', () => {
      const rate = calculateExchangeRate(10_000_000n, 8_000_000n)
      expect(rate).toBe(1.25)
    })
  })

  describe('formatBeraDisplay', () => {
    it('returns null for null or undefined', () => {
      expect(formatBeraDisplay(null)).toBe(null)
      expect(formatBeraDisplay(undefined)).toBe(null)
    })
    it('formats number with default decimals', () => {
      expect(formatBeraDisplay(1234.5678)).toBe('1,234.5678')
    })
    it('formats number with 4 decimals', () => {
      expect(formatBeraDisplay(1)).toBe('1.0000')
    })
    it('respects decimals option', () => {
      expect(formatBeraDisplay(1.5, { decimals: 2 })).toBe('1.50')
    })
  })

  describe('formatNumber', () => {
    it('returns em dash for non-finite', () => {
      expect(formatNumber(NaN)).toBe('—')
      expect(formatNumber(Infinity)).toBe('—')
    })
    it('formats small numbers with decimals', () => {
      expect(formatNumber(1.5)).toBe('1.50')
      expect(formatNumber(1.5, 4)).toBe('1.5000')
    })
    it('abbreviates thousands', () => {
      expect(formatNumber(1500)).toBe('1.50K')
      expect(formatNumber(1500, 0)).toBe('2K')
    })
    it('abbreviates millions', () => {
      expect(formatNumber(1_500_000)).toBe('1.50M')
    })
    it('accepts prefix option', () => {
      expect(formatNumber(100, 0, { prefix: '$' })).toBe('$100')
      expect(formatNumber(100, 2, { prefix: '$' })).toBe('$100.00')
    })
  })

  describe('formatTimeRemaining', () => {
    it('returns Ready for zero or negative', () => {
      expect(formatTimeRemaining(0)).toBe('Ready')
      expect(formatTimeRemaining(-1)).toBe('Ready')
    })
    it('formats minutes only', () => {
      expect(formatTimeRemaining(120)).toBe('~2m')
    })
    it('formats hours and minutes', () => {
      expect(formatTimeRemaining(3661)).toBe('~1h 1m')
    })
  })

  describe('shortAddress', () => {
    it('returns empty for empty or non-string', () => {
      expect(shortAddress('')).toBe('')
      expect(shortAddress(null)).toBe('')
    })
    it('returns truncated address with default lengths', () => {
      const addr = '0x1234567890123456789012345678901234567890'
      expect(shortAddress(addr)).toBe('0x1234…7890')
    })
    it('returns full string if too short', () => {
      expect(shortAddress('0x1234')).toBe('0x1234')
    })
  })

  describe('validateAmount', () => {
    it('returns invalid for null or undefined', () => {
      expect(validateAmount(null)).toEqual({ valid: false, value: null, error: 'Enter an amount.' })
      expect(validateAmount(undefined)).toEqual({ valid: false, value: null, error: 'Enter an amount.' })
    })
    it('returns invalid for empty string', () => {
      expect(validateAmount('')).toEqual({ valid: false, value: null, error: 'Enter an amount.' })
      expect(validateAmount('   ')).toEqual({ valid: false, value: null, error: 'Enter an amount.' })
    })
    it('returns invalid for zero or negative', () => {
      expect(validateAmount('0')).toEqual({ valid: false, value: null, error: 'Enter a valid amount.' })
      expect(validateAmount('-1')).toEqual({ valid: false, value: null, error: 'Enter a valid amount.' })
    })
    it('returns invalid for non-numeric', () => {
      expect(validateAmount('abc')).toEqual({ valid: false, value: null, error: 'Enter a valid amount.' })
    })
    it('returns valid for positive number string', () => {
      expect(validateAmount('1.5')).toEqual({ valid: true, value: 1.5, error: null })
      expect(validateAmount('  2  ')).toEqual({ valid: true, value: 2, error: null })
    })
  })
})
