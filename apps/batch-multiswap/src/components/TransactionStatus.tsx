import { useEffect, useRef } from "react";
import type { Hex } from "viem";
import { useERC5792Execution } from "../hooks/useERC5792";
import { useSwapStore } from "../store/swapStore";
import { ERC5792RpcError } from "../types/erc5792";

const normalizeStatusCode = (raw: unknown): number => {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) ? n : 400;
};

const berascanTxUrl = (hash: Hex) => `https://berascan.com/tx/${hash}`;

export const TransactionStatus = () => {
  const swapPhase = useSwapStore((s) => s.swapPhase);
  const batchId = useSwapStore((s) => s.batchId);
  const successTxHash = useSwapStore((s) => s.successTxHash);
  const lastError = useSwapStore((s) => s.lastError);
  const pollWarning = useSwapStore((s) => s.pollWarning);
  const setSwapPhase = useSwapStore((s) => s.setSwapPhase);
  const setSuccessTxHash = useSwapStore((s) => s.setSuccessTxHash);
  const setLastError = useSwapStore((s) => s.setLastError);
  const setPollWarning = useSwapStore((s) => s.setPollWarning);
  const bumpBalanceRefresh = useSwapStore((s) => s.bumpBalanceRefresh);
  const resetSwapUi = useSwapStore((s) => s.resetSwapUi);

  const { getCallsStatus } = useERC5792Execution();
  const startedAt = useRef(0);

  useEffect(() => {
    if (swapPhase !== "pending" || !batchId) {
      return;
    }

    startedAt.current = Date.now();
    const maxMs = 3 * 60 * 1000;

    const tick = async () => {
      const id = useSwapStore.getState().batchId;
      const phase = useSwapStore.getState().swapPhase;
      if (!id || phase !== "pending") {
        return;
      }
      if (Date.now() - startedAt.current > maxMs) {
        setPollWarning("Transaction taking long — check your wallet");
        setSwapPhase("error");
        setLastError("Polling timed out after 3 minutes");
        return;
      }
      try {
        const st = await getCallsStatus(id);
        const code = normalizeStatusCode(st.status);
        if (code === 100) {
          return;
        }
        if (code === 200) {
          const txh =
            st.transactionHash ??
            (st.receipts?.[0]?.transactionHash as Hex | undefined) ??
            null;
          setSuccessTxHash(txh);
          setSwapPhase("success");
          setPollWarning(null);
          bumpBalanceRefresh();
          window.setTimeout(() => resetSwapUi(), 5000);
          return;
        }
        if (code === 400) {
          setSwapPhase("error");
          setLastError(st.reason ?? st.message ?? "Batch failed");
          setPollWarning(null);
        }
      } catch (e) {
        const msg =
          e instanceof ERC5792RpcError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Status check failed";
        setSwapPhase("error");
        setLastError(msg);
      }
    };

    const interval = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();

    return () => {
      window.clearInterval(interval);
    };
  }, [
    batchId,
    bumpBalanceRefresh,
    getCallsStatus,
    resetSwapUi,
    setLastError,
    setPollWarning,
    setSuccessTxHash,
    setSwapPhase,
    swapPhase,
  ]);

  if (
    swapPhase !== "pending" &&
    swapPhase !== "success" &&
    !pollWarning &&
    !lastError
  ) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4 text-sm">
      {swapPhase === "pending" && batchId ? (
        <div className="flex items-center gap-2 text-zinc-300">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          <span>
            Batch submitted ·{" "}
            <span className="font-mono text-xs">{batchId}</span>
          </span>
        </div>
      ) : null}
      {swapPhase === "success" && successTxHash ? (
        <div className="space-y-2 text-emerald-400">
          <p>Batch confirmed.</p>
          <a
            className="inline-flex rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 font-mono text-xs text-emerald-300 underline-offset-4 hover:bg-emerald-400/20 hover:underline"
            href={berascanTxUrl(successTxHash)}
            target="_blank"
            rel="noreferrer"
          >
            View on Berascan · {successTxHash.slice(0, 10)}…
            {successTxHash.slice(-8)}
          </a>
        </div>
      ) : null}
      {swapPhase === "success" && !successTxHash ? (
        <p className="text-emerald-400">Batch confirmed.</p>
      ) : null}
      {pollWarning ? (
        <p className="mt-2 text-yellow-400">{pollWarning}</p>
      ) : null}
      {lastError && swapPhase === "error" ? (
        <p className="mt-2 text-red-400">{lastError}</p>
      ) : null}
    </div>
  );
};
