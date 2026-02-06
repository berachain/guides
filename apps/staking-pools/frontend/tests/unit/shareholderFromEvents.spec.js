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

  it('computes single SharesMinted', () => {
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

  it('computes Transfer in/out (non-mint, non-burn)', () => {
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

  it('records zeroedBlock when shares drop below dust via SharesBurned', () => {
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

  it('skips Transfer from/to zero address (mint/burn)', () => {
    const zero = '0x0000000000000000000000000000000000000000'
    const events = [
      { eventName: 'Transfer', blockNumber: 1, args: { from: zero, to: '0xA', value: 100n } },
      { eventName: 'Transfer', blockNumber: 2, args: { from: '0xA', to: zero, value: 50n } }
    ]
    const out = computeShareholderRegistry(events)
    // Both should be skipped; zero-address transfers handled by SharesMinted/SharesBurned
    expect(out).toEqual([])
  })

  it('processes events in block order regardless of input order', () => {
    const events = [
      { eventName: 'SharesBurned', blockNumber: 3, args: { from: '0xA', amount: 20n } },
      { eventName: 'SharesMinted', blockNumber: 1, args: { to: '0xA', amount: 100n } }
    ]
    const out = computeShareholderRegistry(events)
    expect(out).toHaveLength(1)
    expect(out[0].currentShares).toBe(80n)
    expect(out[0].firstBlock).toBe(1)
  })

  it('handles multiple shareholders across mixed events', () => {
    const events = [
      { eventName: 'SharesMinted', blockNumber: 1, args: { to: '0xA', amount: 500n } },
      { eventName: 'SharesMinted', blockNumber: 2, args: { to: '0xB', amount: 300n } },
      { eventName: 'Transfer', blockNumber: 3, args: { from: '0xA', to: '0xB', value: 100n } },
      { eventName: 'SharesBurned', blockNumber: 4, args: { from: '0xB', amount: 200n } }
    ]
    const out = computeShareholderRegistry(events)
    const a = out.find((x) => x.address.toLowerCase() === '0xa')
    const b = out.find((x) => x.address.toLowerCase() === '0xb')
    expect(a.currentShares).toBe(400n)
    expect(b.sharesAcquired).toBe(400n) // 300 minted + 100 transferred in
    expect(b.sharesDisposed).toBe(200n) // 200 burned
    expect(b.currentShares).toBe(200n)
  })
})
