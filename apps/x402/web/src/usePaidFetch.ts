import { useMemo } from "react";
import { defineChain } from "thirdweb";
import { viemAdapter } from "thirdweb/adapters/viem";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { thirdwebClient } from "./config";

export type PaidFetch = (
  input: RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export function usePaidFetch(): PaidFetch | null {
  const { data: walletClient } = useWalletClient();
  const { address, chainId: accountChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  return useMemo(() => {
    if (!walletClient || !address || !accountChainId) return null;

    // Convert the wagmi walletClient into a thirdweb Account (provides
    // signTypedData, signMessage, sendTransaction, etc.).
    const account = viemAdapter.walletClient.fromViem({ walletClient });

    // thirdweb's built-in `viemAdapter.wallet.fromViem` helper returns a
    // wallet whose internal account/chain state is never initialised (it
    // relies on a .connect() call that never happens when we're already
    // connected via wagmi). As a result `wallet.getAccount()` and
    // `wallet.getChain()` both return undefined, and `wrapFetchWithPayment`
    // throws "Wallet not connected" at signing time. Build the minimal Wallet
    // surface wrapFetchWithPayment actually uses directly from wagmi state.
    let currentChain = defineChain(accountChainId);
    const wallet = {
      id: "wagmi-adapter",
      getAccount: () => account,
      getChain: () => currentChain,
      switchChain: async (c: { id: number }) => {
        await switchChainAsync({ chainId: c.id as 80094 | 80069 });
        currentChain = defineChain(c.id);
      },
      subscribe: () => () => {},
      connect: async () => account,
      autoConnect: async () => account,
      disconnect: async () => {},
      getConfig: () => undefined,
    } as unknown as Parameters<typeof wrapFetchWithPayment>[2];

    return wrapFetchWithPayment(fetch, thirdwebClient, wallet);
  }, [walletClient, address, accountChainId, switchChainAsync]);
}
