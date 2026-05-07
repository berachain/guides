import { useAccount } from "wagmi";
import { useMemo } from "react";
import { useSwapBatch } from "../hooks/useSwapBatch";
import { useSwapStore } from "../store/swapStore";
import { useWallet } from "../hooks/useWallet";

export const SwapButton = () => {
  const { address, isConnected } = useAccount();
  const { wrongChain } = useWallet();
  const { executeSwap } = useSwapBatch();
  const swapPhase = useSwapStore((s) => s.swapPhase);
  const batchCapability = useSwapStore((s) => s.batchCapability);
  const selectedTokens = useSwapStore((s) => s.selectedTokens);
  const amountByToken = useSwapStore((s) => s.amountByToken);
  const quotes = useSwapStore((s) => s.quotes);
  const setSwapPhase = useSwapStore((s) => s.setSwapPhase);
  const setLastError = useSwapStore((s) => s.setLastError);

  const canSwap = useMemo(() => {
    if (!isConnected || !address || wrongChain) {
      return false;
    }
    if (batchCapability !== "supported") {
      return false;
    }
    if (selectedTokens.size === 0) {
      return false;
    }
    for (const t of selectedTokens) {
      const amt = amountByToken[t] ?? "0";
      const q = quotes[t];
      if (amt === "0" || amt === "" || q?.status !== "ok") {
        return false;
      }
    }
    return true;
  }, [
    address,
    amountByToken,
    batchCapability,
    isConnected,
    quotes,
    selectedTokens,
    wrongChain,
  ]);

  const label = () => {
    switch (swapPhase) {
      case "fetching_routes":
        return "Getting fresh quotes…";
      case "awaiting_wallet":
        return "Confirm in wallet…";
      case "pending":
        return "Swapping… (polling)";
      case "success":
        return "Swap Complete ✓";
      case "error":
        return "Swap Failed — Retry?";
      default:
        return "Swap All to BERA";
    }
  };

  const busy =
    swapPhase === "fetching_routes" ||
    swapPhase === "awaiting_wallet" ||
    swapPhase === "pending" ||
    swapPhase === "success";

  const onClick = () => {
    if (swapPhase === "error") {
      setSwapPhase("idle");
      setLastError(null);
      return;
    }
    void executeSwap();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={(!canSwap && swapPhase !== "error") || busy}
      className={`relative w-full rounded-2xl py-4 text-center text-lg font-bold transition ${
        swapPhase === "success"
          ? "bg-emerald-500 text-zinc-950"
          : swapPhase === "error"
            ? "bg-red-500/90 text-white"
            : "bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
      }`}
    >
      {swapPhase === "fetching_routes" ||
      swapPhase === "awaiting_wallet" ||
      swapPhase === "pending" ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
          {label()}
        </span>
      ) : (
        label()
      )}
    </button>
  );
};
