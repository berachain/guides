import { describe, it, expect } from 'vitest'
import {
  ZERO_ADDRESS,
  isValidAddress,
  isValidValidatorPubkey,
  isZeroAddress,
  normalizeAddress
} from '../../src/constants/addresses.js'

describe('addresses.js', () => {
  const validAddress = '0x1234567890123456789012345678901234567890'
  const validPubkey = '0x' + 'a'.repeat(96)

  describe('isValidAddress', () => {
    it('returns false for null or undefined', () => {
      expect(isValidAddress(null)).toBe(false)
      expect(isValidAddress(undefined)).toBe(false)
    })
    it('returns false for non-string', () => {
      expect(isValidAddress(123)).toBe(false)
    })
    it('returns false for too short', () => {
      expect(isValidAddress('0x1234')).toBe(false)
    })
    it('returns false for wrong length (no 0x)', () => {
      expect(isValidAddress('1234567890123456789012345678901234567890')).toBe(false)
    })
    it('returns true for valid 40-char hex with 0x', () => {
      expect(isValidAddress(validAddress)).toBe(true)
      expect(isValidAddress('0xAbCdEf123456789012345678901234567890abcd')).toBe(true)
    })
  })

  describe('isValidValidatorPubkey', () => {
    it('returns false for null or undefined', () => {
      expect(isValidValidatorPubkey(null)).toBe(false)
      expect(isValidValidatorPubkey(undefined)).toBe(false)
    })
    it('returns false for 40-char address', () => {
      expect(isValidValidatorPubkey(validAddress)).toBe(false)
    })
    it('returns false for 94-char hex (96 hex without 0x)', () => {
      expect(isValidValidatorPubkey('0x' + 'a'.repeat(94))).toBe(false)
    })
    it('returns true for 98-char hex (0x + 96)', () => {
      expect(isValidValidatorPubkey(validPubkey)).toBe(true)
    })
  })

  describe('isZeroAddress', () => {
    it('returns true for zero address', () => {
      expect(isZeroAddress(ZERO_ADDRESS)).toBe(true)
      expect(isZeroAddress('0x0000000000000000000000000000000000000000')).toBe(true)
    })
    it('returns false for non-zero', () => {
      expect(isZeroAddress(validAddress)).toBe(false)
    })
  })

  describe('normalizeAddress', () => {
    it('returns null for invalid address', () => {
      expect(normalizeAddress('invalid')).toBe(null)
    })
    it('returns lowercase for valid address', () => {
      expect(normalizeAddress(validAddress)).toBe(validAddress.toLowerCase())
    })
  })
})
