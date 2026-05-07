import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Address } from "viem";
import {
  buildKyberCalldata,
  computePriceImpactRatio,
  fetchKyberRoute,
} from "../lib/kyberswap";
import type { RouteSummary } from "../types/kyberswap";
import { useSwapStore } from "../store/swapStore";

export const useKyberSwap = () => {
  const fetchRouteSummary = useCallback(
    async (params: {
      tokenIn: Address;
      amountIn: bigint;
      signal?: AbortSignal;
    }) => {
      return fetchKyberRoute(params);
    },
    [],
  );

  const buildCalldata = useCallback(
    async (params: {
      routeSummary: RouteSummary;
      sender: Address;
      recipient: Address;
      slippageToleranceBps: number;
      deadlineUnix: number;
      signal?: AbortSignal;
    }) => {
      return buildKyberCalldata(params);
    },
    [],
  );

  return {
    fetchRouteSummary,
    buildCalldata,
    computePriceImpactRatio,
  };
};

/**
 * Debounced Kyber route quotes for the current selection (GET /routes only).
 * Each selected token gets its own timer and AbortController so fast typing
 * on one row does not cancel in-flight quotes for other tokens.
 */
export const useDebouncedRouteQuotes = (params: {
  userAddress: Address | undefined;
}) => {
  const selectedTokens = useSwapStore((s) => s.selectedTokens);
  const amountByToken = useSwapStore((s) => s.amountByToken);
  const setQuote = useSwapStore((s) => s.setQuote);
  const { fetchRouteSummary, computePriceImpactRatio } = useKyberSwap();

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const dep = useMemo(() => {
    const keys = [...selectedTokens].sort();
    return keys.map((k) => `${k}:${amountByToken[k] ?? ""}`).join("|");
  }, [selectedTokens, amountByToken]);

  useEffect(() => {
    const timers = timersRef.current;
    const controllers = controllersRef.current;

    if (!params.userAddress) {
      return;
    }

    const { selectedTokens: selected, amountByToken: amounts } =
      useSwapStore.getState();

    for (const key of timers.keys()) {
      if (!selected.has(key)) {
        clearTimeout(timers.get(key)!);
        timers.delete(key);
        controllers.get(key)?.abort();
        controllers.delete(key);
      }
    }

    for (const raw of selected) {
      const amountWei = amounts[raw] ?? "0";
      if (amountWei === "0" || amountWei === "") {
        controllersRef.current.get(raw)?.abort();
        controllersRef.current.delete(raw);
        setQuote(raw as Address, { status: "idle" });
        continue;
      }

      const prevTimer = timers.get(raw);
      if (prevTimer) {
        clearTimeout(prevTimer);
      }

      setQuote(raw as Address, { status: "loading" });

      const timerId = setTimeout(() => {
        controllers.get(raw)?.abort();
        const ac = new AbortController();
        controllers.set(raw, ac);

        const run = async () => {
          try {
            const summary = await fetchRouteSummary({
              tokenIn: raw as Address,
              amountIn: BigInt(amountWei),
              signal: ac.signal,
            });
            if (ac.signal.aborted) {
              return;
            }
            if (!summary) {
              setQuote(raw as Address, {
                status: "no_route",
                errorMessage: "No route found",
              });
              return;
            }
            setQuote(raw as Address, {
              status: "ok",
              amountOutWei: summary.amountOut,
              gasEstimate: summary.gas,
              priceImpactRatio: computePriceImpactRatio(summary),
              routeSummary: summary,
            });
          } catch (e) {
            if (ac.signal.aborted) {
              return;
            }
            const msg = e instanceof Error ? e.message : "Quote failed";
            setQuote(raw as Address, {
              status: "error",
              errorMessage: msg,
            });
          }
        };

        void run();
      }, 400);

      timers.set(raw, timerId);
    }

    return () => {
      for (const id of timers.values()) {
        clearTimeout(id);
      }
      timers.clear();
      for (const c of controllers.values()) {
        c.abort();
      }
      controllers.clear();
    };
  }, [
    dep,
    params.userAddress,
    fetchRouteSummary,
    computePriceImpactRatio,
    setQuote,
  ]);

  return null;
};
