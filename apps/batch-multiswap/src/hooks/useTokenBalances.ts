import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { erc20BalanceOfCall } from "../lib/erc20";
import { fetchTokenUsdPrices } from "../lib/prices";
import { fetchBerachainTokenList } from "../lib/tokenList";
import type { TokenWithBalance } from "../types/token";
import { useSwapStore } from "../store/swapStore";

interface TokenBalancesState {
  tokens: TokenWithBalance[];
  loading: boolean;
  error: string | null;
}

const emptyState: TokenBalancesState = {
  tokens: [],
  loading: false,
  error: null,
};

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const useTokenBalances = (owner: Address | undefined) => {
  const publicClient = usePublicClient();
  const refreshNonce = useSwapStore((s) => s.balanceRefreshNonce);
  const [state, setState] = useState<TokenBalancesState>(emptyState);

  const skip = !owner || !publicClient;

  useEffect(() => {
    if (skip) {
      return;
    }

    const ac = new AbortController();

    const run = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const tokenList = await fetchBerachainTokenList(ac.signal);

        const balanceRows: TokenWithBalance[] = [];
        for (const tokenChunk of chunk(tokenList, 120)) {
          const contracts = tokenChunk.map((t) =>
            erc20BalanceOfCall({ token: t.address, owner }),
          );

          const results = await publicClient.multicall({
            contracts,
            allowFailure: true,
          });

          for (let i = 0; i < tokenChunk.length; i++) {
            const meta = tokenChunk[i];
            const r = results[i];
            if (r.status !== "success") {
              continue;
            }
            const balance = r.result as bigint;
            if (balance === 0n) {
              continue;
            }
            balanceRows.push({
              ...meta,
              balance,
              formattedBalance: formatUnits(balance, meta.decimals),
              usdPrice: 0,
              usdValue: 0,
            });
          }
        }

        const prices = await fetchTokenUsdPrices({
          addresses: balanceRows.map((t) => t.address),
          signal: ac.signal,
        });

        const out = balanceRows.map((token) => {
          const price =
            prices[token.address.toLowerCase()] ?? prices[token.address] ?? 0;
          const usdValue =
            price > 0 ? Number.parseFloat(token.formattedBalance) * price : 0;
          return {
            ...token,
            usdPrice: price,
            usdValue,
          };
        });

        out.sort((a, b) => {
          if (b.usdValue !== a.usdValue) {
            return b.usdValue - a.usdValue;
          }
          return a.symbol.localeCompare(b.symbol);
        });

        if (!ac.signal.aborted) {
          setState({ tokens: out, loading: false, error: null });
        }
      } catch (e) {
        if (ac.signal.aborted) {
          return;
        }
        const msg = e instanceof Error ? e.message : "Failed to load balances";
        setState({ tokens: [], loading: false, error: msg });
      }
    };

    void run();
    return () => ac.abort();
  }, [owner, publicClient, refreshNonce, skip]);

  if (skip) {
    return emptyState;
  }

  return state;
};
