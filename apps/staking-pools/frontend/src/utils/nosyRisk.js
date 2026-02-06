/**
 * Nosy Mode risk computation functions.
 * Pure BigInt math extracted from NosyView for testability.
 */

/**
 * @typedef {Object} NosyData
 * @property {bigint} bufferedAssets
 * @property {bigint} stakingRewardsVaultBalance
 * @property {bigint} allocatedWithdrawalsAmount
 * @property {bigint} totalDeposits
 * @property {bigint} minEffectiveBalance
 */

/**
 * Liquid BERA available for withdrawals immediately.
 * @param {NosyData|null} nosy
 * @returns {bigint}
 */
export function calcAvailableLiquidity(nosy) {
  if (!nosy) return 0n
  return nosy.bufferedAssets + nosy.stakingRewardsVaultBalance
}

/**
 * Liquidity coverage as a percentage (null when allocated is 0).
 * @param {NosyData|null} nosy
 * @param {bigint} availableLiquidity
 * @returns {number|null}
 */
export function calcLiquidityCoverage(nosy, availableLiquidity) {
  if (!nosy) return null
  const allocated = nosy.allocatedWithdrawalsAmount
  if (allocated === 0n) return null
  return Number((availableLiquidity * 10000n) / allocated) / 100
}

/**
 * CSS class for liquidity coverage risk level.
 * @param {number|null} coverage
 * @returns {string}
 */
export function liquidityCoverageClass(coverage) {
  if (coverage == null) return ''
  if (coverage < 100) return 'risk-warning'
  if (coverage < 150) return 'risk-amber'
  return ''
}

/**
 * Headroom in wei between total deposits and minimum effective balance.
 * @param {NosyData|null} nosy
 * @returns {bigint|null}
 */
export function calcFloorHeadroomWei(nosy) {
  if (!nosy) return null
  const td = nosy.totalDeposits
  const minEff = nosy.minEffectiveBalance
  if (td <= minEff) return 0n
  return td - minEff
}

/**
 * Headroom as a percentage (null when totalDeposits is 0).
 * @param {NosyData|null} nosy
 * @returns {number|null}
 */
export function calcFloorHeadroom(nosy) {
  if (!nosy) return null
  const td = nosy.totalDeposits
  if (td === 0n) return null
  const minEff = nosy.minEffectiveBalance
  if (td <= minEff) return 0
  return Number(((td - minEff) * 10000n) / td) / 100
}

/**
 * CSS class for floor headroom risk level.
 * @param {number|null} headroom
 * @returns {string}
 */
export function floorHeadroomClass(headroom) {
  if (headroom == null) return ''
  if (headroom < 5) return 'risk-warning'
  if (headroom < 15) return 'risk-amber'
  return ''
}

/**
 * Whether any BGTRedeemed event exists in the events list.
 * @param {Array<{ eventName: string }>} events
 * @returns {boolean}
 */
export function hasBgtRedeemedInEvents(events) {
  return (events || []).some(e => e.eventName === 'BGTRedeemed')
}
