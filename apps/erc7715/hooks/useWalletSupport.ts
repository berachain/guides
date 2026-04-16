"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { fetchWalletSupportedExecutionPermissions } from "@/lib/walletExecutionPermissions";
import type { GetSupportedExecutionPermissionsResult } from "@/types/erc7715";

// Composes with `useRequestPermissions` on the page once Phase 1 has completed successfully.

export type UseWalletSupportReturn = {
  data: GetSupportedExecutionPermissionsResult | undefined;
  rawResponse: unknown;
  isLoading: boolean;
  isError: boolean;
  isUnsupported: boolean;
  errorCode: number | undefined;
  errorMessage: string | undefined;
  refetch: () => void;
};

export function useWalletSupport(): UseWalletSupportReturn {
  const { address, isConnected, status } = useConnection();
  const enabled = isConnected && !!address && status === "connected";

  const query = useQuery({
    queryKey: ["wallet_getSupportedExecutionPermissions", address],
    queryFn: fetchWalletSupportedExecutionPermissions,
    enabled,
  });

  const result = query.data;

  const isUnsupported = result?.status === "unsupported";
  const isError = result?.status === "error" || query.isError;

  return {
    data: result?.status === "ok" ? result.data : undefined,
    rawResponse: result?.status === "ok" ? result.raw : undefined,
    isLoading: enabled && query.isPending,
    isError,
    isUnsupported,
    errorCode: isUnsupported
      ? -32601
      : result?.status === "error"
        ? result.errorCode
        : undefined,
    errorMessage:
      result?.status === "error"
        ? result.message
        : query.error instanceof Error
          ? query.error.message
          : undefined,
    refetch: () => {
      void query.refetch();
    },
  };
}
