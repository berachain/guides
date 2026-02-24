import { useState } from 'react'
import { useBalance, useReadContract } from 'wagmi'
import { parseEther, formatEther, formatUnits } from 'viem'
import type { TransactionReceipt } from 'viem'
import {
  tokenHolderClient, gasSubsidizerClient, publicClient,
  tokenHolderAccount, gasSubsidizerAccount,
} from '../config/clients'

const honeyAbi = [
  {
    name: 'nonces',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'permit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'transferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const erc20BalanceAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

interface EIP2612DemoProps {
  honeyAddress: `0x${string}`
  demoAddress: `0x${string}`
  onTxComplete?: () => void
}

function addr(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

export function EIP2612Demo({ honeyAddress, demoAddress: _demoAddress, onTxComplete }: EIP2612DemoProps) {
  const [amount, setAmount] = useState('100')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [step, setStep] = useState<'idle' | 'signing' | 'signed' | 'executing' | 'confirming' | 'done'>('idle')

  const [sigData, setSigData] = useState<{
    v: number; r: `0x${string}`; s: `0x${string}`
    fullSig: `0x${string}`; value: bigint; deadline: bigint; nonce: bigint
  } | null>(null)

  const [receipt, setReceipt] = useState<{
    permit: TransactionReceipt
    transfer: TransactionReceipt
  } | null>(null)

  const enabled = honeyAddress !== '0x0000000000000000000000000000000000000000'

  // Nonce
  const { data: currentNonce } = useReadContract({
    address: honeyAddress, abi: honeyAbi, functionName: 'nonces',
    args: [tokenHolderAccount.address],
    query: { enabled },
  })

  // Balances — Wallet A
  const { data: ethBalA } = useBalance({
    address: tokenHolderAccount.address,
    query: { refetchInterval: 4000 },
  })
  const { data: honeyBalA } = useReadContract({
    address: honeyAddress, abi: erc20BalanceAbi, functionName: 'balanceOf',
    args: [tokenHolderAccount.address],
    query: { enabled, refetchInterval: 4000 },
  })

  // Balances — Wallet B
  const { data: ethBalB } = useBalance({
    address: gasSubsidizerAccount.address,
    query: { refetchInterval: 4000 },
  })
  const { data: honeyBalB } = useReadContract({
    address: honeyAddress, abi: erc20BalanceAbi, functionName: 'balanceOf',
    args: [gasSubsidizerAccount.address],
    query: { enabled, refetchInterval: 4000 },
  })

  const fmtHoney = (v: unknown) =>
    v !== undefined ? parseFloat(formatUnits(v as bigint, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '...'
  const fmtEth = (v: { value: bigint } | undefined) =>
    v ? parseFloat(formatEther(v.value)).toFixed(4) : '...'

  // Step 1: Wallet A signs the permit off-chain — spender = Wallet B
  const handleSign = async () => {
    setError(null)
    setStep('signing')
    setStatus('Wallet A signing permit off-chain...')

    try {
      const value = parseEther(amount)
      const nonce = currentNonce ?? 0n
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

      const fullSig = await tokenHolderClient.signTypedData({
        domain: { name: 'Honey Token', version: '1', chainId: 31337, verifyingContract: honeyAddress },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: tokenHolderAccount.address,
          spender: gasSubsidizerAccount.address, // Wallet B is the spender
          value,
          nonce,
          deadline,
        },
      })

      const r = `0x${fullSig.slice(2, 66)}` as `0x${string}`
      const s = `0x${fullSig.slice(66, 130)}` as `0x${string}`
      const v = parseInt(fullSig.slice(130, 132), 16)

      setSigData({ v, r, s, fullSig, value, deadline, nonce })
      setStep('signed')
      setStatus('')
    } catch (err) {
      setError(`Signing failed: ${(err as Error).message}`)
      setStep('idle')
      setStatus('')
    }
  }

  // Step 2: Wallet B calls permit() then transferFrom() on Honey directly
  const handleExecute = async () => {
    if (!sigData) return
    setError(null)
    setStep('executing')
    setStatus('Wallet B calling permit() on Honey token...')

    try {
      // 1) Wallet B submits the permit — sets allowance on-chain
      const permitHash = await gasSubsidizerClient.writeContract({
        address: honeyAddress,
        abi: honeyAbi,
        functionName: 'permit',
        args: [
          tokenHolderAccount.address,   // owner
          gasSubsidizerAccount.address,  // spender (Wallet B)
          sigData.value,
          sigData.deadline,
          sigData.v,
          sigData.r,
          sigData.s,
        ],
      })

      setStatus('permit() confirmed, calling transferFrom()...')
      const permitReceipt = await publicClient.waitForTransactionReceipt({ hash: permitHash })

      // 2) Wallet B transfers tokens from Wallet A to itself
      const transferHash = await gasSubsidizerClient.writeContract({
        address: honeyAddress,
        abi: honeyAbi,
        functionName: 'transferFrom',
        args: [
          tokenHolderAccount.address,   // from
          gasSubsidizerAccount.address,  // to (Wallet B)
          sigData.value,
        ],
      })

      setStep('confirming')
      setStatus('Waiting for transferFrom() confirmation...')
      const transferReceipt = await publicClient.waitForTransactionReceipt({ hash: transferHash })

      setReceipt({ permit: permitReceipt, transfer: transferReceipt })
      setStep('done')
      setStatus('')
      onTxComplete?.()
    } catch (err) {
      setError(`Execution failed: ${(err as Error).message}`)
      setStep('signed')
      setStatus('')
    }
  }

  const handleReset = () => {
    setStep('idle')
    setSigData(null)
    setReceipt(null)
    setError(null)
    setStatus('')
  }

  const totalGas = receipt
    ? (receipt.permit.gasUsed * receipt.permit.effectiveGasPrice) +
      (receipt.transfer.gasUsed * receipt.transfer.effectiveGasPrice)
    : 0n

  return (
    <div className="demo-section">
      <h2>EIP-2612: Permit (Gasless Approval)</h2>
      <div className="demo-content">
        <div className="explanation">
          <p>
            <strong>How it works:</strong> The token holder signs a permit message off-chain (no gas).
            The gas subsidizer then calls <code>permit()</code> + <code>transferFrom()</code> on the
            Honey token, paying for the gas while moving the token holder's tokens to itself.
          </p>
          <p className="highlight">
            Key: Uses sequential nonces (current: {currentNonce?.toString() ?? '...'})
          </p>
        </div>

        {/* ── Balances ── */}
        <div className="section-balances">
          <div className="bal-row">
            <span className="bal-label wallet-a">Wallet A</span>
            <span className="bal-addr">{addr(tokenHolderAccount.address)}</span>
            <span className="bal-value">{fmtHoney(honeyBalA)} HONEY</span>
            <span className="bal-value">{fmtEth(ethBalA)} BERA</span>
          </div>
          <div className="bal-row">
            <span className="bal-label wallet-b">Wallet B</span>
            <span className="bal-addr">{addr(gasSubsidizerAccount.address)}</span>
            <span className="bal-value">{fmtHoney(honeyBalB)} HONEY</span>
            <span className="bal-value">{fmtEth(ethBalB)} BERA</span>
          </div>
        </div>

        {/* ── Step Indicator ── */}
        <div className="step-indicator">
          <div className={`step ${step === 'idle' || step === 'signing' ? 'active' : 'done'}`}>
            <span className="step-number">1</span>
            <span>Wallet A Signs</span>
          </div>
          <div className="step-arrow">&rarr;</div>
          <div className={`step ${step === 'signed' || step === 'executing' || step === 'confirming' ? 'active' : step === 'done' ? 'done' : ''}`}>
            <span className="step-number">2</span>
            <span>Wallet B Executes</span>
          </div>
        </div>

        {/* ── Idle: Transaction Preview + Sign ── */}
        {step === 'idle' && (
          <>
            <div className="detail-card preview">
              <h4>Transaction to Sign</h4>
              <div className="detail-grid">
                <span className="detail-key">Type</span>
                <span className="detail-val">EIP-2612 Permit</span>
                <span className="detail-key">From (owner)</span>
                <span className="detail-val mono">{tokenHolderAccount.address}</span>
                <span className="detail-key">Spender (permit)</span>
                <span className="detail-val mono">{gasSubsidizerAccount.address}</span>
                <span className="detail-key">To (recipient)</span>
                <span className="detail-val mono">{gasSubsidizerAccount.address}</span>
                <span className="detail-key">Amount</span>
                <span className="detail-val">{amount} HONEY</span>
                <span className="detail-key">Nonce</span>
                <span className="detail-val">{currentNonce?.toString() ?? '...'} (sequential)</span>
                <span className="detail-key">Deadline</span>
                <span className="detail-val">1 hour from now</span>
                <span className="detail-key">Gas cost</span>
                <span className="detail-val free">FREE (off-chain signature)</span>
              </div>
            </div>

            <div className="input-group">
              <label>Amount (HONEY):</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="0" step="1" />
            </div>

            <button onClick={handleSign}>1. Wallet A: Sign Permit (Off-chain, No Gas)</button>
          </>
        )}

        {/* ── Signing ── */}
        {step === 'signing' && (
          <div className="signature-info"><p>⏳ {status}</p></div>
        )}

        {/* ── Signed: Signature + Execute ── */}
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
                <span className="detail-key">Signed permit</span>
                <span className="detail-val">Wallet A permits Wallet B to spend {amount} HONEY</span>
                <span className="detail-key">Spender</span>
                <span className="detail-val mono">{gasSubsidizerAccount.address}</span>
                <span className="detail-key">Nonce</span>
                <span className="detail-val">{sigData.nonce.toString()}</span>
                <span className="detail-key">Deadline</span>
                <span className="detail-val">{new Date(Number(sigData.deadline) * 1000).toLocaleString()}</span>
                <span className="detail-key">Gas spent</span>
                <span className="detail-val free">0 (off-chain)</span>
              </div>
            </div>

            <div className="detail-card preview">
              <h4>What Wallet B will execute</h4>
              <div className="detail-grid">
                <span className="detail-key">Tx 1</span>
                <span className="detail-val"><code>honey.permit()</code> — sets allowance on-chain</span>
                <span className="detail-key">Tx 2</span>
                <span className="detail-val"><code>honey.transferFrom(Wallet A → Wallet B)</code></span>
              </div>
            </div>

            <button onClick={handleExecute}>2. Wallet B: Execute On-chain (Pays Gas)</button>
          </>
        )}

        {/* ── Executing / Confirming ── */}
        {(step === 'executing' || step === 'confirming') && (
          <div className="signature-info"><p>⏳ {status}</p></div>
        )}

        {/* ── Done: Receipt ── */}
        {step === 'done' && receipt && (
          <>
            <div className="detail-card receipt">
              <h4>Transaction Receipts</h4>
              <div className="detail-grid">
                <span className="detail-key">Tx 1 — permit()</span>
                <span className="detail-val">{receipt.permit.status === 'success' ? '✅' : '❌'}</span>
                <span className="detail-key">Tx Hash</span>
                <span className="detail-val mono break">{receipt.permit.transactionHash}</span>
                <span className="detail-key">Gas Used</span>
                <span className="detail-val">{receipt.permit.gasUsed.toLocaleString()} gas</span>
              </div>
              <div className="detail-grid" style={{ marginTop: '0.75rem' }}>
                <span className="detail-key">Tx 2 — transferFrom()</span>
                <span className="detail-val">{receipt.transfer.status === 'success' ? '✅' : '❌'}</span>
                <span className="detail-key">Tx Hash</span>
                <span className="detail-val mono break">{receipt.transfer.transactionHash}</span>
                <span className="detail-key">Gas Used</span>
                <span className="detail-val">{receipt.transfer.gasUsed.toLocaleString()} gas</span>
              </div>
              <div className="detail-grid" style={{ marginTop: '0.75rem', borderTop: '1px solid #bfdbfe', paddingTop: '0.5rem' }}>
                <span className="detail-key">Total Gas</span>
                <span className="detail-val">{(receipt.permit.gasUsed + receipt.transfer.gasUsed).toLocaleString()} gas</span>
                <span className="detail-key">Total Gas Cost</span>
                <span className="detail-val cost">{formatEther(totalGas)} BERA</span>
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
                <span className="detail-val cost">{formatEther(totalGas)} BERA</span>
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
