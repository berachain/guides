'use client'

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { getAddress, isAddress, numberToHex, parseEther, parseUnits, toHex } from 'viem'
import { useChainId, useConnection } from 'wagmi'
import { UnsupportedBanner } from '@/components/UnsupportedBanner'
import { useRequestPermissions } from '@/hooks/useRequestPermissions'
import type { StoredGrant } from '@/hooks/useStoredPermission'
import { env } from '@/lib/env'
import type {
  ERC20TokenAllowanceData,
  ERC20TokenPeriodicData,
  GetSupportedExecutionPermissionsResult,
  NativeTokenAllowanceData,
  PermissionRequest,
  PermissionResponse,
} from '@/types/erc7715'

/** Phase-1 / wallet audit: ERC-20 types that share {@link ERC20TokenAllowanceData} (extend with `startsWith` below). */
const ERC20_TOKEN_ALLOWANCE_LIKE_TYPES = [
  'erc20-token-allowance',
  'erc20-token-periodic',
  'erc20-token-stream',
  'erc20-token-revocation',
] as const

/** Phase-1 audit: native types that share {@link NativeTokenAllowanceData} (single allowance; extend with `startsWith` below). */
const NATIVE_TOKEN_ALLOWANCE_LIKE_TYPES = [
  'native-token-allowance',
  'native-token-periodic',
  'native-token-stream',
] as const

/**
 * Same editor + `permission.data` as `erc20-token-allowance` (tokenAddress, allowance, periodAmount, periodDuration).
 * Covers audited ids and any other `erc20-token-*` reported by the wallet.
 */
function isErc20TokenAllowanceLikeType(selectedType: string): boolean {
  return (
    (ERC20_TOKEN_ALLOWANCE_LIKE_TYPES as readonly string[]).includes(selectedType) ||
    selectedType.startsWith('erc20-token-')
  )
}

function isErc20AllowanceType(selectedType: string): boolean {
  return selectedType === 'erc20-token-allowance'
}

/**
 * Same editor + `permission.data` as `native-token-allowance` (hex allowance only).
 * Covers audited ids and any other `native-token-*` reported by the wallet.
 */
function isNativeTokenAllowanceLikeType(selectedType: string): boolean {
  return (
    (NATIVE_TOKEN_ALLOWANCE_LIKE_TYPES as readonly string[]).includes(selectedType) ||
    selectedType.startsWith('native-token-')
  )
}

/** Default ERC-20 form parsing: standard 18-decimal tokens. */
const ERC20_FORM_DECIMALS = 18
const PERIOD_PRESETS = [
  { label: 'Hourly', seconds: 3600 },
  { label: 'Daily', seconds: 86400 },
  { label: 'Weekly', seconds: 604800 },
  { label: 'Biweekly', seconds: 1209600 },
  { label: 'Monthly', seconds: 2592000 },
  { label: 'Yearly', seconds: 31536000 },
] as const

function uint256HexFromBigInt(value: bigint): `0x${string}` {
  return toHex(value, { size: 32 })
}

function truncateAddress(address: string): string {
  if (!address.startsWith('0x') || address.length < 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatLocalDateTime(timestampSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestampSeconds * 1000))
}

function defaultExpiryAfterHours(hours: number): { date: string; time: string } {
  const d = new Date(Date.now() + hours * 3600000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  }
}

/** Combines native `date` + `time` (local) into unix seconds for the `expiry` rule. */
function parseDateAndTimeToUnixSeconds(date: string, time: string): number {
  if (!date?.trim() || !time?.trim()) {
    return Math.floor(Date.now() / 1000) + 3600
  }
  const ms = new Date(`${date.trim()}T${time.trim()}`).getTime()
  if (Number.isNaN(ms)) {
    return Math.floor(Date.now() / 1000) + 3600
  }
  return Math.floor(ms / 1000)
}

function WalletAdjustedBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
      adjusted
    </span>
  )
}

function PermissionResponseCard({
  response,
  submitted,
}: {
  response: PermissionResponse
  submitted: PermissionRequest
}) {
  const chainAdjusted = submitted.chainId.toLowerCase() !== response.chainId.toLowerCase()
  const toAdjusted = submitted.to.toLowerCase() !== response.to.toLowerCase()
  const fromAdjusted =
    (submitted.from?.toLowerCase() ?? '') !== (response.from?.toLowerCase() ?? '')

  const permTypeAdjusted = submitted.permission.type !== response.permission.type
  const permAdjAdjusted =
    submitted.permission.isAdjustmentAllowed !== response.permission.isAdjustmentAllowed
  const permDataAdjusted =
    JSON.stringify(submitted.permission.data) !== JSON.stringify(response.permission.data)

  const subExpiry = submitted.rules?.find((r) => r.type === 'expiry')
  const resExpiry = response.rules?.find((r) => r.type === 'expiry')
  const expiryAdjusted =
    JSON.stringify(subExpiry?.data ?? null) !== JSON.stringify(resExpiry?.data ?? null)

  return (
    <div className="mt-6 rounded-xl border border-[#22C55E]/40 bg-emerald-500/15 p-4">
      <h3 className="text-sm font-semibold text-[#22C55E]">Granted permission</h3>
      <p className="mt-1 text-xs text-emerald-200/90">
        The wallet echoed your request and may have changed fields when <code className="font-mono">isAdjustmentAllowed</code>{' '}
        was true. Highlighted rows differ from what you submitted.
      </p>

      <dl className="mt-4 space-y-3 text-xs">
        <div>
          <dt className="font-medium text-zinc-400">context</dt>
          <dd className="mt-0.5 break-all font-mono text-[11px] text-zinc-100">{response.context}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-400">delegationManager</dt>
          <dd className="mt-0.5 break-all font-mono text-[11px] text-zinc-100">
            {response.delegationManager}
          </dd>
        </div>
        <div>
          <dt className="flex items-center font-medium text-zinc-400">
            dependencies
            {response.dependencies.length > 0 ? (
              <span className="ml-2 font-normal text-zinc-500">({response.dependencies.length})</span>
            ) : null}
          </dt>
          <dd className="mt-1 space-y-2">
            {response.dependencies.length === 0 ? (
              <span className="text-zinc-400">None (accounts already deployed)</span>
            ) : (
              response.dependencies.map((dep, i) => (
                <div
                  key={`${dep.factory}-${i}`}
                  className="rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] p-2"
                >
                  <p className="font-mono text-[10px] text-zinc-200">
                    <span className="text-zinc-500">factory</span> {dep.factory}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10px] text-zinc-300">
                    <span className="text-zinc-500">factoryData</span> {dep.factoryData.slice(0, 42)}…
                  </p>
                </div>
              ))
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-[#22C55E]/40 pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Echoed permission
        </h4>
        <ul className="mt-2 space-y-2 font-mono text-[11px] text-zinc-100">
          <li className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-zinc-500">chainId</span>
            {response.chainId}
            {chainAdjusted ? <WalletAdjustedBadge /> : null}
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-zinc-500">from</span>
            {response.from ?? '—'}
            {fromAdjusted ? <WalletAdjustedBadge /> : null}
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-zinc-500">to</span>
            {response.to}
            {toAdjusted ? <WalletAdjustedBadge /> : null}
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-zinc-500">permission.type</span>
            {response.permission.type}
            {permTypeAdjusted ? <WalletAdjustedBadge /> : null}
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-zinc-500">permission.isAdjustmentAllowed</span>
            {String(response.permission.isAdjustmentAllowed)}
            {permAdjAdjusted ? <WalletAdjustedBadge /> : null}
          </li>
          <li>
            <span className="text-zinc-500">permission.data</span>
            {permDataAdjusted ? <WalletAdjustedBadge /> : null}
            <pre className="mt-1 max-h-32 overflow-auto rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] p-2 text-[10px]">
              {JSON.stringify(response.permission.data, null, 2)}
            </pre>
          </li>
          <li>
            <span className="text-zinc-500">rules (expiry)</span>
            {expiryAdjusted ? <WalletAdjustedBadge /> : null}
            <pre className="mt-1 max-h-24 overflow-auto rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] p-2 text-[10px]">
              {JSON.stringify(response.rules ?? [], null, 2)}
            </pre>
          </li>
        </ul>
      </div>

      <p className="mt-4 text-[11px] italic text-zinc-400">
        Use the <strong>Redeem permissions</strong> section below to execute against this grant.
      </p>
    </div>
  )
}

export type RequestPermissionsFormProps = {
  supported: GetSupportedExecutionPermissionsResult
  storedGrant?: StoredGrant | null
  onGrantChange?: (grant: StoredGrant | null) => void
}

export function RequestPermissionsForm({ supported, storedGrant, onGrantChange }: RequestPermissionsFormProps) {
  const { address } = useConnection()
  const chainIdNum = useChainId()
  const requestMutation = useRequestPermissions()

  const permissionKeys = useMemo(() => Object.keys(supported).sort(), [supported])

  const [permissionType, setPermissionType] = useState(() => permissionKeys[0] ?? '')
  useEffect(() => {
    if (permissionKeys.length === 0) return
    if (!permissionKeys.includes(permissionType)) {
      setPermissionType(permissionKeys[0]!)
    }
  }, [permissionKeys, permissionType])

  const chainsForType = useMemo(
    () => supported[permissionType]?.chainIds ?? [],
    [supported, permissionType],
  )

  const defaultChainHex = useMemo(() => {
    const wagmiHex = numberToHex(chainIdNum) as `0x${string}`
    const wagmiId = BigInt(wagmiHex)
    const match = chainsForType.find((c) => BigInt(c) === wagmiId)
    return (match ?? chainsForType[0] ?? wagmiHex) as `0x${string}`
  }, [chainsForType, chainIdNum])

  const [chainHex, setChainHex] = useState<`0x${string}`>(defaultChainHex)
  useEffect(() => {
    setChainHex(defaultChainHex)
  }, [defaultChainHex])

  const [to, setTo] = useState(env.sessionAccountAddress)
  const [isAdjustmentAllowed, setIsAdjustmentAllowed] = useState(true)

  const [nativeAllowanceEth, setNativeAllowanceEth] = useState('0.1')
  const [erc20TokenAddress, setErc20TokenAddress] = useState(env.tokenAddress)
  const [erc20AllowanceUnits, setErc20AllowanceUnits] = useState('0.1')
  const [erc20PeriodAmountUnits, setErc20PeriodAmountUnits] = useState('0.1')
  const [erc20PeriodDuration, setErc20PeriodDuration] = useState(3600)
  const [expiryMode, setExpiryMode] = useState<'periods' | 'date'>('periods')
  const [numberOfPeriods, setNumberOfPeriods] = useState(5)

  useEffect(() => {
    if (isNativeTokenAllowanceLikeType(permissionType)) {
      setNativeAllowanceEth('0.1')
    }
    if (isErc20TokenAllowanceLikeType(permissionType)) {
      setErc20TokenAddress(env.tokenAddress)
      setErc20AllowanceUnits('0.1')
      setErc20PeriodAmountUnits('0.1')
      setErc20PeriodDuration(3600)
    }
  }, [permissionType])

  const defaultExpiry = useMemo(() => defaultExpiryAfterHours(1), [])
  const [expiryDate, setExpiryDate] = useState(defaultExpiry.date)
  const [expiryTime, setExpiryTime] = useState(defaultExpiry.time)
  const [lastSubmitted, setLastSubmitted] = useState<PermissionRequest | null>(null)
  const [dismissedRejection, setDismissedRejection] = useState(false)

  useEffect(() => {
    const response = requestMutation.data?.[0] ?? null
    if (response && lastSubmitted) {
      onGrantChange?.({ submitted: lastSubmitted, response })
    }
  }, [requestMutation.data, lastSubmitted, onGrantChange])

  useEffect(() => {
    if (requestMutation.isPending) {
      setDismissedRejection(false)
    }
  }, [requestMutation.isPending])

  const dateModeExpiryUnixSeconds = useMemo(
    () => parseDateAndTimeToUnixSeconds(expiryDate, expiryTime),
    [expiryDate, expiryTime],
  )

  const isNativeAllowanceLike = isNativeTokenAllowanceLikeType(permissionType)
  const isErc20AllowanceLike = isErc20TokenAllowanceLikeType(permissionType)
  const isPeriodicType = permissionType.includes('periodic')
  const showExpiryModeToggle = isPeriodicType
  const effectiveExpiryMode: 'periods' | 'date' = showExpiryModeToggle ? expiryMode : 'date'

  const periodicDurationSeconds = useMemo(
    () => Math.max(1, Math.floor(erc20PeriodDuration)),
    [erc20PeriodDuration],
  )
  const numberOfPeriodsValid = Number.isFinite(numberOfPeriods) && numberOfPeriods > 0

  const nowUnixSeconds = Math.floor(Date.now() / 1000)
  const computedExpiryUnixSeconds = useMemo(() => {
    if (effectiveExpiryMode === 'periods') {
      if (!numberOfPeriodsValid) return undefined
      return nowUnixSeconds + Math.floor(numberOfPeriods) * periodicDurationSeconds
    }
    return dateModeExpiryUnixSeconds
  }, [
    dateModeExpiryUnixSeconds,
    effectiveExpiryMode,
    numberOfPeriods,
    numberOfPeriodsValid,
    nowUnixSeconds,
    periodicDurationSeconds,
  ])

  const expiryLocalPreview = useMemo(() => {
    if (!computedExpiryUnixSeconds) return '—'
    const d = new Date(computedExpiryUnixSeconds * 1000)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
  }, [computedExpiryUnixSeconds])

  const nativeAllowanceValid = useMemo(() => {
    if (!isNativeTokenAllowanceLikeType(permissionType)) return true
    try {
      parseEther(nativeAllowanceEth.trim() || '0')
      return true
    } catch {
      return false
    }
  }, [nativeAllowanceEth, permissionType])

  const erc20FormValid = useMemo(() => {
    if (!isErc20TokenAllowanceLikeType(permissionType)) return true
    if (!isAddress(erc20TokenAddress.trim())) return false
    try {
      if (isErc20AllowanceType(permissionType)) {
        parseUnits(erc20AllowanceUnits.trim() || '0', ERC20_FORM_DECIMALS)
      }
      parseUnits(erc20PeriodAmountUnits.trim() || '0', ERC20_FORM_DECIMALS)
    } catch {
      return false
    }
    return Number.isFinite(erc20PeriodDuration) && erc20PeriodDuration > 0
  }, [
    erc20AllowanceUnits,
    erc20PeriodAmountUnits,
    erc20PeriodDuration,
    erc20TokenAddress,
    permissionType,
  ])

  const buildPermissionData = useCallback((): Record<string, unknown> => {
    if (isNativeTokenAllowanceLikeType(permissionType)) {
      const wei = parseEther(nativeAllowanceEth.trim() || '0')
      const data: NativeTokenAllowanceData = {
        allowance: uint256HexFromBigInt(wei),
      }
      return data
    }
    if (isErc20TokenAllowanceLikeType(permissionType)) {
      const tokenAddress = getAddress(erc20TokenAddress.trim()) as `0x${string}`
      const periodWei = parseUnits(erc20PeriodAmountUnits.trim() || '0', ERC20_FORM_DECIMALS)
      if (isErc20AllowanceType(permissionType)) {
        const allowanceWei = parseUnits(erc20AllowanceUnits.trim() || '0', ERC20_FORM_DECIMALS)
        const data: ERC20TokenAllowanceData = {
          tokenAddress,
          allowance: uint256HexFromBigInt(allowanceWei),
          periodAmount: uint256HexFromBigInt(periodWei),
          periodDuration: periodicDurationSeconds,
        }
        return data
      }
      const data: ERC20TokenPeriodicData = {
        tokenAddress,
        periodAmount: uint256HexFromBigInt(periodWei),
        periodDuration: periodicDurationSeconds,
      }
      return data
    }
    return {}
  }, [
    erc20AllowanceUnits,
    erc20PeriodAmountUnits,
    periodicDurationSeconds,
    erc20TokenAddress,
    nativeAllowanceEth,
    permissionType,
  ])

  const buildRequest = useCallback((): PermissionRequest | null => {
    if (!isAddress(to)) return null
    if (isNativeTokenAllowanceLikeType(permissionType) && !nativeAllowanceValid) return null
    if (isErc20TokenAllowanceLikeType(permissionType) && !erc20FormValid) return null
    if (effectiveExpiryMode === 'periods' && !numberOfPeriodsValid) return null

    const nowSeconds = Math.floor(Date.now() / 1000)
    const ts =
      effectiveExpiryMode === 'periods'
        ? nowSeconds + Math.floor(numberOfPeriods) * periodicDurationSeconds
        : parseDateAndTimeToUnixSeconds(expiryDate, expiryTime)
    const req: PermissionRequest = {
      chainId: chainHex,
      to: getAddress(to),
      permission: {
        type: permissionType,
        isAdjustmentAllowed,
        data: buildPermissionData(),
      },
      rules: [
        {
          type: 'expiry',
          data: { timestamp: ts },
        },
      ],
    }
    if (address) {
      req.from = getAddress(address)
    }
    return req
  }, [
    address,
    buildPermissionData,
    chainHex,
    erc20FormValid,
    effectiveExpiryMode,
    expiryDate,
    expiryTime,
    isAdjustmentAllowed,
    nativeAllowanceValid,
    numberOfPeriods,
    numberOfPeriodsValid,
    periodicDurationSeconds,
    permissionType,
    to,
  ])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const built = buildRequest()
    if (!built) return
    setLastSubmitted(built)
    requestMutation.mutate([built])
  }

  const freshResponse = requestMutation.data?.[0] ?? null
  const hasFreshGrant = freshResponse && lastSubmitted && !requestMutation.error && !requestMutation.isPending

  const cardResponse = hasFreshGrant ? freshResponse : storedGrant?.response ?? null
  const cardSubmitted = hasFreshGrant ? lastSubmitted : storedGrant?.submitted ?? null
  const isRestoredFromStorage = !hasFreshGrant && !!storedGrant

  const showRejection =
    requestMutation.isUserRejected && requestMutation.error && !dismissedRejection && !requestMutation.isPending

  const livePayloadPreview = useMemo(() => {
    const permission: Record<string, unknown> = {
      type: permissionType,
      isAdjustmentAllowed,
      data: {},
    }

    let previewError: string | undefined
    try {
      permission.data = buildPermissionData()
    } catch {
      previewError = 'Permission data is currently invalid; payload preview includes a placeholder.'
      permission.data = '<invalid permission data>'
    }

    const requestPreview: Record<string, unknown> = {
      chainId: chainHex,
      to: isAddress(to) ? getAddress(to) : to || '<enter session account address>',
      permission,
      rules: [
        {
          type: 'expiry',
          data: { timestamp: computedExpiryUnixSeconds ?? dateModeExpiryUnixSeconds },
        },
      ],
    }

    if (address && isAddress(address)) {
      requestPreview.from = getAddress(address)
    }

    const rpcRequestPreview = {
      method: 'wallet_requestExecutionPermissions',
      params: [requestPreview],
    }

    return {
      error: previewError,
      json: JSON.stringify(rpcRequestPreview, null, 2),
    }
  }, [
    address,
    buildPermissionData,
    chainHex,
    computedExpiryUnixSeconds,
    dateModeExpiryUnixSeconds,
    isAdjustmentAllowed,
    permissionType,
    to,
  ])

  const periodAmountInput = isNativeAllowanceLike ? nativeAllowanceEth : erc20PeriodAmountUnits
  const periodAmountNumber = Number(periodAmountInput)
  const periodAmountValid = Number.isFinite(periodAmountNumber)
  const summaryPeriods =
    !isPeriodicType
      ? undefined
      : effectiveExpiryMode === 'periods'
      ? numberOfPeriodsValid
        ? Math.floor(numberOfPeriods)
        : undefined
      : computedExpiryUnixSeconds && periodicDurationSeconds > 0
        ? Math.max(
            0,
            Math.ceil((computedExpiryUnixSeconds - Math.floor(Date.now() / 1000)) / periodicDurationSeconds),
          )
        : undefined
  const periodAmountLabel = isNativeAllowanceLike ? 'native' : isErc20AllowanceLike ? 'tokens' : undefined
  const periodAmountDisplay =
    periodAmountValid && periodAmountLabel ? `${periodAmountInput} ${periodAmountLabel}` : undefined
  const totalAmountDisplay =
    summaryPeriods !== undefined && periodAmountValid
      ? `${(periodAmountNumber * summaryPeriods).toFixed((periodAmountInput.split('.')[1] ?? '').length)} ${periodAmountLabel ?? ''}`.trim()
      : undefined
  const matchedPeriodPreset = PERIOD_PRESETS.find((preset) => preset.seconds === periodicDurationSeconds)

  return (
    <div>
      {requestMutation.isUnsupported ? (
        <UnsupportedBanner className="mb-4" />
      ) : null}

      {showRejection ? (
        <div
          className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2.5 text-sm text-amber-100"
          role="status"
        >
          <p>You rejected the request in your wallet</p>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-[#F5A623] underline-offset-2 hover:text-[#FFB84D] hover:underline"
            onClick={() => setDismissedRejection(true)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {requestMutation.error && !requestMutation.isUnsupported && !requestMutation.isUserRejected ? (
        <div
          className="mb-4 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2.5 text-sm text-red-300"
          role="alert"
        >
          {requestMutation.error.message}
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="perm-type">
            Permission type
          <select
            id="perm-type"
            className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-white focus:border-[#F5A623] focus:outline-none"
            value={permissionType}
            onChange={(e) => setPermissionType(e.target.value)}
            disabled={permissionKeys.length === 0}
          >
            {permissionKeys.length === 0 ? (
              <option value="">No supported types from wallet</option>
            ) : (
              permissionKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))
            )}
          </select>
          </label>
        </div>

        <div>
          <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="chain">
            Chain (hex)
          <select
            id="chain"
            className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 font-mono text-xs text-white focus:border-[#F5A623] focus:outline-none"
            value={chainHex}
            onChange={(e) => setChainHex(e.target.value as `0x${string}`)}
            disabled={chainsForType.length === 0}
          >
            {chainsForType.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          </label>
        </div>

        <div>
          <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="to-addr">
            Session account (<code className="font-mono">to</code>)
          <input
            id="to-addr"
            type="text"
            placeholder="0x… DApp key / redeeming account"
            className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 font-mono text-xs text-white placeholder:text-zinc-500 focus:border-[#F5A623] focus:outline-none"
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            spellCheck={false}
            autoComplete="off"
          />
          </label>
          {to.length > 0 && !isAddress(to) ? (
            <p className="mt-1 text-xs text-red-400">Enter a valid checksummed or lower-case address.</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <input
            id="adj"
            type="checkbox"
            className="h-4 w-4 rounded border-[#2A2A2A] bg-[#0A0A0A] text-[#F5A623] focus:ring-[#F5A623]"
            checked={isAdjustmentAllowed}
            onChange={(e) => setIsAdjustmentAllowed(e.target.checked)}
          />
          <label htmlFor="adj" className="text-sm text-zinc-300">
            Allow wallet to adjust permission (<code className="font-mono text-xs">isAdjustmentAllowed</code>)
          </label>
        </div>

        {isNativeAllowanceLike ? (
          <div>
            <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="native-allowance">
              Spending limit per period (ETH / native token)
            <input
              id="native-allowance"
              type="text"
              inputMode="decimal"
              placeholder="0.1"
              className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-[#F5A623] focus:outline-none"
              value={nativeAllowanceEth}
              onChange={(e) => setNativeAllowanceEth(e.target.value)}
            />
            </label>
            <p className="mt-1 text-xs text-zinc-500">
              Converted with <code className="font-mono text-[11px]">parseEther</code> → 32-byte hex{' '}
              <code className="font-mono text-[11px]">allowance</code>.
            </p>
            {!nativeAllowanceValid ? (
              <p className="mt-1 text-xs text-red-400">Enter a valid decimal amount (e.g. 0.1).</p>
            ) : null}
          </div>
        ) : null}

        {isErc20AllowanceLike ? (
          <div className="space-y-4 rounded-lg border border-[#2A2A2A] bg-[#141414] p-3">
            <p className="text-xs font-medium text-zinc-400">
              ERC-20 permission data (<code className="font-mono text-[11px]">erc20-token-*</code> — same shape as allowance / periodic)
            </p>
            <div>
              <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="erc20-token">
                Token address
              <input
                id="erc20-token"
                type="text"
                placeholder="0x… token contract"
                className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 font-mono text-xs text-white placeholder:text-zinc-500 focus:border-[#F5A623] focus:outline-none"
                value={erc20TokenAddress}
                onChange={(e) => setErc20TokenAddress(e.target.value.trim())}
                spellCheck={false}
                autoComplete="off"
              />
              </label>
              {erc20TokenAddress.length > 0 && !isAddress(erc20TokenAddress) ? (
                <p className="mt-1 text-xs text-red-400">Enter a valid token contract address.</p>
              ) : null}
            </div>
            <div>
              {isErc20AllowanceType(permissionType) ? (
                <>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="erc20-allowance">
                    Allowance ({ERC20_FORM_DECIMALS} decimals)
                  <input
                    id="erc20-allowance"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.1"
                    className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-[#F5A623] focus:outline-none"
                    value={erc20AllowanceUnits}
                    onChange={(e) => setErc20AllowanceUnits(e.target.value)}
                  />
                  </label>
                </>
              ) : null}
            </div>
            <div>
              <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="erc20-period-amt">
                Spending limit per period ({ERC20_FORM_DECIMALS} decimals)
              <input
                id="erc20-period-amt"
                type="text"
                inputMode="decimal"
                placeholder="0.1"
                className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-[#F5A623] focus:outline-none"
                value={erc20PeriodAmountUnits}
                onChange={(e) => setErc20PeriodAmountUnits(e.target.value)}
              />
              </label>
            </div>
            <div>
              <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="erc20-period-dur">
                Period duration (seconds)
              <div className="mt-2 flex flex-wrap gap-2">
                {PERIOD_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="rounded-md border border-[#2A2A2A] bg-[#0A0A0A] px-2 py-1 text-xs font-medium text-zinc-300 transition hover:border-zinc-500"
                    onClick={() => setErc20PeriodDuration(preset.seconds)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                id="erc20-period-dur"
                type="number"
                min={1}
                step={1}
                className="mt-1 w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 font-mono text-sm text-white focus:border-[#F5A623] focus:outline-none"
                value={erc20PeriodDuration}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setErc20PeriodDuration(Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 3600)
                }}
              />
              </label>
              <p className="mt-1 text-xs text-zinc-500">
                Amounts use <code className="font-mono text-[11px]">parseUnits</code> → 32-byte hex; duration is already in seconds for{' '}
                <code className="font-mono text-[11px]">periodDuration</code> (current:{' '}
                <code className="font-mono text-[11px]">{periodicDurationSeconds}</code>s).
              </p>
            </div>
            {!erc20FormValid ? (
              <p className="text-xs text-amber-200/90">
                Enter a valid token contract address, decimal amounts for this token&apos;s {ERC20_FORM_DECIMALS} decimals, and a
                period duration of at least 1 second.
              </p>
            ) : null}
          </div>
        ) : null}

        {!isNativeAllowanceLike && !isErc20AllowanceLike ? (
          <p className="rounded-lg border border-dashed border-[#2A2A2A] bg-[#1A1A1A]/50 px-3 py-2 text-xs text-zinc-500">
            No structured <code className="font-mono">permission.data</code> editor for <code className="font-mono">{permissionType}</code>
            ; only <code className="font-mono">native-token-*</code> and <code className="font-mono">erc20-token-*</code> are modeled. An
            empty object would be sent — add a mapping if your wallet reports another family.
          </p>
        ) : null}

        <fieldset className="rounded-lg border border-[#2A2A2A] bg-[#141414] p-3">
          <legend className="px-1 text-xs font-medium text-zinc-400">
            Expiry (<code className="font-mono">expiry</code> rule)
          </legend>
          {showExpiryModeToggle ? (
            <div className="mt-1 inline-flex rounded-full border border-[#2A2A2A] bg-[#0A0A0A] p-1">
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  expiryMode === 'periods'
                    ? 'bg-[#2A2A2A] text-[#F5A623]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                onClick={() => setExpiryMode('periods')}
              >
                Set number of periods
              </button>
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  expiryMode === 'date'
                    ? 'bg-[#2A2A2A] text-[#F5A623]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                onClick={() => setExpiryMode('date')}
              >
                Set end date
              </button>
            </div>
          ) : null}

          {effectiveExpiryMode === 'periods' ? (
            <div className="mt-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="number-of-periods">
                Number of periods
              <input
                id="number-of-periods"
                type="number"
                min={1}
                step={1}
                className="w-full rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 font-mono text-sm text-white focus:border-[#F5A623] focus:outline-none"
                value={numberOfPeriods}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setNumberOfPeriods(Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1)
                }}
              />
              </label>
              <p className="mt-1 text-xs text-zinc-500">
                Expiry is computed at submit time as now + (periods × periodDuration), so it stays relative to when you click
                request.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                Use the calendar for the date and the clock control for the time (includes seconds). Values are interpreted in your
                local timezone and sent as <code className="font-mono text-[11px]">data.timestamp</code> unix seconds.
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="expiry-date">
                    Date
                  <input
                    id="expiry-date"
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full min-w-0 rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-white focus:border-[#F5A623] focus:outline-none"
                  />
                  </label>
                </div>
                <div className="min-w-0 flex-1">
                  <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="expiry-time">
                    Time
                  <input
                    id="expiry-time"
                    type="time"
                    step={1}
                    value={expiryTime}
                    onChange={(e) => setExpiryTime(e.target.value)}
                    className="w-full min-w-0 rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 font-mono text-sm text-white focus:border-[#F5A623] focus:outline-none"
                  />
                  </label>
                </div>
              </div>
            </>
          )}
          <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500">Unix seconds</dt>
              <dd className="font-mono text-zinc-100">{computedExpiryUnixSeconds ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Local preview</dt>
              <dd className="text-zinc-200">{expiryLocalPreview}</dd>
            </div>
          </dl>
        </fieldset>

        <section className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] p-4">
          <h3 className="text-sm font-semibold text-white">Permission summary</h3>
          <dl className="mt-2 grid gap-y-1 text-xs sm:grid-cols-2 sm:gap-x-4">
            <dt className="text-zinc-500">Permission type</dt>
            <dd className="font-mono text-zinc-100">{permissionType || '—'}</dd>

            <dt className="text-zinc-500">Token</dt>
            <dd className="text-zinc-100">
              {isNativeAllowanceLike
                ? 'Native token'
                : isAddress(erc20TokenAddress)
                  ? truncateAddress(getAddress(erc20TokenAddress))
                  : '—'}
            </dd>

            <dt className="text-zinc-500">Spending limit per period</dt>
            <dd className="text-zinc-100">{periodAmountDisplay ?? '—'}</dd>

            <dt className="text-zinc-500">Period duration</dt>
            <dd className="text-zinc-100">
              {isPeriodicType
                ? matchedPeriodPreset
                  ? matchedPeriodPreset.label
                  : `${periodicDurationSeconds}s`
                : '—'}
            </dd>

            <dt className="text-zinc-500">Number of periods</dt>
            <dd className="text-zinc-100">{summaryPeriods ?? '—'}</dd>

            <dt className="text-zinc-500">Max total exposure</dt>
            <dd className="text-zinc-100">{totalAmountDisplay ?? '—'}</dd>

            <dt className="text-zinc-500">Start time (approximate)</dt>
            <dd className="text-zinc-100">{formatLocalDateTime(Math.floor(Date.now() / 1000))}</dd>

            <dt className="text-zinc-500">End time</dt>
            <dd className="text-zinc-100">
              {computedExpiryUnixSeconds ? formatLocalDateTime(computedExpiryUnixSeconds) : '—'}
            </dd>
          </dl>

          {isPeriodicType && periodAmountDisplay ? (
            <p className="mt-3 rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-xs leading-relaxed text-zinc-400">
              <strong className="text-zinc-200">How the limit works:</strong> Up to{' '}
              <strong className="text-zinc-100">{periodAmountDisplay}</strong> can be transferred
              {matchedPeriodPreset
                ? <> per <strong className="text-zinc-100">{matchedPeriodPreset.label.toLowerCase()}</strong> period</>
                : <> every <strong className="text-zinc-100">{periodicDurationSeconds}s</strong></>}
              {' '}across any number of transactions.
              Unused balance does not roll over — it resets each period.
              {totalAmountDisplay ? (
                <> Over {summaryPeriods} period{summaryPeriods === 1 ? '' : 's'}, the maximum
                total spend is <strong className="text-zinc-100">{totalAmountDisplay}</strong>.</>
              ) : null}
            </p>
          ) : null}
        </section>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={
              requestMutation.isPending ||
              permissionKeys.length === 0 ||
              chainsForType.length === 0 ||
              !isAddress(to) ||
              !nativeAllowanceValid ||
              !erc20FormValid ||
              (effectiveExpiryMode === 'periods' && !numberOfPeriodsValid)
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#FFB84D] disabled:opacity-50"
          >
            {requestMutation.isPending ? (
              <>
                <span
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
                Waiting for wallet…
              </>
            ) : (
              'Request permissions'
            )}
          </button>
          {requestMutation.data || requestMutation.error ? (
            <button
              type="button"
              className="text-sm font-medium text-[#F5A623] underline-offset-2 hover:text-[#FFB84D] hover:underline"
              onClick={() => {
                requestMutation.reset()
                setLastSubmitted(null)
                setDismissedRejection(false)
              }}
            >
              Clear result
            </button>
          ) : null}
        </div>

        <section className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] p-4">
          <h3 className="text-sm font-semibold text-white">Live wallet request payload</h3>
          <p className="mt-1 text-xs text-zinc-400">
            This preview mirrors the JSON-RPC body built from the current form and sent to{' '}
            <code className="font-mono text-[11px]">window.ethereum.request</code>.
          </p>
          {livePayloadPreview.error ? (
            <p className="mt-2 text-xs text-amber-300">{livePayloadPreview.error}</p>
          ) : null}
          <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-[#2A2A2A] bg-[#0f0f0f] p-3 text-xs leading-relaxed text-emerald-300">
            <code>{livePayloadPreview.json}</code>
          </pre>
        </section>
      </form>

      {cardResponse && cardSubmitted ? (
        <div className="relative">
          {isRestoredFromStorage ? (
            <div className="mb-2 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                Restored from storage
              </span>
            </div>
          ) : null}
          <PermissionResponseCard response={cardResponse} submitted={cardSubmitted} />
          <button
            type="button"
            className="mt-3 text-xs font-medium text-red-400 underline-offset-2 hover:text-red-300 hover:underline"
            onClick={() => {
              requestMutation.reset()
              setLastSubmitted(null)
              setDismissedRejection(false)
              onGrantChange?.(null)
            }}
          >
            Clear grant
          </button>
        </div>
      ) : null}
    </div>
  )
}
