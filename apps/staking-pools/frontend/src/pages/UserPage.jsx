import { useState, useEffect } from 'react'
import { formatEther, parseEther, parseGwei } from 'viem'
import { STAKING_POOL_ABI, WITHDRAWAL_VAULT_ABI } from '../utils/abis'

export default function UserPage({ account, client, walletClient, poolConfig }) {
  const [balance, setBalance] = useState('0')
  const [totalAssets, setTotalAssets] = useState('0')
  const [stakeValue, setStakeValue] = useState('0')
  const [depositAmount, setDepositAmount] = useState('')
  const [poolActive, setPoolActive] = useState(false)
  const [isExited, setIsExited] = useState(false)
  const [thresholdReached, setThresholdReached] = useState(false)
  const [errors, setErrors] = useState({})
  const [requests, setRequests] = useState([])
  const [redeemShares, setRedeemShares] = useState('')
  const [withdrawAssets, setWithdrawAssets] = useState('')
  const [maxFee, setMaxFee] = useState('0')
  const [loading, setLoading] = useState(false)

  const loadData = async () => {
    if (!client || !poolConfig) return

    try {
      const [bal, total, active, exited, thresh] = await Promise.all([
        client.readContract({
          address: poolConfig.stakingPool,
          abi: STAKING_POOL_ABI,
          functionName: 'balanceOf',
          args: [account]
        }),
        client.readContract({
          address: poolConfig.stakingPool,
          abi: STAKING_POOL_ABI,
          functionName: 'totalAssets'
        }),
        client.readContract({
          address: poolConfig.stakingPool,
          abi: STAKING_POOL_ABI,
          functionName: 'isActive'
        }),
        client.readContract({
          address: poolConfig.stakingPool,
          abi: STAKING_POOL_ABI,
          functionName: 'isFullyExited'
        }),
        client.readContract({
          address: poolConfig.stakingPool,
          abi: STAKING_POOL_ABI,
          functionName: 'activeThresholdReached'
        })
      ])
      setBalance(formatEther(bal))
      setTotalAssets(formatEther(total))
      setPoolActive(Boolean(active))
      setIsExited(Boolean(exited))
      setThresholdReached(Boolean(thresh))
      try {
        const assets = await client.readContract({
          address: poolConfig.stakingPool,
          abi: STAKING_POOL_ABI,
          functionName: 'convertToAssets',
          args: [bal]
        })
        setStakeValue(formatEther(assets))
      } catch {}
    } catch (error) {
      console.error('Load error:', error)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [client, poolConfig, account])

  // Fetch outstanding requests (enumerate NFTs owned by the user)
  useEffect(() => {
    const fetchRequests = async () => {
      if (!client || !poolConfig || !account) return
      try {
        const bal = await client.readContract({
          address: poolConfig.withdrawalVault,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'balanceOf',
          args: [account]
        })
        const n = Number(bal)
        const ids = []
        for (let i = 0; i < n; i++) {
          try {
            const tokenId = await client.readContract({
              address: poolConfig.withdrawalVault,
              abi: WITHDRAWAL_VAULT_ABI,
              functionName: 'tokenOfOwnerByIndex',
              args: [account, BigInt(i)]
            })
            ids.push(Number(tokenId))
          } catch {}
        }
        const items = []
        for (const id of ids) {
          try {
            const wr = await client.readContract({
              address: poolConfig.withdrawalVault,
              abi: WITHDRAWAL_VAULT_ABI,
              functionName: 'getWithdrawalRequest',
              args: [BigInt(id)]
            })
            const res = wr[0] ?? wr
            // Filter to only include requests for the currently selected pool
            const reqPubkey = (typeof res.pubkey === 'string') ? res.pubkey.toLowerCase() : ''
            const poolPubkey = (poolConfig.validatorPubkey || '').toLowerCase()
            if (reqPubkey && poolPubkey && reqPubkey !== poolPubkey) {
              continue
            }
            items.push({
              requestId: id,
              assetsRequested: res.assetsRequested,
              sharesBurnt: res.sharesBurnt
            })
          } catch {}
        }
        setRequests(items.sort((a, b) => b.requestId - a.requestId))
      } catch (e) {
        console.error('enumeration error', e)
        setRequests([])
      }
    }
    fetchRequests()
  }, [client, poolConfig, account])

  const handleDeposit = async () => {
    const errs = {}
    if (!walletClient) errs.wallet = 'Connect wallet'
    if (!depositAmount || Number(depositAmount) <= 0) errs.amount = 'Enter a positive amount'
    setErrors(errs)
    if (Object.keys(errs).length) return

    try {
      setLoading(true)
      const hash = await walletClient.writeContract({
        address: poolConfig.stakingPool,
        abi: STAKING_POOL_ABI,
        functionName: 'submit',
        args: [account],
        value: parseEther(depositAmount),
        account
      })
      alert(`Transaction sent: ${hash}`)
      setDepositAmount('')
      setTimeout(loadData, 3000)
    } catch (error) {
      console.error('Deposit error:', error)
      alert('Deposit failed: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRequestRedeem = async () => {
    const errs = {}
    if (!walletClient) errs.wallet = 'Connect wallet'
    if (!redeemShares || Number(redeemShares) <= 0) errs.redeemShares = 'Enter shares > 0'
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      setLoading(true)
      const hash = await walletClient.writeContract({
        address: poolConfig.withdrawalVault,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'requestRedeem',
        args: [poolConfig.validatorPubkey, parseEther(redeemShares), maxFee ? BigInt(maxFee) : 0n],
        account,
        value: maxFee ? BigInt(maxFee) : 0n
      })
      alert(`Redeem requested: ${hash}`)
      setRedeemShares('')
    } catch (error) {
      console.error('Redeem error:', error)
      alert('Redeem failed: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRequestWithdrawal = async () => {
    const errs = {}
    if (!walletClient) errs.wallet = 'Connect wallet'
    if (!withdrawAssets || Number(withdrawAssets) <= 0) errs.withdrawAssets = 'Enter assets > 0'
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      setLoading(true)
      const hash = await walletClient.writeContract({
        address: poolConfig.withdrawalVault,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'requestWithdrawal',
        args: [poolConfig.validatorPubkey, BigInt(parseGwei(withdrawAssets)), maxFee ? BigInt(maxFee) : 0n],
        account,
        value: maxFee ? BigInt(maxFee) : 0n
      })
      alert(`Withdrawal requested: ${hash}`)
      setWithdrawAssets('')
    } catch (error) {
      console.error('Withdrawal request error:', error)
      alert('Withdrawal request failed: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFinalize = async (idParam) => {
    const id = idParam ?? prompt('Enter withdrawal requestId to finalize')
    if (!walletClient || !id) return
    try {
      setLoading(true)
      const hash = await walletClient.writeContract({
        address: poolConfig.withdrawalVault,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'finalizeWithdrawalRequest',
        args: [BigInt(id)],
        account
      })
      alert(`Finalize sent: ${hash}`)
    } catch (error) {
      console.error('Finalize error:', error)
      alert('Finalize failed: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  if (!poolConfig) {
    return <div className="loading">No pool selected</div>
  }

  return (
    <div>
      <h2>User Dashboard</h2>

      <div className="card">
        <h3>Your Position</h3>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Your stBERA Balance</div>
            <div className="stat-value">{parseFloat(balance).toFixed(4)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Pool Total Assets</div>
            <div className="stat-value">{parseFloat(totalAssets).toFixed(2)} BERA</div>
          </div>
          <div className="stat">
            <div className="stat-label">Pool Status</div>
            <div className="stat-value">{isExited ? 'exited' : (poolActive ? 'active' : 'pending')}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Your Position Value</div>
            <div className="stat-value">{parseFloat(stakeValue).toFixed(4)} BERA</div>
          </div>
        </div>
      </div>

      {poolActive && !isExited && (
        <div className="card">
          <h3>Deposit BERA</h3>
          <div className="form">
            <div className="form-group">
              <label>Amount (BERA)</label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0.0"
                step="0.01"
              />
              {errors.amount && <div className="error">{errors.amount}</div>}
            </div>
            <button onClick={handleDeposit} disabled={loading || !depositAmount}>
              {loading ? 'Depositing...' : 'Deposit'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Withdrawals</h3>
        <div className="form">
          <div className="form-group">
            <label>Max Fee to Pay (wei) [optional]</label>
            <input type="text" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} placeholder="0" />
          </div>
          <div className="form-group">
            <label>Redeem by Shares (stBERA)</label>
            <input type="number" value={redeemShares} onChange={(e) => setRedeemShares(e.target.value)} placeholder="0.0" step="0.0001" />
            {errors.redeemShares && <div className="error">{errors.redeemShares}</div>}
            <button onClick={handleRequestRedeem} disabled={loading || !redeemShares}>Request Redeem</button>
          </div>
          <div className="form-group">
            <label>Withdraw by Assets (BERA, will be rounded down to gwei)</label>
            <input type="number" value={withdrawAssets} onChange={(e) => setWithdrawAssets(e.target.value)} placeholder="0.0" step="0.000000001" />
            {errors.withdrawAssets && <div className="error">{errors.withdrawAssets}</div>}
            <button onClick={handleRequestWithdrawal} disabled={loading || !withdrawAssets}>Request Withdrawal</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Outstanding Requests</h3>
        {requests.length === 0 ? (
          <div style={{ padding: '0.5rem', color: '#888' }}>No requests found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Assets (BERA)</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Shares (stBERA)</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.requestId}>
                  <td style={{ padding: '6px 8px' }}>{r.requestId}</td>
                  <td style={{ padding: '6px 8px' }}>{formatEther(r.assetsRequested)} BERA</td>
                  <td style={{ padding: '6px 8px' }}>{formatEther(r.sharesBurnt)} stBERA</td>
                  <td style={{ padding: '6px 8px' }}><button onClick={() => handleFinalize(r.requestId)}>Finalize</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
