'use client'

import { PermissionSequenceDiagram } from '@/components/PermissionSequenceDiagram'
import { RequestPermissionsForm } from '@/components/RequestPermissionsForm'
import type { StoredGrant } from '@/hooks/useStoredPermission'
import type { GetSupportedExecutionPermissionsResult } from '@/types/erc7715'

export type RequestPermissionsSectionProps = {
  supported: GetSupportedExecutionPermissionsResult
  storedGrant?: StoredGrant | null
  onGrantChange?: (grant: StoredGrant | null) => void
}

export function RequestPermissionsSection({ supported, storedGrant, onGrantChange }: RequestPermissionsSectionProps) {
  return (
    <section className="rounded-xl border border-l-4 border-[#2A2A2A] border-l-fuchsia-500 bg-[#1A1A1A] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F5A623]">Request permissions</h2>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">
        Build a <code className="font-mono text-xs">PermissionRequest</code> and call{' '}
        <code className="font-mono text-xs">wallet_requestExecutionPermissions</code> through your connected wallet.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <PermissionSequenceDiagram />
          <div className="text-sm leading-relaxed text-zinc-400">
            <p>
              When the wallet approves, it returns a <strong>context</strong> value: an opaque identifier you will pass back on-chain when
              redeeming so the delegation system knows which grant to execute against.
            </p>
            <p className="mt-3">
              <strong>delegationManager</strong> is the contract you call (per ERC-7710) to redeem—your session account submits the encoded
              execution together with that context.
            </p>
            <p className="mt-3">
              <strong>dependencies</strong> describes accounts that still need deployment: each item includes a <code className="font-mono text-xs">factory</code>{' '}
              and <code className="font-mono text-xs">factoryData</code> you can use to deploy them before redemption succeeds.
            </p>
            <p className="mt-3">
              Defaults pick a supported permission from Phase 1, pre-fill a one-hour <code className="font-mono text-xs">expiry</code> rule, and allow wallet adjustments so you can submit quickly and inspect a real response.
            </p>
          </div>
        </div>
        <div className="lg:col-span-3">
          <RequestPermissionsForm
            supported={supported}
            storedGrant={storedGrant}
            onGrantChange={onGrantChange}
          />
        </div>
      </div>
    </section>
  )
}
