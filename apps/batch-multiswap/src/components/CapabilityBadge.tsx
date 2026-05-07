import { useAccount } from "wagmi";
import { useSwapStore } from "../store/swapStore";

const FLASK_URL = "https://metamask.io/flask/";

export const CapabilityBadge = () => {
  const { isConnected } = useAccount();
  const batchCapability = useSwapStore((s) => s.batchCapability);

  if (!isConnected) {
    return (
      <div className="rounded-2xl border border-zinc-600 bg-zinc-800/80 px-4 py-3 text-sm text-zinc-400">
        Connect your wallet to detect ERC-5792 atomic batch support on
        Berachain.
      </div>
    );
  }

  if (batchCapability === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-zinc-600 bg-zinc-800 px-4 py-3 text-sm text-zinc-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-500" />
        Checking batch support…
      </div>
    );
  }

  if (batchCapability === "supported") {
    return (
      <div className="flex max-w-xl items-center gap-3 rounded-2xl border-2 border-emerald-500/70 bg-emerald-500/10 px-5 py-4 shadow-lg shadow-emerald-500/10">
        <span className="text-lg font-bold tracking-tight text-emerald-400">
          Batch Supported
        </span>
        <p className="text-sm text-emerald-200/90">
          This wallet can submit ERC-5792 atomic batches on Berachain.
        </p>
      </div>
    );
  }

  if (batchCapability === "error") {
    return (
      <div className="flex max-w-xl flex-col gap-1 rounded-2xl border-2 border-red-400/60 bg-red-500/10 px-5 py-4">
        <span className="text-lg font-bold text-red-400">
          Capability check failed
        </span>
        <p className="text-sm text-zinc-300">
          Could not read wallet capabilities. Unlock MetaMask and retry.
        </p>
      </div>
    );
  }

  if (batchCapability === "wrong_network") {
    return (
      <div className="flex max-w-xl flex-col gap-1 rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 px-5 py-4">
        <span className="text-lg font-bold text-amber-400">Wrong network</span>
        <p className="text-sm text-amber-100/85">
          Switch to Berachain mainnet to verify atomic batch support and swap.
        </p>
      </div>
    );
  }

  if (batchCapability === "not_supported") {
    return (
      <div className="flex max-w-xl flex-col gap-1 rounded-2xl border-2 border-yellow-400/70 bg-yellow-400/10 px-5 py-4 shadow-lg shadow-yellow-500/10">
        <span className="text-lg font-bold text-yellow-400">
          Batch Not Supported
        </span>
        <p className="text-sm text-yellow-100/80">
          Your wallet reports atomic batching is unavailable on this chain. Try
          a newer MetaMask build or another browser profile.
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => window.open(FLASK_URL, "_blank", "noopener,noreferrer")}
      className="flex max-w-xl flex-col gap-1 rounded-2xl border-2 border-red-400/80 bg-red-500/15 px-5 py-4 text-left shadow-xl shadow-red-500/20 transition hover:bg-red-500/25"
    >
      <span className="text-lg font-bold text-red-400">Upgrade Required</span>
      <p className="text-sm text-red-100/85">
        Install MetaMask Flask or upgrade MetaMask to use{" "}
        <code className="rounded bg-zinc-900 px-1 py-0.5 text-xs">
          wallet_sendCalls
        </code>{" "}
        batching. <span className="text-amber-300 underline">Open Flask →</span>
      </p>
    </button>
  );
};
