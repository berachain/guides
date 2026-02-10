/**
 * Black-box unit tests for computeShareholderRegistry.
 * Input: array of events as produced by the nosy pipeline (eventName, blockNumber, args).
 * Output: ShareholderStatus[] (address, sharesAcquired, sharesDisposed, currentShares, firstBlock, zeroedBlock).
 * Implementation only reacts to SharesMinted (to, amount), SharesBurned (from, amount), Transfer (from, to, value).
 */

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

  it('computes single SharesMinted as one shareholder', () => {
    const events = [
      { eventName: 'SharesMinted', blockNumber: 100, args: { to: '0xAlice', amount: 1000n } }
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

  it('computes Transfer between two addresses', () => {
    const events = [
      { eventName: 'SharesMinted', blockNumber: 1, args: { to: '0xA', amount: 100n } },
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

  it('records zeroedBlock when shares drop below dust after SharesBurned', () => {
    const events = [
      { eventName: 'SharesMinted', blockNumber: 1, args: { to: '0xUser', amount: 1000n } },
      { eventName: 'SharesBurned', blockNumber: 2, args: { from: '0xUser', amount: 1000n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out).toHaveLength(1)
    expect(out[0].currentShares).toBe(0n)
    expect(out[0].zeroedBlock).toBe(2)
  })

  it('ignores non-share events', () => {
    const events = [
      { eventName: 'StakingPoolActivated', blockNumber: 1, args: {} },
      { eventName: 'SharesMinted', blockNumber: 2, args: { to: '0xC', amount: 1n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out).toHaveLength(1)
    expect(out[0].address.toLowerCase()).toBe('0xc')
  })

  it('sorts by block order when events are out of order', () => {
    const events = [
      { eventName: 'SharesMinted', blockNumber: 20, args: { to: '0xLate', amount: 10n } },
      { eventName: 'SharesMinted', blockNumber: 10, args: { to: '0xEarly', amount: 5n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out).toHaveLength(2)
    const early = out.find((x) => x.address.toLowerCase() === '0xearly')
    const late = out.find((x) => x.address.toLowerCase() === '0xlate')
    expect(early.firstBlock).toBe(10)
    expect(late.firstBlock).toBe(20)
  })

  it('outputs addresses with 0x prefix', () => {
    const events = [
      { eventName: 'SharesMinted', blockNumber: 1, args: { to: '0xabc', amount: 1n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out[0].address).toMatch(/^0x/)
  })
})
