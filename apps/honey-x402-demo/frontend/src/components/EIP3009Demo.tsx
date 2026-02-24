import { useState } from 'react'
import { useBalance, useReadContract } from 'wagmi'
import { keccak256, toHex, parseEther, formatEther, formatUnits } from 'viem'
import type { TransactionReceipt } from 'viem'
import {
  tokenHolderClient, gasSubsidizerClient, publicClient,
  tokenHolderAccount, gasSubsidizerAccount,
} from '../config/clients'

const erc20BalanceAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const demoAbi = [
  {
    name: 'transferFromWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

interface EIP3009DemoProps {
  honeyAddress: `0x${string}`
  demoAddress: `0x${string}`
  onTxComplete?: () => void
}

function generateRandomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return keccak256(toHex(bytes))
}

function addr(a: string) { return `${a.slice(0, 6)}...${a.slice(-4)}` }

export function EIP3009Demo({ honeyAddress, demoAddress, onTxComplete }: EIP3009DemoProps) {
  const [amount, setAmount] = useState('100')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [step, setStep] = useState<'idle' | 'signing' | 'signed' | 'executing' | 'confirming' | 'done'>('idle')

  const [sigData, setSigData] = useState<{
    v: number; r: `0x${string}`; s: `0x${string}`
    fullSig: `0x${string}`; nonce: `0x${string}`
    value: bigint; validAfter: bigint; validBefore: bigint
  } | null>(null)

  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null)

  const enabled = honeyAddress !== '0x0000000000000000000000000000000000000000'

  // Balances
  const { data: ethBalA } = useBalance({ address: tokenHolderAccount.address, query: { refetchInterval: 4000 } })
  const { data: honeyBalA } = useReadContract({ address: honeyAddress, abi: erc20BalanceAbi, functionName: 'balanceOf', args: [tokenHolderAccount.address], query: { enabled, refetchInterval: 4000 } })
  const { data: ethBalB } = useBalance({ address: gasSubsidizerAccount.address, query: { refetchInterval: 4000 } })
  const { data: honeyBalB } = useReadContract({ address: honeyAddress, abi: erc20BalanceAbi, functionName: 'balanceOf', args: [gasSubsidizerAccount.address], query: { enabled, refetchInterval: 4000 } })

  const fmtHoney = (v: unknown) => v !== undefined ? parseFloat(formatUnits(v as bigint, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '...'
  const fmtEth = (v: { value: bigint } | undefined) => v ? parseFloat(formatEther(v.value)).toFixed(4) : '...'

  // Step 1
  const handleSign = async () => {
    setError(null); setStep('signing'); setStatus('Wallet A signing authorization off-chain...')
    try {
      const value = parseEther(amount)
      const nonce = generateRandomNonce()
      const validAfter = 0n
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)

      const fullSig = await tokenHolderClient.signTypedData({
        domain: { name: 'Honey Token', version: '1', chainId: 31337, verifyingContract: honeyAddress },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: { from: tokenHolderAccount.address, to: gasSubsidizerAccount.address, value, validAfter, validBefore, nonce },
      })

      const r = `0x${fullSig.slice(2, 66)}` as `0x${string}`
      const s = `0x${fullSig.slice(66, 130)}` as `0x${string}`
      const v = parseInt(fullSig.slice(130, 132), 16)

      setSigData({ v, r, s, fullSig, nonce, value, validAfter, validBefore })
      setStep('signed'); setStatus('')
    } catch (err) { setError(`Signing failed: ${(err as Error).message}`); setStep('idle'); setStatus('') }
  }

  // Step 2
  const handleExecute = async () => {
    if (!sigData) return
    setError(null); setStep('executing'); setStatus('Wallet B submitting on-chain...')
    try {
      const hash = await gasSubsidizerClient.writeContract({
        address: demoAddress, abi: demoAbi, functionName: 'transferFromWithAuthorization',
        args: [tokenHolderAccount.address, gasSubsidizerAccount.address, sigData.value, sigData.validAfter, sigData.validBefore, sigData.nonce, sigData.v, sigData.r, sigData.s],
      })
      setStep('confirming'); setStatus('Waiting for confirmation...')
      const txReceipt = await publicClient.waitForTransactionReceipt({ hash })
      setReceipt(txReceipt); setStep('done'); setStatus(''); onTxComplete?.()
    } catch (err) { setError(`Execution failed: ${(err as Error).message}`); setStep('signed'); setStatus('') }
  }

  const handleReset = () => {
    setStep('idle'); setSigData(null); setReceipt(null); setError(null); setStatus('')
  }

  return (
    <div className="demo-section">
      <h2>EIP-3009: Transfer With Authorization (Gasless Transfer)</h2>
      <div className="demo-content">
        <div className="explanation">
          <p>
            <strong>How it works:</strong> The token holder signs a transfer authorization off-chain (no gas).
            Anyone can then submit this authorization on-chain to execute the transfer.
            Unlike EIP-2612, this does the <em>transfer directly</em> — no separate approval step needed.
          </p>
          <p className="highlight">Key: Uses random 32-byte nonces, enabling multiple parallel authorizations.</p>
        </div>

        {/* Balances */}
        <div className="section-balances">
          <div className="bal-row"><span className="bal-label wallet-a">Wallet A</span><span className="bal-addr">{addr(tokenHolderAccount.address)}</span><span className="bal-value">{fmtHoney(honeyBalA)} HONEY</span><span className="bal-value">{fmtEth(ethBalA)} BERA</span></div>
          <div className="bal-row"><span className="bal-label wallet-b">Wallet B</span><span className="bal-addr">{addr(gasSubsidizerAccount.address)}</span><span className="bal-value">{fmtHoney(honeyBalB)} HONEY</span><span className="bal-value">{fmtEth(ethBalB)} BERA</span></div>
        </div>

        {/* Steps */}
        <div className="step-indicator">
          <div className={`step ${step === 'idle' || step === 'signing' ? 'active' : 'done'}`}><span className="step-number">1</span><span>Wallet A Signs</span></div>
          <div className="step-arrow">&rarr;</div>
          <div className={`step ${step === 'signed' || step === 'executing' || step === 'confirming' ? 'active' : step === 'done' ? 'done' : ''}`}><span className="step-number">2</span><span>Wallet B Executes</span></div>
        </div>

        {/* Idle */}
        {step === 'idle' && (
          <>
            <div className="detail-card preview">
              <h4>Transaction to Sign</h4>
              <div className="detail-grid">
                <span className="detail-key">Type</span>
                <span className="detail-val">EIP-3009 TransferWithAuthorization</span>
                <span className="detail-key">From</span>
                <span className="detail-val mono">{tokenHolderAccount.address}</span>
                <span className="detail-key">To</span>
                <span className="detail-val mono">{gasSubsidizerAccount.address}</span>
                <span className="detail-key">Amount</span>
                <span className="detail-val">{amount} HONEY</span>
                <span className="detail-key">Nonce type</span>
                <span className="detail-val">Random bytes32 (enables parallel authorizations)</span>
                <span className="detail-key">Valid after</span>
                <span className="detail-val">Immediately (0)</span>
                <span className="detail-key">Valid before</span>
                <span className="detail-val">1 hour from now</span>
                <span className="detail-key">Gas cost</span>
                <span className="detail-val free">FREE (off-chain signature)</span>
              </div>
            </div>
            <div className="input-group">
              <label>Amount (HONEY):</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="0" step="1" />
            </div>
            <button onClick={handleSign}>1. Wallet A: Sign Authorization (Off-chain, No Gas)</button>
          </>
        )}

        {step === 'signing' && <div className="signature-info"><p>⏳ {status}</p></div>}

        {/* Signed */}
        {step === 'signed' && sigData && (
          <>
            <div className="detail-card sig">
              <h4>Signature (EIP-712)</h4>
              <div className="detail-grid">
                <span className="detail-key">v</span>
                <span className="detail-val mono">{sigData.v}</span>
                <span className="detail-key">r</span>
                <span className="detail-val mono break">{sigData.r}</span>
                <span className="detail-key">s</span>
                <span className="detail-val mono break">{sigData.s}</span>
                <span className="detail-key">Raw</span>
                <span className="detail-val mono break tiny">{sigData.fullSig}</span>
              </div>
              <div className="detail-grid" style={{ marginTop: '0.75rem' }}>
                <span className="detail-key">Amount</span>
                <span className="detail-val">{amount} HONEY</span>
                <span className="detail-key">Nonce</span>
                <span className="detail-val mono break tiny">{sigData.nonce}</span>
                <span className="detail-key">Valid until</span>
                <span className="detail-val">{new Date(Number(sigData.validBefore) * 1000).toLocaleString()}</span>
                <span className="detail-key">Gas spent</span>
                <span className="detail-val free">0 (off-chain)</span>
              </div>
            </div>
            <button onClick={handleExecute}>2. Wallet B: Execute On-chain (Pays Gas)</button>
          </>
        )}

        {(step === 'executing' || step === 'confirming') && <div className="signature-info"><p>⏳ {status}</p></div>}

        {/* Done */}
        {step === 'done' && receipt && (
          <>
            <div className="detail-card receipt">
              <h4>Transaction Receipt</h4>
              <div className="detail-grid">
                <span className="detail-key">Status</span>
                <span className="detail-val">{receipt.status === 'success' ? '✅ Success' : '❌ Reverted'}</span>
                <span className="detail-key">Tx Hash</span>
                <span className="detail-val mono break">{receipt.transactionHash}</span>
                <span className="detail-key">Block</span>
                <span className="detail-val">{receipt.blockNumber.toString()}</span>
                <span className="detail-key">Gas Used</span>
                <span className="detail-val">{receipt.gasUsed.toLocaleString()} gas</span>
                <span className="detail-key">Gas Price</span>
                <span className="detail-val">{formatUnits(receipt.effectiveGasPrice, 9)} gwei</span>
                <span className="detail-key">Total Gas Cost</span>
                <span className="detail-val cost">{formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} BERA</span>
                <span className="detail-key">Paid By</span>
                <span className="detail-val mono">Wallet B ({addr(gasSubsidizerAccount.address)})</span>
              </div>
            </div>
            <div className="detail-card transfer-summary">
              <h4>Transfer Summary</h4>
              <div className="detail-grid">
                <span className="detail-key">Sent</span>
                <span className="detail-val">{amount} HONEY</span>
                <span className="detail-key">From</span>
                <span className="detail-val mono">Wallet A ({addr(tokenHolderAccount.address)})</span>
                <span className="detail-key">To</span>
                <span className="detail-val mono">Wallet B ({addr(gasSubsidizerAccount.address)})</span>
                <span className="detail-key">Wallet A gas cost</span>
                <span className="detail-val free">0 BERA (gasless!)</span>
                <span className="detail-key">Wallet B gas cost</span>
                <span className="detail-val cost">{formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} BERA</span>
              </div>
            </div>
            <button onClick={handleReset} className="reset-btn">Try Again</button>
          </>
        )}

        {error && <p className="error">❌ {error}</p>}
      </div>
    </div>
  )
}
