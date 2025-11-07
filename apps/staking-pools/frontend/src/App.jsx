import { useState, useEffect } from 'react'
import { createPublicClient, http } from 'viem'
import { defineChain } from 'viem'
// load config at runtime to allow server-side configuration
let runtimeConfig = null
async function loadConfig() {
  if (runtimeConfig) return runtimeConfig
  const res = await fetch('/config.json')
  runtimeConfig = await res.json()
  return runtimeConfig
}
import WalletConnect from './components/WalletConnect'
import UserPage from './pages/UserPage'
import './App.css'

function makeChain(cfg) {
  return defineChain({
    id: cfg.network.chainId,
    name: cfg.network.name,
    nativeCurrency: { name: 'BERA', symbol: 'BERA', decimals: 18 },
    rpcUrls: { default: { http: [cfg.network.rpcUrl] } },
    blockExplorers: { default: { name: 'BeraScan', url: cfg.network.explorerUrl } }
  })
}

export default function App() {
  const [account, setAccount] = useState(null)
  const [client, setClient] = useState(null)
  const [walletClient, setWalletClient] = useState(null)
  const [selectedPool, setSelectedPool] = useState('')
  const [config, setConfig] = useState(null)
  const [chain, setChain] = useState(null)

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig()
      setConfig(cfg)
      const ch = makeChain(cfg)
      setChain(ch)
      const publicClient = createPublicClient({ chain: ch, transport: http() })
      setClient(publicClient)
    })()
  }, [])

  const enabledPools = config ? Object.entries(config.pools)
    .filter(([_, pool]) => pool.enabled)
    .map(([key, pool]) => ({ key, ...pool, withdrawalVault: config.contracts.withdrawalVault })) : []

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>🐻 Staking Pools Manager</h1>
          <WalletConnect 
            account={account}
            setAccount={setAccount}
            setWalletClient={setWalletClient}
            chain={chain}
          />
        </div>
      </header>

      <div className="container">
        {enabledPools.length > 0 && (
          <div className="pool-selector">
            <label>Select Pool:</label>
            <select 
              value={selectedPool} 
              onChange={(e) => setSelectedPool(e.target.value)}
            >
              <option value="">-- Select a pool --</option>
              {enabledPools.map(pool => (
                <option key={pool.key} value={pool.key}>
                  {pool.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <main className="content">
          {!account ? (
            <div className="connect-prompt">
              <h2>Connect Your Wallet</h2>
              <p>Please connect your wallet to interact with staking pools</p>
            </div>
          ) : !selectedPool && enabledPools.length > 0 ? (
            <div className="connect-prompt">
              <h2>Select a Pool</h2>
              <p>Please select a staking pool from the dropdown above</p>
            </div>
          ) : (
            <UserPage 
              account={account}
              client={client}
              walletClient={walletClient}
              poolConfig={enabledPools.find(p => p.key === selectedPool)}
            />
          )}
        </main>
      </div>
    </div>
  )
}

