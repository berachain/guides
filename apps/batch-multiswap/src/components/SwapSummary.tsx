import { formatEther } from "viem";
import { useMemo } from "react";
import { useSwapStore } from "../store/swapStore";

export const SwapSummary = () => {
  const selectedTokens = useSwapStore((s) => s.selectedTokens);
  const quotes = useSwapStore((s) => s.quotes);
  const batchCapability = useSwapStore((s) => s.batchCapability);

  const { totalOut, totalGas, highImpact } = useMemo(() => {
    let out = 0n;
    let gas = 0n;
    let impact = false;
    for (const addr of selectedTokens) {
      const q = quotes[addr];
      if (q?.status === "ok" && q.amountOutWei) {
        out += BigInt(q.amountOutWei);
      }
      if (q?.status === "ok" && q.gasEstimate) {
        gas += BigInt(q.gasEstimate);
      }
      if (
        q?.status === "ok" &&
        q.priceImpactRatio !== undefined &&
        q.priceImpactRatio > 0.02
      ) {
        impact = true;
      }
    }
    return { totalOut: out, totalGas: gas, highImpact: impact };
  }, [quotes, selectedTokens]);

  const batchWarn =
    batchCapability === "not_supported" ||
    batchCapability === "upgrade_required" ||
    batchCapability === "wrong_network" ||
    batchCapability === "error";

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900/60 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Summary
      </h3>
      <div className="flex justify-between text-zinc-200">
        <span>Total est. BERA out</span>
        <span className="font-mono text-amber-400">
          {selectedTokens.size === 0 ? "—" : `~${formatEther(totalOut)}`}
        </span>
      </div>
      <div className="flex justify-between text-sm text-zinc-400">
        <span>Total est. gas (route units)</span>
        <span className="font-mono text-zinc-300">
          {selectedTokens.size === 0 ? "—" : totalGas.toString()}
        </span>
      </div>
      {highImpact ? (
        <p className="rounded-lg border border-yellow-400/40 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300">
          One or more quotes show over 2% price impact vs. USD notionals.
        </p>
      ) : null}
      {batchWarn ? (
        <p className="rounded-lg border border-yellow-400/40 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-300">
          Batch swaps require ERC-5792 atomic batch support. Fix the badge above
          before sending.
        </p>
      ) : null}
    </div>
  );
};
