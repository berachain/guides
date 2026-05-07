import { useCallback } from "react";
import type { Address, Hex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useERC5792Execution } from "./useERC5792";
import { useKyberSwap } from "./useKyberSwap";
import { useWallet } from "./useWallet";
import { encodeErc20Approve } from "../lib/erc20";
import { erc20AllowanceCall } from "../lib/erc20";
import type { WalletCall } from "../types/erc5792";
import { ERC5792RpcError } from "../types/erc5792";
import { useSwapStore } from "../store/swapStore";

const VALUE_ZERO = "0x0" as Hex;
const SLIPPAGE_BPS = 50;
const DEADLINE_SEC = 300;

export const useSwapBatch = () => {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { sendCalls } = useERC5792Execution();
  const { fetchRouteSummary, buildCalldata } = useKyberSwap();
  const { wrongChain, ensureBerachain } = useWallet();

  const batchCapability = useSwapStore((s) => s.batchCapability);
  const selectedTokens = useSwapStore((s) => s.selectedTokens);
  const amountByToken = useSwapStore((s) => s.amountByToken);
  const setSwapPhase = useSwapStore((s) => s.setSwapPhase);
  const setBatchId = useSwapStore((s) => s.setBatchId);
  const setLastError = useSwapStore((s) => s.setLastError);
  const setQuote = useSwapStore((s) => s.setQuote);

  const executeSwap = useCallback(async () => {
    if (!address || !publicClient) {
      setLastError("Connect wallet first");
      return;
    }
    if (wrongChain) {
      setLastError("Switch to Berachain");
      return;
    }
    if (batchCapability !== "supported") {
      setLastError(
        "Wallet does not support ERC-5792 atomic batch on Berachain",
      );
      return;
    }

    const selected = [...selectedTokens];
    if (selected.length === 0) {
      setLastError("Select at least one token");
      return;
    }

    for (const t of selected) {
      const amt = amountByToken[t] ?? "0";
      if (amt === "0" || amt === "") {
        setLastError("Enter amounts for all selected tokens");
        return;
      }
    }

    setLastError(null);
    setSwapPhase("fetching_routes");

    const ac = new AbortController();
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SEC;

    try {
      await ensureBerachain();
    } catch {
      setSwapPhase("error");
      setLastError("Failed to switch network");
      return;
    }

    type Built = {
      token: Address;
      amount: bigint;
      router: Address;
      data: Hex;
    };

    const built: Built[] = [];

    try {
      const routeResults = await Promise.all(
        selected.map(async (key) => {
          const amountWei = BigInt(amountByToken[key] ?? "0");
          const route = await fetchRouteSummary({
            tokenIn: key as Address,
            amountIn: amountWei,
            signal: ac.signal,
          });
          return { key, amountWei, route };
        }),
      );

      const builds = await Promise.all(
        routeResults.map(async (row) => {
          if (!row.route) {
            setQuote(row.key as Address, {
              status: "no_route",
              errorMessage: "No route (refresh)",
            });
            return null;
          }
          const b = await buildCalldata({
            routeSummary: row.route,
            sender: address,
            recipient: address,
            slippageToleranceBps: SLIPPAGE_BPS,
            deadlineUnix: deadline,
            signal: ac.signal,
          });
          if (!b) {
            setQuote(row.key as Address, {
              status: "error",
              errorMessage: "Build calldata failed",
            });
            return null;
          }
          return {
            token: row.key as Address,
            amount: row.amountWei,
            router: b.routerAddress,
            data: b.data,
          } satisfies Built;
        }),
      );

      for (const item of builds) {
        if (item) {
          built.push(item);
        }
      }

      if (built.length === 0) {
        setSwapPhase("error");
        setLastError("No valid routes to execute");
        return;
      }

      const allowanceContracts = built.map((b) =>
        erc20AllowanceCall({
          token: b.token,
          owner: address,
          spender: b.router,
        }),
      );

      const allowanceRes = await publicClient.multicall({
        contracts: allowanceContracts,
        allowFailure: true,
      });

      const calls: WalletCall[] = [];

      for (let i = 0; i < built.length; i++) {
        const b = built[i];
        const allowRow = allowanceRes[i];
        const current =
          allowRow.status === "success" ? (allowRow.result as bigint) : 0n;
        if (current < b.amount) {
          calls.push({
            to: b.token,
            data: encodeErc20Approve({ spender: b.router, amount: b.amount }),
            value: VALUE_ZERO,
          });
        }
        calls.push({
          to: b.router,
          data: b.data,
          value: VALUE_ZERO,
        });
      }

      setSwapPhase("awaiting_wallet");
      const batchId = await sendCalls(calls);
      setBatchId(batchId);
      setSwapPhase("pending");
    } catch (e) {
      const msg =
        e instanceof ERC5792RpcError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Swap failed";
      setSwapPhase("error");
      setLastError(msg);
    }
  }, [
    address,
    amountByToken,
    batchCapability,
    buildCalldata,
    ensureBerachain,
    fetchRouteSummary,
    publicClient,
    selectedTokens,
    sendCalls,
    setBatchId,
    setLastError,
    setQuote,
    setSwapPhase,
    wrongChain,
  ]);

  return { executeSwap };
};
