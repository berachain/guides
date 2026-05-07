import type { TokenWithBalance } from "../types/token";
import { TokenRow } from "./TokenRow";

interface TokenListProps {
  tokens: TokenWithBalance[];
  loading: boolean;
  error: string | null;
}

export const TokenList = ({ tokens, loading, error }: TokenListProps) => {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl bg-zinc-800/80"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error}
      </p>
    );
  }

  if (tokens.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-700 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-500">
        No balances for known tokens. Deposit HONEY, WETH, or other supported
        assets on Berachain.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-zinc-100">Your tokens</h2>
      <p className="text-sm text-zinc-500">
        Select tokens to swap into BERA (routed as WBERA via KyberSwap).
      </p>
      <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {tokens.map((t) => (
          <TokenRow key={t.address} token={t} />
        ))}
      </div>
    </div>
  );
};
