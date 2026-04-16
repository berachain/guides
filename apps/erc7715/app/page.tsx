"use client";

import { useCallback } from "react";
import { RedeemSection } from "@/components/RedeemSection";
import { RequestPermissionsSection } from "@/components/RequestPermissionsSection";
import { SupportedPermissions } from "@/components/SupportedPermissions";
import { UnsupportedBanner } from "@/components/UnsupportedBanner";
import {
  useStoredPermission,
  type StoredGrant,
} from "@/hooks/useStoredPermission";
import { useWalletSupport } from "@/hooks/useWalletSupport";
import { useConnect, useConnection, useDisconnect } from "wagmi";

export default function HomePage() {
  const { address, isConnected, status } = useConnection();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const support = useWalletSupport();

  const { grant, setGrant, clear: clearGrant } = useStoredPermission();

  const handleGrantChange = useCallback(
    (next: StoredGrant | null) => setGrant(next),
    [setGrant],
  );

  const metaMask = connectors.find((c) => c.type === "metaMask");

  const showPhase2Request =
    isConnected &&
    status === "connected" &&
    !support.isLoading &&
    !support.isUnsupported &&
    support.data !== undefined;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-[#0A0A0A] text-zinc-100">
      <header className="border-b border-[#2A2A2A] bg-[#0A0A0A]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              ERC-7715 execution permissions
            </h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">
              Probe the connected wallet for{" "}
              <span className="font-mono text-xs text-zinc-300">
                wallet_getSupportedExecutionPermissions
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isConnected ? (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl bg-[#F5A623] px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[#FFB84D] disabled:opacity-50"
                disabled={!metaMask || isConnectPending}
                onClick={() => metaMask && connect({ connector: metaMask })}
              >
                {isConnectPending ? "Connecting…" : "Connect Wallet"}
              </button>
            ) : (
              <>
                <span
                  className="truncate font-mono text-xs text-zinc-400 sm:max-w-48"
                  title={address}
                >
                  {address}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-[#2A2A2A] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-[#F5A623]/50 hover:text-white"
                  onClick={() => disconnect()}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col space-y-10 px-4 py-10 pb-40">
        {!isConnected || status !== "connected" ? (
          <p className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#1A1A1A]/50 px-4 py-8 text-center text-sm text-zinc-500">
            Connect MetaMask to automatically check execution permission support
            on Berachain networks.
          </p>
        ) : (
          <>
            {support.isUnsupported && <UnsupportedBanner />}

            {support.isLoading && (
              <p className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] px-4 py-6 text-sm text-zinc-400">
                Querying the wallet for supported execution permissions…
              </p>
            )}

            {support.isError && !support.isUnsupported && (
              <div
                className="rounded-xl border border-red-500/40 bg-red-500/15 px-4 py-4 text-sm text-red-400"
                role="alert"
              >
                <p className="font-medium text-red-300">
                  Could not read supported permissions
                </p>
                {support.errorMessage && (
                  <p className="mt-2 font-mono text-xs">
                    {support.errorMessage}
                  </p>
                )}
                {support.errorCode !== undefined && (
                  <p className="mt-1 font-mono text-xs text-red-300/90">
                    RPC code: {support.errorCode}
                  </p>
                )}
              </div>
            )}

            {support.data && support.rawResponse !== undefined && (
              <SupportedPermissions
                data={support.data}
                rawResponse={support.rawResponse}
              />
            )}

            {showPhase2Request && support.data ? (
              <RequestPermissionsSection
                supported={support.data}
                storedGrant={grant}
                onGrantChange={handleGrantChange}
              />
            ) : null}

            <RedeemSection
              initialResponse={grant?.response ?? null}
              onClear={clearGrant}
            />
          </>
        )}
      </main>
    </div>
  );
}
