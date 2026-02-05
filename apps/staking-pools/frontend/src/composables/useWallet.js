import { ref, computed } from 'vue'
import { createWalletClient, createPublicClient, custom, http, defineChain } from 'viem'

const account = ref(null)
const walletClient = ref(null)
const publicClient = ref(null)
const chain = ref(null)
const isConnecting = ref(false)
const error = ref(null)

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

export function useWallet() {
  const isConnected = computed(() => !!account.value)
  const shortAddress = computed(() => {
    if (!account.value) return ''
    return `${account.value.slice(0, 6)}...${account.value.slice(-4)}`
  })

  async function initializeChain(config) {
    const customChain = defineChain({
      id: config.network.chainId,
      name: config.network.name,
      nativeCurrency: { name: 'BERA', symbol: 'BERA', decimals: 18 },
      rpcUrls: { default: { http: [config.network.rpcUrl] } },
      blockExplorers: { default: { name: 'Explorer', url: config.network.explorerUrl } },
      contracts: {
        multicall3: {
          address: MULTICALL3_ADDRESS
        }
      }
    })
    
    chain.value = customChain
    publicClient.value = createPublicClient({
      chain: customChain,
      transport: http()
    })
  }

  async function connect() {
    if (!window.ethereum) {
      error.value = 'No wallet found. Please install MetaMask.'
      return
    }

    if (!chain.value) {
      error.value = 'Chain not initialized. Load config first.'
      return
    }

    try {
      isConnecting.value = true
      error.value = null

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      })

      if (accounts.length === 0) {
        error.value = 'No accounts found'
        return
      }

      account.value = accounts[0]

      await ensureWalletChain()

      walletClient.value = createWalletClient({
        account: account.value,
        chain: chain.value,
        transport: custom(window.ethereum)
      })

      // Listen for account changes
      window.ethereum.on('accountsChanged', (newAccounts) => {
        if (newAccounts.length === 0) {
          disconnect()
        } else {
          account.value = newAccounts[0]
          walletClient.value = createWalletClient({
            account: newAccounts[0],
            chain: chain.value,
            transport: custom(window.ethereum)
          })
        }
      })

    } catch (err) {
      error.value = err.message || 'Failed to connect wallet'
    } finally {
      isConnecting.value = false
    }
  }

  async function ensureWalletChain() {
    if (!window.ethereum || !chain.value?.id) return

    const targetHex = `0x${chain.value.id.toString(16)}`
    const currentHex = await window.ethereum.request({ method: 'eth_chainId' })
    if (currentHex && currentHex.toLowerCase() === targetHex.toLowerCase()) return

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetHex }]
      })
    } catch (err) {
      const code = err?.code ?? err?.data?.originalError?.code
      if (code !== 4902) throw err

      const rpcUrls = chain.value.rpcUrls?.default?.http || []
      const blockExplorerUrls = chain.value.blockExplorers?.default?.url
        ? [chain.value.blockExplorers.default.url]
        : undefined

      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: targetHex,
            chainName: chain.value.name,
            nativeCurrency: chain.value.nativeCurrency,
            rpcUrls,
            blockExplorerUrls
          }
        ]
      })
    }
  }

  function disconnect() {
    account.value = null
    walletClient.value = null
    error.value = null
  }

  return {
    account,
    walletClient,
    publicClient,
    chain,
    isConnected,
    isConnecting,
    shortAddress,
    error,
    initializeChain,
    connect,
    disconnect
  }
}
