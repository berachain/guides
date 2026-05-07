import type { Address } from "viem";

export interface Token {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logoUri: string;
  /** Optional CoinGecko id for price fallbacks */
  coingeckoId?: string;
}

export interface TokenWithBalance extends Token {
  balance: bigint;
  formattedBalance: string;
  usdPrice: number;
  usdValue: number;
}

export interface SelectedToken {
  token: TokenWithBalance;
  /** Swap amount in token wei as decimal string */
  amountWei: string;
  selected: boolean;
}
