import { describe, it, expect } from 'vitest'
import { computeShareholderRegistry } from '../../src/utils/shareholderFromEvents.js'

describe('computeShareholderRegistry', () => {
  it('returns empty array for empty events', () => {
    expect(computeShareholderRegistry([])).toEqual([])
  })

  it('returns empty array for non-array', () => {
    expect(computeShareholderRegistry(null)).toEqual([])
    expect(computeShareholderRegistry(undefined)).toEqual([])
  })

  it('computes single DepositSubmitted', () => {
    const events = [
      { eventName: 'DepositSubmitted', blockNumber: 100, args: { receiver: '0xAlice', shares: 1000n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out).toHaveLength(1)
    expect(out[0].address.toLowerCase()).toBe('0xalice')
    expect(out[0].sharesAcquired).toBe(1000n)
    expect(out[0].sharesDisposed).toBe(0n)
    expect(out[0].currentShares).toBe(1000n)
    expect(out[0].firstBlock).toBe(100)
    expect(out[0].zeroedBlock).toBeNull()
  })

  it('computes Transfer in/out', () => {
    const events = [
      { eventName: 'DepositSubmitted', blockNumber: 1, args: { receiver: '0xA', shares: 100n } },
      { eventName: 'Transfer', blockNumber: 2, args: { from: '0xA', to: '0xB', value: 50n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out).toHaveLength(2)
    const a = out.find((x) => x.address.toLowerCase() === '0xa')
    const b = out.find((x) => x.address.toLowerCase() === '0xb')
    expect(a.sharesAcquired).toBe(100n)
    expect(a.sharesDisposed).toBe(50n)
    expect(a.currentShares).toBe(50n)
    expect(b.sharesAcquired).toBe(50n)
    expect(b.sharesDisposed).toBe(0n)
    expect(b.currentShares).toBe(50n)
    expect(b.firstBlock).toBe(2)
  })

  it('records zeroedBlock when shares drop below dust', () => {
    const events = [
      { eventName: 'DepositSubmitted', blockNumber: 1, args: { receiver: '0xUser', shares: 1000n } },
      { eventName: 'WithdrawalRequested', blockNumber: 2, args: { user: '0xUser', amountOfShares: 1000n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out).toHaveLength(1)
    expect(out[0].currentShares).toBe(0n)
    expect(out[0].zeroedBlock).toBe(2)
  })

  it('ignores non-share events', () => {
    const events = [
      { eventName: 'StakingPoolActivated', blockNumber: 1, args: {} },
      { eventName: 'DepositSubmitted', blockNumber: 2, args: { receiver: '0xC', shares: 1n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out).toHaveLength(1)
    expect(out[0].address.toLowerCase()).toBe('0xc')
  })
})
