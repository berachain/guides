import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { buildPublicClient } from "@/lib/rpc/client";
import type { Network } from "@/lib/types";

export interface GasEstimate {
  baseFeePerGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasLimit: bigint;
  estimatedFeeWei: bigint;
}

export function useGasEstimate(
  network: Network | undefined,
  to: `0x${string}` | undefined,
  from: `0x${string}` | undefined,
  value: bigint,
): UseQueryResult<GasEstimate, Error> {
  return useQuery({
    queryKey: ["gasEstimate", network?.id, to, from, value.toString()],
    enabled: Boolean(network && to && from && value >= 0n),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!network || !to || !from)
        throw new Error("Missing gas estimate input");
      const client = buildPublicClient(network);
      const [gasLimit, fees, block] = await Promise.all([
        client.estimateGas({ account: from as Address, to, value }),
        client.estimateFeesPerGas(),
        client.getBlock({ blockTag: "latest" }),
      ]);
      const baseFeePerGas = block.baseFeePerGas ?? 0n;
      const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
      const maxFeePerGas =
        fees.maxFeePerGas ?? baseFeePerGas + maxPriorityFeePerGas;
      const estimatedFeeWei = gasLimit * (baseFeePerGas + maxPriorityFeePerGas);

      return {
        baseFeePerGas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit,
        estimatedFeeWei,
      };
    },
  });
}
