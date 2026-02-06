import { ref, computed } from 'vue'
import { createWalletClient, createPublicClient, custom, http, defineChain } from 'viem'
import { MULTICALL3_ADDRESS } from '../constants/addresses.js'

export function useWallet() {
  const account = ref(null)
  const walletClient = ref(null)
  const publicClient = ref(null)
  const chain = ref(null)
  const isConnecting = ref(false)
  const error = ref(null)

  let accountsHandler = null

  function removeAccountsListener() {
    if (accountsHandler && window.ethereum?.removeListener) {
      window.ethereum.removeListener('accountsChanged', accountsHandler)
      accountsHandler = null
    }
  }

  function registerAccountsListener() {
    removeAccountsListener()
    accountsHandler = (newAccounts) => {
      if (newAccounts.length === 0) {
        disconnect()
      } else {
        account.value = newAccounts[0]
        localStorage.setItem('wallet_connected_account', newAccounts[0])
        walletClient.value = createWalletClient({
          account: newAccounts[0],
          chain: chain.value,
          transport: custom(window.ethereum)
        })
      }
    }
    window.ethereum.on('accountsChanged', accountsHandler)
  }

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
      transport: http(config.network.rpcUrl)
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
      localStorage.setItem('wallet_connected_account', accounts[0])

      await ensureWalletChain()

      walletClient.value = createWalletClient({
        account: account.value,
        chain: chain.value,
        transport: custom(window.ethereum)
      })

      registerAccountsListener()

    } catch (err) {
      error.value = err.message || 'Failed to connect wallet'
    } finally {
      isConnecting.value = false
    }
  }

  async function reconnect() {
    const savedAccount = localStorage.getItem('wallet_connected_account')
    if (!savedAccount || !window.ethereum || !chain.value) return

    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' })
      if (accounts.length === 0 || !accounts.includes(savedAccount)) {
        localStorage.removeItem('wallet_connected_account')
        return
      }

      account.value = savedAccount
      await ensureWalletChain()
      walletClient.value = createWalletClient({
        account: savedAccount,
        chain: chain.value,
        transport: custom(window.ethereum)
      })

      registerAccountsListener()
    } catch (err) {
      localStorage.removeItem('wallet_connected_account')
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
    removeAccountsListener()
    account.value = null
    walletClient.value = null
    error.value = null
    localStorage.removeItem('wallet_connected_account')
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
    disconnect,
    reconnect
  }
}
