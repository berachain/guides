/**
 * Common contract addresses and constants
 */

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

/**
 * Validates an Ethereum address (0x + 40 hex chars).
 * @param {string} address - Address to validate
 * @returns {boolean} - True if valid address format
 */
export function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Validates a validator public key (0x + 96 hex chars = 98 chars total).
 * @param {string} pubkey - Validator pubkey to validate
 * @returns {boolean} - True if valid format
 */
export function isValidValidatorPubkey(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') return false
  return /^0x[a-fA-F0-9]{96}$/.test(pubkey)
}

/**
 * Checks if an address is the zero address
 * @param {string} address - Address to check
 * @returns {boolean} - True if zero address
 */
export function isZeroAddress(address) {
  return address?.toLowerCase() === ZERO_ADDRESS.toLowerCase()
}

/**
 * Normalizes an address to lowercase for comparison
 * @param {string} address - Address to normalize
 * @returns {string} - Normalized address
 */
export function normalizeAddress(address) {
  if (!isValidAddress(address)) return null
  return address.toLowerCase()
}
