import { useAccount } from "wagmi";
import { CapabilityBadge } from "./components/CapabilityBadge";
import { SwapButton } from "./components/SwapButton";
import { SwapSummary } from "./components/SwapSummary";
import { TokenList } from "./components/TokenList";
import { TransactionStatus } from "./components/TransactionStatus";
import { WalletConnect } from "./components/WalletConnect";
import { useDebouncedRouteQuotes } from "./hooks/useKyberSwap";
import { useERC5792CapabilitySync } from "./hooks/useERC5792";
import { useTokenBalances } from "./hooks/useTokenBalances";

const App = () => {
  useERC5792CapabilitySync();
  const { address, isConnected } = useAccount();
  useDebouncedRouteQuotes({ userAddress: address });
  const { tokens, loading, error } = useTokenBalances(address);

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-10 space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-amber-500/90">
                Berachain · ERC-5792
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
                Batch swap to BERA
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
                Swap multiple ERC-20 positions into BERA in one MetaMask batch
                using{" "}
                <code className="text-amber-400/90">wallet_sendCalls</code>.
                Quotes come from KyberSwap; routes settle to WBERA.
              </p>
            </div>
            <WalletConnect />
          </div>
          <CapabilityBadge />
        </header>

        <main className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <TokenList tokens={tokens} loading={loading} error={error} />
          <div className="space-y-4">
            <SwapSummary />
            <SwapButton />
            {isConnected ? <TransactionStatus /> : null}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
