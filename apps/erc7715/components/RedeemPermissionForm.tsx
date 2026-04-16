'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { getAddress, isAddress, parseEther, parseUnits } from 'viem'
import { berachain, berachainTestnetbArtio } from 'viem/chains'
import { useRedeemPermission } from '@/hooks/useRedeemPermission'
import type { PermissionResponse } from '@/types/erc7715'

const ERC20_DECIMALS = 18

const SUPPORTED_CHAINS = [berachain, berachainTestnetbArtio]

function getExplorerTxUrl(chainIdHex: string, txHash: string): string | null {
  const chainId = Number(chainIdHex)
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId)
  const baseUrl = chain?.blockExplorers?.default?.url
  if (!baseUrl) return null
  return `${baseUrl}/tx/${txHash}`
}

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(ts * 1000))
}

function truncateHex(hex: string, leading = 6, trailing = 4): string {
  if (!hex.startsWith('0x') || hex.length <= leading + trailing + 2) return hex
  return `${hex.slice(0, leading + 2)}…${hex.slice(-trailing)}`
}

function isPermissionResponse(value: unknown): value is PermissionResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.context === 'string' &&
    typeof v.delegationManager === 'string' &&
    Array.isArray(v.dependencies) &&
    typeof v.chainId === 'string' &&
    typeof v.to === 'string' &&
    typeof v.permission === 'object' &&
    v.permission !== null
  )
}

export type RedeemPermissionFormProps = {
  initialResponse?: PermissionResponse | null
  onClear?: () => void
}

export function RedeemPermissionForm({ initialResponse, onClear }: RedeemPermissionFormProps) {
  const redeem = useRedeemPermission()

  const [responseJson, setResponseJson] = useState('')
  const [targetAddress, setTargetAddress] = useState('')
  const [amountInput, setAmountInput] = useState('0.001')

  useEffect(() => {
    if (initialResponse) {
      setResponseJson(JSON.stringify(initialResponse, null, 2))
    }
  }, [initialResponse])

  const { parsed, parseError } = useMemo<{
    parsed: PermissionResponse | null
    parseError: string | null
  }>(() => {
    const trimmed = responseJson.trim()
    if (!trimmed) return { parsed: null, parseError: null }
    try {
      const obj = JSON.parse(trimmed)
      if (!isPermissionResponse(obj)) {
        return {
          parsed: null,
          parseError:
            'Missing required fields: context, delegationManager, dependencies, chainId, to, permission.',
        }
      }
      return { parsed: obj, parseError: null }
    } catch {
      return { parsed: null, parseError: 'Invalid JSON — paste a PermissionResponse object.' }
    }
  }, [responseJson])

  const isErc20Type = parsed?.permission.type.startsWith('erc20-token-') ?? false

  const amountValid = useMemo(() => {
    try {
      if (isErc20Type) {
        parseUnits(amountInput.trim() || '0', ERC20_DECIMALS)
      } else {
        parseEther(amountInput.trim() || '0')
      }
      return true
    } catch {
      return false
    }
  }, [amountInput, isErc20Type])

  const data = (parsed?.permission.data ?? {}) as Record<string, unknown>
  const tokenAddress = typeof data.tokenAddress === 'string' ? data.tokenAddress : null
  const periodAmount = typeof data.periodAmount === 'string' ? data.periodAmount : null
  const allowance = typeof data.allowance === 'string' ? data.allowance : null
  const isNativeType = parsed?.permission.type.startsWith('native-token-') ?? false

  const expiryRule = parsed?.rules?.find((r) => r.type === 'expiry')
  const expiryTs = (expiryRule?.data as { timestamp?: number } | undefined)?.timestamp

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!parsed) return
    if (!isAddress(targetAddress)) return
    if (!amountValid) return

    const recipient = getAddress(targetAddress) as `0x${string}`

    if (isErc20Type && tokenAddress && isAddress(tokenAddress)) {
      redeem.mutate({
        kind: 'erc20',
        response: parsed,
        tokenAddress: getAddress(tokenAddress) as `0x${string}`,
        recipient,
        amount: parseUnits(amountInput.trim(), ERC20_DECIMALS),
      })
    } else {
      redeem.mutate({
        kind: 'native',
        response: parsed,
        recipient,
        value: parseEther(amountInput.trim()),
      })
    }
  }

  const explorerUrl =
    redeem.hash && parsed ? getExplorerTxUrl(parsed.chainId, redeem.hash) : null

  return (
    <div className="space-y-6">
      <label className="flex flex-col gap-1 text-xs text-zinc-400" htmlFor="redeem-response-json">
        Permission response (JSON)
        <textarea
          id="redeem-response-json"
          rows={8}
          placeholder='Paste a PermissionResponse JSON object, or complete Phase 2 above to auto-fill…'
          className="rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 font-mono text-xs leading-relaxed text-white placeholder:text-zinc-500 focus:border-[#F5A623] focus:outline-none"
          value={responseJson}
          onChange={(e) => setResponseJson(e.target.value)}
          spellCheck={false}
        />
      </label>

      {responseJson.trim() ? (
        <div className="flex items-center gap-3">
          {initialResponse ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              Loaded from storage
            </span>
          ) : null}
          <button
            type="button"
            className="text-xs font-medium text-red-400 underline-offset-2 hover:text-red-300 hover:underline"
            onClick={() => {
              setResponseJson('')
              redeem.reset()
              onClear?.()
            }}
          >
            Clear context
          </button>
        </div>
      ) : null}

      {parseError ? (
        <p className="text-xs text-red-400">{parseError}</p>
      ) : null}

      {parsed ? (
        <>
          <div className="rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Parsed permission
            </h3>
            <dl className="mt-3 grid gap-y-1.5 text-xs sm:grid-cols-2 sm:gap-x-4">
              <dt className="text-zinc-500">Type</dt>
              <dd>
                <span className="rounded-md bg-[#2A2A2A] px-2 py-0.5 font-mono text-xs text-[#F5A623]">
                  {parsed.permission.type}
                </span>
              </dd>

              <dt className="text-zinc-500">Token</dt>
              <dd className="font-mono text-zinc-100">
                {isNativeType
                  ? 'Native (BERA)'
                  : tokenAddress
                    ? truncateHex(tokenAddress)
                    : '—'}
              </dd>

              {allowance ? (
                <>
                  <dt className="text-zinc-500">Allowance</dt>
                  <dd className="break-all font-mono text-zinc-300">
                    {truncateHex(allowance, 10, 6)}
                  </dd>
                </>
              ) : null}

              {periodAmount ? (
                <>
                  <dt className="text-zinc-500">Period amount</dt>
                  <dd className="break-all font-mono text-zinc-300">
                    {truncateHex(periodAmount, 10, 6)}
                  </dd>
                </>
              ) : null}

              {expiryTs ? (
                <>
                  <dt className="text-zinc-500">Expiry</dt>
                  <dd className="text-zinc-100">{formatTimestamp(expiryTs)}</dd>
                </>
              ) : null}

              <dt className="text-zinc-500">Context</dt>
              <dd className="break-all font-mono text-zinc-400">
                {truncateHex(parsed.context, 10, 8)}
              </dd>

              <dt className="text-zinc-500">Delegation manager</dt>
              <dd className="break-all font-mono text-zinc-400">
                {truncateHex(parsed.delegationManager)}
              </dd>
            </dl>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label
              className="flex flex-col gap-1 text-xs text-zinc-400"
              htmlFor="redeem-target"
            >
              Target address
              <input
                id="redeem-target"
                type="text"
                placeholder="0x… recipient"
                className="rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 font-mono text-xs text-white placeholder:text-zinc-500 focus:border-[#F5A623] focus:outline-none"
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value.trim())}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            {targetAddress.length > 0 && !isAddress(targetAddress) ? (
              <p className="text-xs text-red-400">Enter a valid address.</p>
            ) : null}

            <label
              className="flex flex-col gap-1 text-xs text-zinc-400"
              htmlFor="redeem-value"
            >
              {isErc20Type
                ? `Token amount (${ERC20_DECIMALS} decimals)`
                : 'Value (ETH / native token)'}
              <input
                id="redeem-value"
                type="text"
                inputMode="decimal"
                placeholder={isErc20Type ? '1.0' : '0.001'}
                className="rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-[#F5A623] focus:outline-none"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
            </label>
            {isErc20Type && tokenAddress ? (
              <p className="text-xs text-zinc-500">
                Transfers to{' '}
                <code className="font-mono text-[11px] text-zinc-300">{truncateHex(tokenAddress)}</code>
                {' '}via <code className="font-mono text-[11px]">transfer(address,uint256)</code>
              </p>
            ) : null}
            {!amountValid && amountInput.trim().length > 0 ? (
              <p className="text-xs text-red-400">Enter a valid decimal amount.</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={
                  redeem.isPending || !isAddress(targetAddress) || !amountValid
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#FFB84D] disabled:opacity-50"
              >
                {redeem.isPending ? (
                  <>
                    <span
                      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black"
                      aria-hidden
                    />
                    Redeeming…
                  </>
                ) : (
                  'Redeem'
                )}
              </button>
              {redeem.hash || redeem.error ? (
                <button
                  type="button"
                  className="text-sm font-medium text-[#F5A623] underline-offset-2 hover:text-[#FFB84D] hover:underline"
                  onClick={() => redeem.reset()}
                >
                  Clear result
                </button>
              ) : null}
            </div>
          </form>

          {redeem.hash ? (
            <div className="rounded-lg border border-[#22C55E]/40 bg-emerald-500/15 px-4 py-3">
              <p className="text-sm font-medium text-[#22C55E]">Transaction submitted</p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-300">
                {redeem.hash}
              </p>
              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-mono text-xs text-sky-400 underline hover:text-sky-300"
                >
                  View on Berascan ↗
                </a>
              ) : null}
            </div>
          ) : null}

          {redeem.error ? (
            <div
              className="rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-3 text-sm text-red-300"
              role="alert"
            >
              {redeem.error.message}
            </div>
          ) : null}
        </>
      ) : !parseError && !responseJson.trim() ? (
        <p className="rounded-lg border border-dashed border-[#2A2A2A] bg-[#1A1A1A]/50 px-4 py-6 text-center text-sm text-zinc-500">
          Paste a <code className="font-mono text-xs">PermissionResponse</code> JSON above, or
          complete Phase 2 to auto-fill.
        </p>
      ) : null}

      {/* TODO: Phase 4 — Revoke permission (call revokePermission on delegationManager with the context). */}
    </div>
  )
}
