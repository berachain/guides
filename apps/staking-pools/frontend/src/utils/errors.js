/**
 * Shared error types and parsing for consistent UI messaging.
 * Use parseError(err) in catch blocks before setting component error state or passing to ErrorDisplay.
 */

export class ValidationError extends Error {
  /** @param {string} message @param {string} [field] */
  constructor(message, field = '') {
    super(message)
    this.name = 'ValidationError'
    this.field = field
  }
}

export class PoolStateError extends Error {
  /** @param {string} message @param {string} [poolAddress] @param {string} [state] */
  constructor(message, poolAddress = '', state = '') {
    super(message)
    this.name = 'PoolStateError'
    this.poolAddress = poolAddress
    this.state = state
  }
}

/** @param {string} raw @returns {string} */
function errorSummary(raw) {
  if (!raw || typeof raw !== 'string') return 'Something went wrong.'
  const s = raw.toLowerCase()
  if (s.includes('user rejected') || s.includes('user denied') || s.includes('rejected')) return 'Transaction declined in wallet.'
  if (s.includes('insufficient funds') || s.includes('insufficient balance')) return 'Insufficient balance for gas or amount.'
  if (s.includes('pool has exited') || s.includes('deposits are disabled')) return 'Pool has exited; deposits are disabled.'
  return 'Something went wrong.'
}

/** @param {unknown} err @returns {{ message: string, summary?: string, code?: string }} */
export function parseError(err) {
  if (err instanceof ValidationError || err instanceof PoolStateError) {
    return {
      message: err.message,
      summary: errorSummary(err.message),
      code: err.name
    }
  }
  if (err instanceof Error) {
    return {
      message: err.message,
      summary: errorSummary(err.message)
    }
  }
  if (typeof err === 'string') {
    return {
      message: err,
      summary: errorSummary(err)
    }
  }
  return {
    message: String(err),
    summary: 'Something went wrong.'
  }
}
