"use client";

import { RedeemPermissionForm } from "@/components/RedeemPermissionForm";
import type { PermissionResponse } from "@/types/erc7715";

export type RedeemSectionProps = {
  initialResponse?: PermissionResponse | null;
  onClear?: () => void;
};

export function RedeemSection({
  initialResponse,
  onClear,
}: RedeemSectionProps) {
  return (
    <section className="rounded-xl border border-l-4 border-[#2A2A2A] border-l-emerald-500 bg-[#1A1A1A] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F5A623]">
        Redeem permissions
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">
        Execute an on-chain action using the granted delegation context — no
        additional wallet prompt required.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
        <div className="flex flex-col gap-4 text-sm leading-relaxed text-zinc-400 lg:col-span-2">
          <p>
            <strong className="text-zinc-200">Redeeming</strong> calls{" "}
            <code className="font-mono text-xs">redeemDelegations</code> on the{" "}
            <code className="font-mono text-xs">delegationManager</code>{" "}
            contract returned by the wallet in Phase 2.
          </p>
          <p>
            You pass the <strong className="text-zinc-200">context</strong>{" "}
            (opaque permission proof), an{" "}
            <strong className="text-zinc-200">execution mode</strong> (default
            single-call), and the encoded execution payload. The delegation
            framework verifies the grant, enforces rules (expiry, allowance),
            and forwards execution on behalf of the delegator — all without
            another wallet signature.
          </p>
          <p>
            For this demo the execution is a simple native-token transfer: pick
            a target address and an amount, and the session account submits the
            call through the delegation manager.
          </p>
          <p>
            Paste a{" "}
            <code className="font-mono text-xs">PermissionResponse</code> JSON
            into the field on the right, or complete the{" "}
            <strong className="text-zinc-200">Request permissions</strong>{" "}
            section above to auto-fill it.
          </p>
        </div>
        <div className="lg:col-span-3">
          <RedeemPermissionForm
            initialResponse={initialResponse}
            onClear={onClear}
          />
        </div>
      </div>
    </section>
  );
}
