import { useCallback, useMemo } from "react";
import type { EIP1193Provider } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { berachain } from "../lib/berachain";

export const useWallet = () => {
  const { address, isConnected, status, connector } = useAccount();
  const chainId = useChainId();
  const {
    connect,
    connectors,
    isPending: isConnectPending,
    error: connectError,
  } = useConnect();
  const { disconnect } = useDisconnect();
  const {
    switchChain,
    isPending: isSwitchPending,
    error: switchError,
  } = useSwitchChain();

  const getEthereumProvider =
    useCallback(async (): Promise<EIP1193Provider | null> => {
      if (!connector) {
        return null;
      }
      try {
        const p = await connector.getProvider();
        return p as EIP1193Provider;
      } catch {
        return null;
      }
    }, [connector]);

  const ensureBerachain = useCallback(async () => {
    if (chainId === berachain.id) {
      return true;
    }
    await switchChain({ chainId: berachain.id });
    return true;
  }, [chainId, switchChain]);

  const connectMetaMask = useCallback(() => {
    const mm = connectors.find((c) => c.id === "metaMask");
    if (mm) {
      connect({ connector: mm, chainId: berachain.id });
      return;
    }
    connect({ connector: connectors[0], chainId: berachain.id });
  }, [connect, connectors]);

  const wrongChain = isConnected && chainId !== berachain.id;

  const summary = useMemo(
    () => ({
      address,
      isConnected,
      status,
      chainId,
      wrongChain,
    }),
    [address, chainId, isConnected, status, wrongChain],
  );

  return {
    ...summary,
    connectMetaMask,
    disconnect,
    ensureBerachain,
    getEthereumProvider,
    isConnectPending,
    isSwitchPending,
    connectError,
    switchError,
    switchToBerachain: () => switchChain({ chainId: berachain.id }),
  };
};
