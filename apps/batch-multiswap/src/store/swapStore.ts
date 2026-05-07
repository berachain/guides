import { create } from "zustand";
import type { Hex } from "viem";
import type { Address } from "viem";
import type { RouteSummary } from "../types/kyberswap";
import type { CallsId } from "../types/erc5792";

export type BatchCapabilityState =
  | "loading"
  | "supported"
  | "not_supported"
  | "upgrade_required"
  | "wrong_network"
  | "error";

export type SwapPhase =
  | "idle"
  | "fetching_routes"
  | "awaiting_wallet"
  | "pending"
  | "success"
  | "error";

export type TokenQuoteStatus = "idle" | "loading" | "ok" | "no_route" | "error";

export interface TokenQuote {
  status: TokenQuoteStatus;
  amountOutWei?: string;
  gasEstimate?: string;
  priceImpactRatio?: number;
  routeSummary?: RouteSummary;
  errorMessage?: string;
}

interface SwapStore {
  batchCapability: BatchCapabilityState;
  setBatchCapability: (s: BatchCapabilityState) => void;

  /** Lowercased token address -> amount in wei (decimal string) */
  amountByToken: Record<string, string>;
  setTokenAmount: (token: Address, amountWei: string) => void;

  /** Lowercased addresses */
  selectedTokens: Set<string>;
  toggleTokenSelected: (token: Address, selected: boolean) => void;
  setSelectedTokens: (addresses: readonly Address[]) => void;

  quotes: Record<string, TokenQuote>;
  setQuote: (token: Address, quote: TokenQuote) => void;
  clearQuotes: () => void;

  swapPhase: SwapPhase;
  setSwapPhase: (p: SwapPhase) => void;

  batchId: CallsId | null;
  setBatchId: (id: CallsId | null) => void;

  lastError: string | null;
  setLastError: (msg: string | null) => void;

  successTxHash: Hex | null;
  setSuccessTxHash: (h: Hex | null) => void;

  pollWarning: string | null;
  setPollWarning: (w: string | null) => void;

  balanceRefreshNonce: number;
  bumpBalanceRefresh: () => void;

  resetSwapUi: () => void;
}

const emptySelected = () => new Set<string>();

export const useSwapStore = create<SwapStore>((set) => ({
  batchCapability: "loading",
  setBatchCapability: (batchCapability) => set({ batchCapability }),

  amountByToken: {},
  setTokenAmount: (token, amountWei) =>
    set((s) => ({
      amountByToken: {
        ...s.amountByToken,
        [token.toLowerCase()]: amountWei,
      },
    })),

  selectedTokens: emptySelected(),
  toggleTokenSelected: (token, selected) =>
    set((s) => {
      const next = new Set(s.selectedTokens);
      const k = token.toLowerCase();
      if (selected) {
        next.add(k);
      } else {
        next.delete(k);
      }
      return { selectedTokens: next };
    }),
  setSelectedTokens: (addresses) =>
    set({
      selectedTokens: new Set(addresses.map((a) => a.toLowerCase())),
    }),

  quotes: {},
  setQuote: (token, quote) =>
    set((s) => ({
      quotes: { ...s.quotes, [token.toLowerCase()]: quote },
    })),
  clearQuotes: () => set({ quotes: {} }),

  swapPhase: "idle",
  setSwapPhase: (swapPhase) => set({ swapPhase }),

  batchId: null,
  setBatchId: (batchId) => set({ batchId }),

  lastError: null,
  setLastError: (lastError) => set({ lastError }),

  successTxHash: null,
  setSuccessTxHash: (successTxHash) => set({ successTxHash }),

  pollWarning: null,
  setPollWarning: (pollWarning) => set({ pollWarning }),

  balanceRefreshNonce: 0,
  bumpBalanceRefresh: () =>
    set((s) => ({ balanceRefreshNonce: s.balanceRefreshNonce + 1 })),

  resetSwapUi: () =>
    set({
      swapPhase: "idle",
      batchId: null,
      lastError: null,
      successTxHash: null,
      pollWarning: null,
    }),
}));
