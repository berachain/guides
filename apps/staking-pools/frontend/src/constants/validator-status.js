/**
 * Validator status values from beacon chain.
 * 
 * Status flow:
 * - pending_initialized → active_ongoing → exited_*
 * 
 * Exit states indicate validator has exited from active set.
 * Pool deposits are disabled for exited validators.
 */

export const VALIDATOR_STATUS = Object.freeze({
  PENDING_INITIALIZED: 'pending_initialized',
  PENDING_QUEUED: 'pending_queued',
  ACTIVE_ONGOING: 'active_ongoing',
  ACTIVE_EXITING: 'active_exiting',
  ACTIVE_SLASHED: 'active_slashed',
  EXITED_UNSLASHED: 'exited_unslashed',
  EXITED_SLASHED: 'exited_slashed',
  WITHDRAWAL_POSSIBLE: 'withdrawal_possible',
  WITHDRAWAL_DONE: 'withdrawal_done'
})

/**
 * Check if validator has exited (any exit state).
 * @param {string} status - Validator status from beacon chain
 * @returns {boolean}
 */
export function isExitedStatus(status) {
  if (!status) return false
  return status.startsWith('exited_') || status.startsWith('withdrawal_')
}

/**
 * Check if validator is active (can accept deposits).
 * @param {string} status - Validator status from beacon chain
 * @returns {boolean}
 */
export function isActiveStatus(status) {
  return status === VALIDATOR_STATUS.ACTIVE_ONGOING
}

/**
 * Check if validator is pending activation.
 * @param {string} status - Validator status from beacon chain
 * @returns {boolean}
 */
export function isPendingStatus(status) {
  if (!status) return false
  return status.startsWith('pending_')
}
