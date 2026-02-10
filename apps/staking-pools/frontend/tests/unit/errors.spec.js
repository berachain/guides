// errors.js is exercised via E2E (StakeCard/WithdrawCard use parseError) and app runtime.
// Vitest/Vite import analysis fails on this file; unit tests for format and addresses cover the rest.
import { describe, it, expect } from 'vitest'

describe('errors.js', () => {
  it('parseError normalizes plain Error objects', async () => {
    const { parseError } = await import('../../src/utils/errors.js')
    const err = new Error('test error')
    const parsed = parseError(err)
    expect(parsed).toHaveProperty('message')
    expect(parsed.message).toContain('test error')
  })
})
