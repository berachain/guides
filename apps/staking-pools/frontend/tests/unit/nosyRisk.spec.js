import { describe, it, expect } from 'vitest'
import {
  calcAvailableLiquidity,
  calcLiquidityCoverage,
  liquidityCoverageClass,
  calcFloorHeadroomWei,
  calcFloorHeadroom,
  floorHeadroomClass,
  hasBgtRedeemedInEvents
} from '../../src/utils/nosyRisk.js'

function makeNosy(overrides = {}) {
  return {
    bufferedAssets: 0n,
    stakingRewardsVaultBalance: 0n,
    allocatedWithdrawalsAmount: 0n,
    totalDeposits: 0n,
    minEffectiveBalance: 0n,
    ...overrides
  }
}

describe('nosyRisk', () => {
  describe('calcAvailableLiquidity', () => {
    it('returns 0n when nosy is null', () => {
      expect(calcAvailableLiquidity(null)).toBe(0n)
    })

    it('sums bufferedAssets and stakingRewardsVaultBalance', () => {
      const nosy = makeNosy({ bufferedAssets: 100n, stakingRewardsVaultBalance: 50n })
      expect(calcAvailableLiquidity(nosy)).toBe(150n)
    })

    it('returns 0n when both sources are zero', () => {
      expect(calcAvailableLiquidity(makeNosy())).toBe(0n)
    })
  })

  describe('calcLiquidityCoverage', () => {
    it('returns null when nosy is null', () => {
      expect(calcLiquidityCoverage(null, 0n)).toBeNull()
    })

    it('returns null when allocated withdrawals is 0', () => {
      const nosy = makeNosy({ allocatedWithdrawalsAmount: 0n })
      expect(calcLiquidityCoverage(nosy, 100n)).toBeNull()
    })

    it('returns 100 when available equals allocated', () => {
      const nosy = makeNosy({ allocatedWithdrawalsAmount: 1000n })
      expect(calcLiquidityCoverage(nosy, 1000n)).toBe(100)
    })

    it('returns 200 when available is double allocated', () => {
      const nosy = makeNosy({ allocatedWithdrawalsAmount: 500n })
      expect(calcLiquidityCoverage(nosy, 1000n)).toBe(200)
    })

    it('returns 50 when available is half allocated', () => {
      const nosy = makeNosy({ allocatedWithdrawalsAmount: 2000n })
      expect(calcLiquidityCoverage(nosy, 1000n)).toBe(50)
    })
  })

  describe('liquidityCoverageClass', () => {
    it('returns empty string for null', () => {
      expect(liquidityCoverageClass(null)).toBe('')
    })

    it('returns risk-warning below 100', () => {
      expect(liquidityCoverageClass(50)).toBe('risk-warning')
      expect(liquidityCoverageClass(99.9)).toBe('risk-warning')
    })

    it('returns risk-amber between 100 and 150', () => {
      expect(liquidityCoverageClass(100)).toBe('risk-amber')
      expect(liquidityCoverageClass(149.9)).toBe('risk-amber')
    })

    it('returns empty string at 150 and above', () => {
      expect(liquidityCoverageClass(150)).toBe('')
      expect(liquidityCoverageClass(200)).toBe('')
    })
  })

  describe('calcFloorHeadroomWei', () => {
    it('returns null when nosy is null', () => {
      expect(calcFloorHeadroomWei(null)).toBeNull()
    })

    it('returns 0n when deposits <= minEffectiveBalance', () => {
      expect(calcFloorHeadroomWei(makeNosy({ totalDeposits: 100n, minEffectiveBalance: 100n }))).toBe(0n)
      expect(calcFloorHeadroomWei(makeNosy({ totalDeposits: 50n, minEffectiveBalance: 100n }))).toBe(0n)
    })

    it('returns difference when deposits > minEffectiveBalance', () => {
      const nosy = makeNosy({ totalDeposits: 1000n, minEffectiveBalance: 800n })
      expect(calcFloorHeadroomWei(nosy)).toBe(200n)
    })
  })

  describe('calcFloorHeadroom', () => {
    it('returns null when nosy is null', () => {
      expect(calcFloorHeadroom(null)).toBeNull()
    })

    it('returns null when totalDeposits is 0', () => {
      expect(calcFloorHeadroom(makeNosy({ totalDeposits: 0n }))).toBeNull()
    })

    it('returns 0 when deposits <= minEffectiveBalance', () => {
      expect(calcFloorHeadroom(makeNosy({ totalDeposits: 100n, minEffectiveBalance: 100n }))).toBe(0)
    })

    it('returns percentage headroom', () => {
      // (1000 - 900) / 1000 = 10%
      const nosy = makeNosy({ totalDeposits: 1000n, minEffectiveBalance: 900n })
      expect(calcFloorHeadroom(nosy)).toBe(10)
    })

    it('handles large BigInt values', () => {
      const eth = 10n ** 18n
      const nosy = makeNosy({ totalDeposits: 32n * eth, minEffectiveBalance: 30n * eth })
      // (32 - 30) / 32 = 6.25%
      expect(calcFloorHeadroom(nosy)).toBe(6.25)
    })
  })

  describe('floorHeadroomClass', () => {
    it('returns empty string for null', () => {
      expect(floorHeadroomClass(null)).toBe('')
    })

    it('returns risk-warning below 5', () => {
      expect(floorHeadroomClass(0)).toBe('risk-warning')
      expect(floorHeadroomClass(4.9)).toBe('risk-warning')
    })

    it('returns risk-amber between 5 and 15', () => {
      expect(floorHeadroomClass(5)).toBe('risk-amber')
      expect(floorHeadroomClass(14.9)).toBe('risk-amber')
    })

    it('returns empty string at 15 and above', () => {
      expect(floorHeadroomClass(15)).toBe('')
      expect(floorHeadroomClass(100)).toBe('')
    })
  })

  describe('hasBgtRedeemedInEvents', () => {
    it('returns false for empty/null events', () => {
      expect(hasBgtRedeemedInEvents([])).toBe(false)
      expect(hasBgtRedeemedInEvents(null)).toBe(false)
    })

    it('returns true when BGTRedeemed event present', () => {
      expect(hasBgtRedeemedInEvents([{ eventName: 'BGTRedeemed' }])).toBe(true)
    })

    it('returns false when no BGTRedeemed event', () => {
      expect(hasBgtRedeemedInEvents([{ eventName: 'Transfer' }, { eventName: 'SharesMinted' }])).toBe(false)
    })
  })
})
