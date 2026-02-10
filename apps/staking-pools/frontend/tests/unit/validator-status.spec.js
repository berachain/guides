/**
 * Unit tests for validator status helpers.
 * Black box testing - validate status classification functions.
 */

import { describe, it, expect } from 'vitest'
import { 
  VALIDATOR_STATUS, 
  isExitedStatus, 
  isActiveStatus, 
  isPendingStatus 
} from '../../src/constants/validator-status.js'

describe('validator status helpers', () => {
  describe('isExitedStatus', () => {
    it('returns true for exited_unslashed', () => {
      expect(isExitedStatus('exited_unslashed')).toBe(true)
    })

    it('returns true for exited_slashed', () => {
      expect(isExitedStatus('exited_slashed')).toBe(true)
    })

    it('returns true for withdrawal states', () => {
      expect(isExitedStatus('withdrawal_possible')).toBe(true)
      expect(isExitedStatus('withdrawal_done')).toBe(true)
    })

    it('returns false for active states', () => {
      expect(isExitedStatus('active_ongoing')).toBe(false)
      expect(isExitedStatus('active_exiting')).toBe(false)
    })

    it('returns false for pending states', () => {
      expect(isExitedStatus('pending_initialized')).toBe(false)
      expect(isExitedStatus('pending_queued')).toBe(false)
    })

    it('returns false for null/undefined', () => {
      expect(isExitedStatus(null)).toBe(false)
      expect(isExitedStatus(undefined)).toBe(false)
    })
  })

  describe('isActiveStatus', () => {
    it('returns true only for active_ongoing', () => {
      expect(isActiveStatus('active_ongoing')).toBe(true)
    })

    it('returns false for other active states', () => {
      expect(isActiveStatus('active_exiting')).toBe(false)
      expect(isActiveStatus('active_slashed')).toBe(false)
    })

    it('returns false for exited states', () => {
      expect(isActiveStatus('exited_unslashed')).toBe(false)
      expect(isActiveStatus('exited_slashed')).toBe(false)
    })

    it('returns false for pending states', () => {
      expect(isActiveStatus('pending_initialized')).toBe(false)
    })
  })

  describe('isPendingStatus', () => {
    it('returns true for pending_initialized', () => {
      expect(isPendingStatus('pending_initialized')).toBe(true)
    })

    it('returns true for pending_queued', () => {
      expect(isPendingStatus('pending_queued')).toBe(true)
    })

    it('returns false for active states', () => {
      expect(isPendingStatus('active_ongoing')).toBe(false)
    })

    it('returns false for exited states', () => {
      expect(isPendingStatus('exited_unslashed')).toBe(false)
    })

    it('returns false for null/undefined', () => {
      expect(isPendingStatus(null)).toBe(false)
      expect(isPendingStatus(undefined)).toBe(false)
    })
  })

  describe('VALIDATOR_STATUS constants', () => {
    it('exports all expected status values', () => {
      expect(VALIDATOR_STATUS.PENDING_INITIALIZED).toBe('pending_initialized')
      expect(VALIDATOR_STATUS.PENDING_QUEUED).toBe('pending_queued')
      expect(VALIDATOR_STATUS.ACTIVE_ONGOING).toBe('active_ongoing')
      expect(VALIDATOR_STATUS.ACTIVE_EXITING).toBe('active_exiting')
      expect(VALIDATOR_STATUS.ACTIVE_SLASHED).toBe('active_slashed')
      expect(VALIDATOR_STATUS.EXITED_UNSLASHED).toBe('exited_unslashed')
      expect(VALIDATOR_STATUS.EXITED_SLASHED).toBe('exited_slashed')
      expect(VALIDATOR_STATUS.WITHDRAWAL_POSSIBLE).toBe('withdrawal_possible')
      expect(VALIDATOR_STATUS.WITHDRAWAL_DONE).toBe('withdrawal_done')
    })

    it('is frozen (immutable)', () => {
      expect(() => {
        VALIDATOR_STATUS.NEW_STATUS = 'something'
      }).toThrow()
    })
  })
})
