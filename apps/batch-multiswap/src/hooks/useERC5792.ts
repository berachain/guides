import { useCallback, useEffect } from "react";
import { useAccount, useChainId } from "wagmi";
import {
  walletGetCallsStatus,
  walletGetCapabilities,
  walletSendCalls,
} from "../lib/erc5792";
import { BERACHAIN_CHAIN_ID_HEX, berachain } from "../lib/berachain";
import type {
  ChainCapabilitiesEntry,
  CallsId,
  SendCallsParamsV2,
  WalletCapabilitiesMap,
} from "../types/erc5792";
import { useSwapStore } from "../store/swapStore";
import { useWallet } from "./useWallet";

const findChainCapabilities = (
  caps: WalletCapabilitiesMap,
  chainId: number,
): ChainCapabilitiesEntry | undefined => {
  const target = BigInt(chainId);
  for (const [key, entry] of Object.entries(caps)) {
    if (!key.startsWith("0x") || !entry) {
      continue;
    }
    try {
      if (BigInt(key) === target) {
        return entry;
      }
    } catch {
      continue;
    }
  }
  return undefined;
};

const classifyBatch = (
  caps: WalletCapabilitiesMap,
  chainId: number,
): "supported" | "not_supported" | "upgrade_required" => {
  const chainEntry = findChainCapabilities(caps, chainId);
  if (!chainEntry) {
    return "upgrade_required";
  }

  const atomicCapability = chainEntry.atomic ?? chainEntry.atomicBatch;
  if (!atomicCapability) {
    return "upgrade_required";
  }

  if (atomicCapability.supported !== undefined) {
    return atomicCapability.supported ? "supported" : "not_supported";
  }

  const status = atomicCapability.status?.toLowerCase();
  if (status === "supported" || status === "ready") {
    return "supported";
  }

  return "not_supported";
};

export const useERC5792Capabilities = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { getEthereumProvider } = useWallet();
  const setBatchCapability = useSwapStore((s) => s.setBatchCapability);

  const refreshCapabilities = useCallback(async () => {
    if (!isConnected || !address) {
      setBatchCapability("loading");
      return;
    }
    setBatchCapability("loading");
    const provider = await getEthereumProvider();
    if (!provider) {
      setBatchCapability("error");
      return;
    }
    try {
      if (chainId !== berachain.id) {
        setBatchCapability("wrong_network");
        return;
      }
      const caps = await walletGetCapabilities(provider, address);
      const kind = classifyBatch(caps, berachain.id);
      setBatchCapability(kind);
    } catch {
      setBatchCapability("upgrade_required");
    }
  }, [address, chainId, getEthereumProvider, isConnected, setBatchCapability]);

  return { refreshCapabilities };
};

export const useERC5792Execution = () => {
  const { getEthereumProvider } = useWallet();

  const sendCalls = useCallback(
    async (calls: SendCallsParamsV2["calls"]) => {
      const provider = await getEthereumProvider();
      if (!provider) {
        throw new Error("Wallet provider unavailable");
      }
      const params: SendCallsParamsV2 = {
        version: "2.0.0",
        chainId: BERACHAIN_CHAIN_ID_HEX,
        calls,
        capabilities: {},
        atomicRequired: true,
      };
      return walletSendCalls(provider, params);
    },
    [getEthereumProvider],
  );

  const getCallsStatus = useCallback(
    async (batchId: CallsId) => {
      const provider = await getEthereumProvider();
      if (!provider) {
        throw new Error("Wallet provider unavailable");
      }
      return walletGetCallsStatus(provider, batchId);
    },
    [getEthereumProvider],
  );

  return { sendCalls, getCallsStatus };
};

/** Runs wallet_getCapabilities after connection and on every chain switch. */
export const useERC5792CapabilitySync = () => {
  const { refreshCapabilities } = useERC5792Capabilities();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  useEffect(() => {
    void refreshCapabilities();
  }, [address, chainId, isConnected, refreshCapabilities]);
};
