import type { GetSupportedExecutionPermissionsResult } from '@/types/erc7715'
import { hexChainIdToNumericString } from '@/lib/executionPermissionsDisplay'

export type SupportedPermissionsProps = {
  data: GetSupportedExecutionPermissionsResult
  rawResponse: unknown
}

export function SupportedPermissions({ data, rawResponse }: SupportedPermissionsProps) {
  const rows = Object.entries(data).map(([permissionType, value]) => ({
    permissionType,
    chainIds: value.chainIds,
    ruleTypes: value.ruleTypes,
  }))

  const rawJson =
    typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse, null, 2)

  return (
    <details className="group overflow-hidden rounded-xl border border-[#2A2A2A] bg-[#1A1A1A]">
      <summary className="cursor-pointer list-none px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F5A623]">
                Supported permission types
              </h2>
              <span className="rounded-full bg-[#2A2A2A] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                <span className="group-open:hidden">Show</span>
                <span className="hidden group-open:inline">Hide</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Parsed from the wallet response</p>
            {rows.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">No supported permission types</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {rows.map((row) => (
                  <div
                    key={row.permissionType}
                    className="min-w-0 max-w-full rounded-lg border border-[#2A2A2A] bg-[#141414] px-2.5 py-1.5"
                  >
                    <p className="truncate font-mono text-[11px] font-medium leading-tight text-zinc-200">
                      {row.permissionType}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-tight text-zinc-500">
                      {row.chainIds.length} chains
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span
            aria-hidden
            className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2A2A2A] bg-[#141414] text-zinc-400 transition-transform group-open:rotate-180"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </div>
      </summary>

      <div className="flex flex-col gap-6 border-t border-[#2A2A2A] px-0 pb-4 pt-2">
        <div className="overflow-x-auto px-0">
          <table className="w-full min-w-160 text-left text-sm">
            <thead className="bg-[#141414] text-xs font-medium uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="px-4 py-3">Permission type</th>
                <th className="px-4 py-3">Chain IDs (hex)</th>
                <th className="px-4 py-3">Chain IDs (numeric)</th>
                <th className="px-4 py-3">Rule types</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2A2A]">
              {rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-zinc-500" colSpan={4}>
                    The wallet reported no supported execution permission types (empty object).
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.permissionType} className="text-zinc-300">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-zinc-100">
                      {row.permissionType}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      <ul className="flex flex-col gap-1">
                        {row.chainIds.map((id) => (
                          <li key={id}>{id}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      <ul className="flex flex-col gap-1">
                        {row.chainIds.map((id) => (
                          <li key={`${row.permissionType}-${id}-num`}>{hexChainIdToNumericString(id)}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <ul className="flex flex-col gap-1">
                        {row.ruleTypes.map((t) => (
                          <li key={t} className="font-mono">
                            {t}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <section className="mx-4 overflow-hidden rounded-xl border border-[#2A2A2A] bg-[#0A0A0A]">
          <div className="border-b border-[#2A2A2A] px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-100">Raw wallet response</h3>
          </div>
          <pre className="max-h-112 overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {rawJson}
          </pre>
        </section>
      </div>
    </details>
  )
}
