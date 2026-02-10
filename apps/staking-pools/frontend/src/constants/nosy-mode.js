/**
 * Nosy Mode: historical event scanning and cache.
 * See project/briefs/staking-pool-nosy-mode.md.
 */

/** Many RPCs (including Berachain public) limit eth_getLogs to 10k blocks per request. */
export const ETH_GETLOGS_MAX_RANGE = 10_000

/** Minimum delay (ms) between successive eth_getLogs calls when chunking. */
export const GETLOGS_DELAY_MS = 1_000

export const SCAN_BATCH_SIZE = 10_000
export const SCAN_DELAY_MS = 1_000
export const TIP_POLL_INTERVAL_MS = 15_000

/** Staking pools did not exist before this block; no point scanning earlier. */
export const STAKING_POOL_GENESIS_BLOCK = 15_000_000
export const BLOCK_TIME_SECONDS = 2
export const DUST_THRESHOLD_WEI = 5n * 10n ** 15n // 0.005 stBERA

/** Event names we scan and cache */
export const NOSY_EVENT_NAMES = Object.freeze([
  'Initialized',
  'SharesMinted',
  'SharesBurned',
  'DepositSubmitted',
  'WithdrawalRequested',
  'WithdrawalRequestFinalized',
  'Transfer',
  'StakingPoolActivated',
  'StakingPoolContractsDeployed',
  'BGTRedeemed',
  'StakingRewardsReceived',
  'TotalDepositsUpdated'
])

export const DB_NAME = 'nosy-mode'
export const DB_VERSION = 1
export const STORE_POOLS = 'pools'
export const STORE_EVENTS = 'events'
export const STORE_SCANNED_RANGES = 'scannedRanges'
