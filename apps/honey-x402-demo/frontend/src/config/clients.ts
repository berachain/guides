import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

// Read private keys from environment variables (loaded from project root .env)
const tokenHolderKey = import.meta.env.PRIVATE_KEY as `0x${string}` | undefined
const gasSubsidizerKey = import.meta.env.PRIVATE_KEY_GAS_SUBSIDIZER as `0x${string}` | undefined

// Fallback to Anvil defaults if not set
const ANVIL_TOKEN_HOLDER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const ANVIL_GAS_SUBSIDIZER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const

const resolvedTokenHolderKey = tokenHolderKey || ANVIL_TOKEN_HOLDER_KEY
const resolvedGasSubsidizerKey = gasSubsidizerKey || ANVIL_GAS_SUBSIDIZER_KEY

// Create accounts from private keys
export const tokenHolderAccount = privateKeyToAccount(resolvedTokenHolderKey)
export const gasSubsidizerAccount = privateKeyToAccount(resolvedGasSubsidizerKey)

// Public client for reads
export const publicClient = createPublicClient({
  chain: anvil,
  transport: http('http://localhost:8545'),
})

// Token holder wallet client — used for signing permits/authorizations (off-chain, no gas)
export const tokenHolderClient = createWalletClient({
  account: tokenHolderAccount,
  chain: anvil,
  transport: http('http://localhost:8545'),
})

// Gas subsidizer wallet client — used for submitting signed messages on-chain (pays gas)
export const gasSubsidizerClient = createWalletClient({
  account: gasSubsidizerAccount,
  chain: anvil,
  transport: http('http://localhost:8545'),
})
