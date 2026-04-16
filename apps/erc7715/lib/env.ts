/**
 * Public build-time defaults from `.env` / `.env.local` (see `next.config.ts` `env` map).
 * Used for `to` (session account) and ERC-20 `tokenAddress` when the form loads.
 */
export const env = {
  sessionAccountAddress: (process.env.SESSION_ACCOUNT_ADDRESS ?? '').trim(),
  tokenAddress: (process.env.TOKEN_ADDRESS ?? '').trim(),
} as const
