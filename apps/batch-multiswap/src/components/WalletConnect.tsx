import { useWallet } from "../hooks/useWallet";
import { berachain } from "../lib/berachain";

export const WalletConnect = () => {
  const {
    address,
    isConnected,
    wrongChain,
    connectMetaMask,
    disconnect,
    isConnectPending,
    isSwitchPending,
    switchToBerachain,
    connectError,
    switchError,
  } = useWallet();

  if (!isConnected) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => connectMetaMask()}
          disabled={isConnectPending}
          className="rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-zinc-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-50"
        >
          {isConnectPending ? "Connecting…" : "Connect MetaMask"}
        </button>
        {connectError ? (
          <p className="text-sm text-red-400">{connectError.message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2 font-mono text-sm text-zinc-200">
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </div>
      {wrongChain ? (
        <button
          type="button"
          onClick={() => switchToBerachain()}
          disabled={isSwitchPending}
          className="rounded-xl border border-yellow-400/60 bg-yellow-400/10 px-4 py-2 text-sm font-medium text-yellow-400 hover:bg-yellow-400/20 disabled:opacity-50"
        >
          {isSwitchPending ? "Switching…" : `Switch to ${berachain.name}`}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => disconnect()}
        className="rounded-xl border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
      >
        Disconnect
      </button>
      {switchError ? (
        <p className="text-sm text-red-400">{switchError.message}</p>
      ) : null}
    </div>
  );
};
