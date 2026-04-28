import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { getBalance } from "viem/actions";
import { formatBalance, redactRpcUrl } from "@/lib/format";
import { buildPublicClient } from "@/lib/rpc/client";
import { useNetworksStore } from "@/lib/stores/networks";

export interface BalanceResult {
  value: bigint;
  formatted: string;
  symbol: string;
}

export function useBalance(
  address: string | undefined,
  networkId: string | undefined,
): UseQueryResult<BalanceResult, Error> {
  return useQuery({
    queryKey: ["balance", address, networkId],
    enabled: Boolean(address && networkId),
    queryFn: async () => {
      if (!address || !networkId)
        throw new Error("Missing balance query input");
      const network = useNetworksStore
        .getState()
        .networks.find((n) => n.id === networkId);
      if (!network) throw new Error("Network not found");
      const client = buildPublicClient(network);
      const value = await getBalance(client, {
        address: address as `0x${string}`,
      });
      return {
        value,
        formatted: formatBalance(value),
        symbol: network.currencySymbol,
      };
    },
  });
}

export function categorizeBalanceError(err: Error): {
  kind: "network" | "rpc" | "config" | "unknown";
  message: string;
} {
  const message = redactUrls(err.message);
  const lower = message.toLowerCase();
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("failed to fetch")
  ) {
    return { kind: "network", message: "Could not connect to the RPC." };
  }
  if (lower.includes("network not found") || lower.includes("invalid")) {
    return { kind: "config", message: "Invalid network configuration." };
  }
  if (
    lower.includes("rpc") ||
    lower.includes("json-rpc") ||
    lower.includes("request failed")
  ) {
    return { kind: "rpc", message };
  }
  return { kind: "unknown", message };
}

function redactUrls(message: string): string {
  return message.replace(/https?:\/\/[^\s)]+/g, (url) => redactRpcUrl(url));
}
