import { useState } from 'react'
import { createWalletClient, custom } from 'viem'

export default function WalletConnect({ account, setAccount, setWalletClient, chain }) {
  const [connecting, setConnecting] = useState(false)

  const connect = async () => {
    if (!window.ethereum) {
      alert('Please install MetaMask!')
      return
    }

    try {
      setConnecting(true)
      
      // Request accounts
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      })

      // Switch to correct chain
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chain.id.toString(16)}` }]
        })
      } catch (switchError) {
        // Chain not added, try adding it
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${chain.id.toString(16)}`,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [chain.rpcUrls.default.http[0]],
              blockExplorerUrls: [chain.blockExplorers.default.url]
            }]
          })
        } else {
          throw switchError
        }
      }

      const walletClient = createWalletClient({
        chain,
        transport: custom(window.ethereum)
      })

      setAccount(accounts[0])
      setWalletClient(walletClient)
    } catch (error) {
      console.error('Connection error:', error)
      alert('Failed to connect wallet')
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = () => {
    setAccount(null)
    setWalletClient(null)
  }

  if (account) {
    return (
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <div className="address">{account.slice(0, 6)}...{account.slice(-4)}</div>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    )
  }

  return (
    <button onClick={connect} disabled={connecting}>
      {connecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  )
}





