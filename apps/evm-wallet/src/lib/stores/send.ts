import { create } from 'zustand';

export type GasPreset = 'slow' | 'normal' | 'fast';

export interface SendDraft {
  walletId: string;
  accountIndex: number;
  networkId: string;
  to: `0x${string}`;
  amountWei: bigint;
  gasPreset: GasPreset;
  estimatedMaxFeePerGas: bigint;
  estimatedMaxPriorityFeePerGas: bigint;
  estimatedGasLimit: bigint;
}

interface SendState {
  draft: SendDraft | null;
  setDraft: (draft: SendDraft) => void;
  clearDraft: () => void;
}

export const useSendStore = create<SendState>((set) => ({
  draft: null,
  setDraft: (draft) => {
    set({ draft });
  },
  clearDraft: () => {
    set({ draft: null });
  },
}));
