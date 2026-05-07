import type { Address } from "viem";

export interface KyberRouteHop {
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  swapAmount: string;
  amountOut: string;
  exchange: string;
  poolType: string;
}

export interface KyberExtraFee {
  feeAmount: string;
  chargeFeeBy: string;
  isInBps: boolean;
  feeReceiver: string;
}

export interface RouteSummary {
  tokenIn: Address;
  amountIn: string;
  amountInUsd: string;
  tokenOut: Address;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasPrice: string;
  gasUsd: string;
  l1FeeUsd: string;
  extraFee: KyberExtraFee;
  route: KyberRouteHop[][];
  routeID?: string;
  checksum?: string;
  timestamp?: string;
}

export interface KyberRoutesResponse {
  code: number;
  message: string;
  data: {
    routeSummary: RouteSummary;
  } | null;
}

export interface KyberBuildData {
  amountIn: string;
  amountInUsd: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasUsd: string;
  additionalCostUsd: string;
  additionalCostMessage: string;
  outputChange: unknown;
  data: `0x${string}`;
  routerAddress: Address;
  transactionValue: string;
}

export interface KyberBuildResponse {
  code: number;
  message: string;
  data: KyberBuildData | null;
}
