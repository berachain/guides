import { hexToBigInt } from 'viem'

export function hexChainIdToNumericString(hex: `0x${string}`): string {
  return hexToBigInt(hex).toString()
}
