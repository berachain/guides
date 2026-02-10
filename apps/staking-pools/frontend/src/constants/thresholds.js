export const DEAD_POOL_THRESHOLD_WEI = 5_000_000_000_000_000n // 0.005 BERA
export const GAS_RESERVE_BERA = 0.01
export const DEBOUNCE_MS = 300
export const REFRESH_INTERVAL_MS = 15000
export const SECONDS_PER_BLOCK = 2

// Slippage tolerance: 0.5% (50 basis points)
// If user expects 100 shares but gets < 99.5, transaction reverts
export const DEFAULT_SLIPPAGE_BPS = 50n // 0.5%
export const MAX_SLIPPAGE_BPS = 1000n // 10%
export const BASIS_POINTS = 10000n
