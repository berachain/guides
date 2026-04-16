import type { Address, Hex } from 'viem'

/**
 * Result of `wallet_getSupportedExecutionPermissions` (ERC-7715 execution permissions probe).
 * Keys are permission type identifiers; values list supported chains and rule types.
 */
export type GetSupportedExecutionPermissionsResult = Record<
  string,
  {
    chainIds: `0x${string}`[]
    ruleTypes: string[]
  }
>

/** `permission.data` for `native-token-allowance` (hex-encoded uint256). */
export type NativeTokenAllowanceData = {
  allowance: `0x${string}`
}

/** `permission.data` for `erc20-token-allowance`. */
export type ERC20TokenAllowanceData = {
  tokenAddress: `0x${string}`
  allowance: `0x${string}`
  periodAmount: `0x${string}`
  periodDuration: number
}

/** `permission.data` for `erc20-token-periodic` (no top-level allowance). */
export type ERC20TokenPeriodicData = {
  tokenAddress: `0x${string}`
  periodAmount: `0x${string}`
  periodDuration: number
}

/** Base permission shape per ERC-7715. */
export type ExecutionPermissionPayload = {
  type: string
  isAdjustmentAllowed: boolean
  data: Record<string, unknown>
}

/** Base rule shape per ERC-7715 (e.g. expiry). */
export type ExecutionPermissionRule = {
  type: string
  data: Record<string, unknown>
}

/** Expiry rule from ERC-7715 — constrains validity until a unix timestamp (seconds). */
export type ExpiryRule = ExecutionPermissionRule & {
  type: 'expiry'
  data: {
    timestamp: number
  }
}

/**
 * Single permission request per ERC-7715 `wallet_requestExecutionPermissions`.
 */
export type PermissionRequest = {
  chainId: Hex
  from?: Address
  to: Address
  permission: ExecutionPermissionPayload
  rules?: ExecutionPermissionRule[]
}

/** Counterparty / 4337 dependency entry returned by the wallet. */
export type PermissionDependency = {
  factory: `0x${string}`
  factoryData: `0x${string}`
}

/**
 * Wallet response for a granted permission (echoes the request plus ERC-7715 response fields).
 */
export type PermissionResponse = PermissionRequest & {
  context: Hex
  dependencies: PermissionDependency[]
  delegationManager: `0x${string}`
}
