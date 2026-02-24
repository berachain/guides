import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WalletDisplay } from './components/WalletDisplay'
import { EIP2612Demo } from './components/EIP2612Demo'
import { Permit2Demo } from './components/Permit2Demo'
import { EIP3009Demo } from './components/EIP3009Demo'
import { tokenHolderAccount, gasSubsidizerAccount } from './config/clients'
import './App.css'

interface Deployments {
  honey?: string
  demo?: string
  permit2?: string
}

function App() {
  const [deployments, setDeployments] = useState<Deployments>({})
  const queryClient = useQueryClient()

  useEffect(() => {
    fetch('/deployments.json')
      .then(res => res.json())
      .then((data: Deployments) => {
        setDeployments({
          honey: data.honey,
          demo: data.demo,
          permit2: data.permit2,
        })
      })
      .catch(() => {
        console.warn('deployments.json not found. Please deploy contracts first.')
      })
  }, [])

  const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
  const honeyAddress = (deployments.honey && deployments.honey !== ZERO_ADDR ? deployments.honey : ZERO_ADDR) as `0x${string}`
  const demoAddress = (deployments.demo && deployments.demo !== ZERO_ADDR ? deployments.demo : ZERO_ADDR) as `0x${string}`
  const permit2Address = (deployments.permit2 && deployments.permit2 !== ZERO_ADDR ? deployments.permit2 : ZERO_ADDR) as `0x${string}`

  // Force all balance queries to refetch immediately after any transaction
  const handleTxComplete = useCallback(() => {
    queryClient.refetchQueries()
  }, [queryClient])

  return (
    <div className="app">
      <header>
        <h1>🍯 Honey Token: Gasless Transaction Demo</h1>
        <p className="subtitle">Comparing EIP-2612, Permit2, and EIP-3009</p>
        <p className="subtitle-detail">
          Private keys loaded from <code>.env</code> — no wallet extension needed
        </p>
      </header>

      {/* Wallet Info Cards */}
      <div className="wallets-container">
        <WalletDisplay
          label="Wallet A — Token Holder"
          description="Holds HONEY tokens. Signs permits/authorizations off-chain (no gas cost)."
          address={tokenHolderAccount.address}
          honeyAddress={honeyAddress}
          role="holder"
        />
        <WalletDisplay
          label="Wallet B — Gas Subsidizer"
          description="Has BERA for gas. Submits signed messages on-chain and pays for execution."
          address={gasSubsidizerAccount.address}
          honeyAddress={honeyAddress}
          role="subsidizer"
        />
      </div>

      {(!deployments.honey || honeyAddress === ZERO_ADDR || permit2Address === ZERO_ADDR) && (
        <div className="warning">
          <p>
            ⚠️ Contracts not deployed. Run deployment first and copy{' '}
            <code>deployments.json</code> to <code>frontend/public/</code>.
          </p>
        </div>
      )}

      {/* Demo Sections */}
      <div className="demos-container">
        <EIP2612Demo
          honeyAddress={honeyAddress}
          demoAddress={demoAddress}
          onTxComplete={handleTxComplete}
        />

        <Permit2Demo
          honeyAddress={honeyAddress}
          permit2Address={permit2Address}
          demoAddress={demoAddress}
          onTxComplete={handleTxComplete}
        />

        <EIP3009Demo
          honeyAddress={honeyAddress}
          demoAddress={demoAddress}
          onTxComplete={handleTxComplete}
        />
      </div>

      {/* Comparison Table */}
      <div className="comparison-section">
        <h2>Comparison</h2>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>EIP-2612</th>
              <th>Permit2</th>
              <th>EIP-3009</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>What it does</td>
              <td>Gasless approval</td>
              <td>Universal gasless approval</td>
              <td>Gasless transfer</td>
            </tr>
            <tr>
              <td>Requires token support</td>
              <td>Yes (must implement)</td>
              <td>No (works with any ERC20)</td>
              <td>Yes (must implement)</td>
            </tr>
            <tr>
              <td>Nonce type</td>
              <td>Sequential (uint256)</td>
              <td>Random or sequential</td>
              <td>Random (bytes32)</td>
            </tr>
            <tr>
              <td>Parallel operations</td>
              <td>No (sequential nonces)</td>
              <td>Yes</td>
              <td>Yes (random nonces)</td>
            </tr>
            <tr>
              <td>Steps for transfer</td>
              <td>permit + transferFrom</td>
              <td>permitTransferFrom</td>
              <td>transferWithAuthorization</td>
            </tr>
            <tr>
              <td>On-chain approval</td>
              <td>Creates allowance</td>
              <td>Optional (signature mode)</td>
              <td>Not needed</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer>
        <h3>How This Demo Works</h3>
        <ol>
          <li>
            <strong>Wallet A</strong> ({tokenHolderAccount.address.slice(0, 8)}...) holds HONEY tokens.
            Click the first button to sign an off-chain message — <em>no gas is spent</em>.
          </li>
          <li>
            <strong>Wallet B</strong> ({gasSubsidizerAccount.address.slice(0, 8)}...) acts as the relayer.
            Click the second button to submit the signed message on-chain — <em>Wallet B pays for gas</em>.
          </li>
          <li>
            Each demo section shows both steps separately so you can see the gasless flow in action.
          </li>
        </ol>
        <p className="footer-note">
          Both private keys are loaded from the project root <code>.env</code> file
          (<code>PRIVATE_KEY</code> and <code>PRIVATE_KEY_GAS_SUBSIDIZER</code>).
          No browser wallet extension is needed.
        </p>
      </footer>
    </div>
  )
}

export default App
