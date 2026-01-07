import { useState, useEffect } from 'react'
import { formatEther, parseEther, parseGwei } from 'viem'
import { STAKING_POOL_ABI, WITHDRAWAL_VAULT_ABI } from '../utils/abis'

const WITHDRAWAL_DELAY_BLOCKS = 129600n // ~3 days at 2s per block

function formatTimeRemaining(blocksRemaining) {
  if (blocksRemaining <= 0n) return 'Ready'
  const seconds = Number(blocksRemaining) * 2
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export default function UserPage({ account, client, walletClient, poolConfig }) {
  const [balance, setBalance] = useState('0')
  const [totalAssets, setTotalAssets] = useState('0')
  const [stakeValue, setStakeValue] = useState('0')
  const [depositAmount, setDepositAmount] = useState('')
  const [poolActive, setPoolActive] = useState(false)
  const [isExited, setIsExited] = useState(false)
  const [thresholdReached, setThresholdReached] = useState(false)
  const [validatorActivationBlock, setValidatorActivationBlock] = useState(null)
  const [withdrawalCooldownActive, setWithdrawalCooldownActive] = useState(false)
  const [errors, setErrors] = useState({})
  const [requests, setRequests] = useState([])
  const [selectedRequests, setSelectedRequests] = useState(new Set())
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawMode, setWithdrawMode] = useState('assets') // 'assets' or 'shares'
  const [previewRedeemAmount, setPreviewRedeemAmount] = useState(null)
  const [previewWithdrawShares, setPreviewWithdrawShares] = useState(null)
  const [maxFee, setMaxFee] = useState('1') // 1 wei default
  const [loading, setLoading] = useState(false)
  const [currentBlock, setCurrentBlock] = useState(null)
  const [txStatus, setTxStatus] = useState(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(null)

  const loadData = async () => {
    if (!client || !poolConfig) return

    try {
      const [bal, total, active, exited, thresh, blockNum] = await Promise.all([
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
        }),
        client.getBlockNumber()
      ])
      setBalance(formatEther(bal))
      setTotalAssets(formatEther(total))
      setPoolActive(Boolean(active))
      setIsExited(Boolean(exited))
      setThresholdReached(Boolean(thresh))
      setCurrentBlock(blockNum)
      try {
        const assets = await client.readContract({
          address: poolConfig.stakingPool,
          abi: STAKING_POOL_ABI,
          functionName: 'convertToAssets',
          args: [bal]
        })
        setStakeValue(formatEther(assets))
      } catch {}
      
      // Try to get validator activation block if threshold reached
      if (thresh && !validatorActivationBlock) {
        try {
          // This would need to be added to ABI or fetched from events
          // For now, we'll estimate based on current block
        } catch {}
      }
    } catch (error) {
      console.error('Load error:', error)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [client, poolConfig, account])

  // Check cooldown status by simulating a withdrawal
  useEffect(() => {
    const checkCooldown = async () => {
      if (!client || !poolConfig || !account || !thresholdReached || !balance || parseFloat(balance) === 0) {
        setWithdrawalCooldownActive(false)
        return
      }
      
      try {
        // Simulate withdrawing a small amount (1 BERA) to check if cooldown is active
        await client.simulateContract({
          address: poolConfig.withdrawalVault,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'requestWithdrawal',
          args: [poolConfig.validatorPubkey, BigInt(parseGwei('1')), BigInt(maxFee)],
          account,
          value: BigInt(maxFee)
        })
        setWithdrawalCooldownActive(false)
      } catch (simError) {
        const errorStr = String(simError)
        const errorMessage = simError?.message || simError?.cause?.message || simError?.shortMessage || ''
        const isWithdrawalNotAllowed = 
          errorMessage.includes('WithdrawalNotAllowed') || 
          errorStr.includes('WithdrawalNotAllowed') ||
          errorStr.includes('0x4134ed3a')
        
        setWithdrawalCooldownActive(isWithdrawalNotAllowed)
      }
    }
    
    checkCooldown()
    const interval = setInterval(checkCooldown, 30000) // Check every 30 seconds
    return () => clearInterval(interval)
  }, [client, poolConfig, account, thresholdReached, balance, maxFee])

  // Fetch outstanding requests with readiness calculation
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
        const blockNum = currentBlock || await client.getBlockNumber()
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
            const requestBlock = BigInt(res.requestBlock || 0)
            const readyBlock = requestBlock + WITHDRAWAL_DELAY_BLOCKS
            const blocksRemaining = readyBlock > blockNum ? readyBlock - blockNum : 0n
            const isReady = blocksRemaining === 0n
            items.push({
              requestId: id,
              assetsRequested: res.assetsRequested,
              sharesBurnt: res.sharesBurnt,
              requestBlock: requestBlock,
              readyBlock: readyBlock,
              blocksRemaining: blocksRemaining,
              isReady: isReady
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
  }, [client, poolConfig, account, currentBlock])

  // Preview based on withdraw mode and amount
  useEffect(() => {
    const updatePreview = async () => {
      if (!client || !poolConfig || !withdrawAmount || Number(withdrawAmount) <= 0) {
        setPreviewRedeemAmount(null)
        setPreviewWithdrawShares(null)
        return
      }
      
      if (withdrawMode === 'shares') {
        // Preview redeem: shares -> BERA
        try {
          const preview = await client.readContract({
            address: poolConfig.stakingPool,
            abi: STAKING_POOL_ABI,
            functionName: 'previewRedeem',
            args: [parseEther(withdrawAmount)]
          })
          setPreviewRedeemAmount(formatEther(preview))
          setPreviewWithdrawShares(null)
        } catch (error) {
          console.error('Preview redeem error:', error)
          setPreviewRedeemAmount(null)
        }
      } else {
        // Preview withdraw: BERA -> shares
        try {
          const preview = await client.readContract({
            address: poolConfig.stakingPool,
            abi: STAKING_POOL_ABI,
            functionName: 'previewWithdraw',
            args: [parseEther(withdrawAmount)]
          })
          setPreviewWithdrawShares(formatEther(preview))
          setPreviewRedeemAmount(null)
        } catch (error) {
          console.error('Preview withdraw error:', error)
          setPreviewWithdrawShares(null)
        }
      }
    }
    updatePreview()
  }, [client, poolConfig, withdrawAmount, withdrawMode])

  const checkWithdrawalCooldown = () => {
    if (!thresholdReached || !validatorActivationBlock || !currentBlock) return null
    const cooldownEnd = validatorActivationBlock + 129600n
    if (currentBlock < cooldownEnd) {
      const blocksRemaining = cooldownEnd - currentBlock
      return `Withdrawals are disabled during cooldown period. ${formatTimeRemaining(blocksRemaining)} remaining.`
    }
    return null
  }

  const handleDeposit = async () => {
    const errs = {}
    if (!walletClient) errs.wallet = 'Connect wallet'
    if (!depositAmount || Number(depositAmount) <= 0) errs.amount = 'Enter a positive amount'
    if (isExited) errs.pool = 'Pool has exited, deposits are disabled'
    setErrors(errs)
    if (Object.keys(errs).length) return

    try {
      setLoading(true)
      setTxStatus({ type: 'pending', message: 'Sending deposit transaction...' })
      const hash = await walletClient.writeContract({
        address: poolConfig.stakingPool,
        abi: STAKING_POOL_ABI,
        functionName: 'submit',
        args: [account],
        value: parseEther(depositAmount),
        account
      })
      setTxStatus({ type: 'pending', message: 'Transaction sent', hash })
      const receipt = await client.waitForTransactionReceipt({ hash })
      setTxStatus({ type: 'success', message: 'Deposit confirmed!', hash })
      setDepositAmount('')
      setTimeout(() => {
        loadData()
        setTxStatus(null)
      }, 2000)
    } catch (error) {
      console.error('Deposit error:', error)
      let errorMsg = error.message || 'Deposit failed'
      if (errorMsg.includes('StakingPoolFullExited')) {
        errorMsg = 'Pool has exited, deposits are disabled'
      } else if (errorMsg.includes('capacity') || errorMsg.includes('limit')) {
        errorMsg = 'Pool capacity reached, deposits are paused'
      }
      setTxStatus({ type: 'error', message: errorMsg })
      setErrors({ deposit: errorMsg })
    } finally {
      setLoading(false)
    }
  }

  const handleRequestRedeem = async () => {
    const errs = {}
    if (!walletClient) errs.wallet = 'Connect wallet'
    if (!withdrawAmount || Number(withdrawAmount) <= 0) errs.withdraw = 'Enter amount > 0'
    if (!previewRedeemAmount) errs.withdraw = 'Please wait for preview to load'
    
    // Check cooldown by simulating
    if (thresholdReached && !errs.withdraw && !errs.wallet && previewRedeemAmount) {
      try {
        await client.simulateContract({
          address: poolConfig.withdrawalVault,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'requestRedeem',
          args: [poolConfig.validatorPubkey, parseEther(withdrawAmount), BigInt(maxFee)],
          account,
          value: BigInt(maxFee)
        })
      } catch (simError) {
        const errorStr = String(simError)
        const errorMessage = simError?.message || simError?.cause?.message || simError?.shortMessage || ''
        const isWithdrawalNotAllowed = 
          errorMessage.includes('WithdrawalNotAllowed') || 
          errorStr.includes('WithdrawalNotAllowed') ||
          errorStr.includes('0x4134ed3a')
        
        if (isWithdrawalNotAllowed) {
          errs.cooldown = 'Withdrawals are currently disabled (cooldown period active)'
        }
      }
    }
    
    const cooldownError = checkWithdrawalCooldown()
    if (cooldownError) errs.cooldown = cooldownError
    setErrors(errs)
    if (Object.keys(errs).length) return

    try {
      setLoading(true)
      setTxStatus({ type: 'pending', message: 'Sending redeem request...' })
      const hash = await walletClient.writeContract({
        address: poolConfig.withdrawalVault,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'requestRedeem',
        args: [poolConfig.validatorPubkey, parseEther(withdrawAmount), BigInt(maxFee)],
        account,
        value: BigInt(maxFee)
      })
      setTxStatus({ type: 'pending', message: 'Redeem requested', hash })
      const receipt = await client.waitForTransactionReceipt({ hash })
      setTxStatus({ type: 'success', message: 'Redeem request confirmed!', hash })
      setWithdrawAmount('')
      setPreviewRedeemAmount(null)
      setTimeout(() => {
        loadData()
        setTxStatus(null)
      }, 2000)
    } catch (error) {
      console.error('Redeem error:', error)
      let errorMsg = error.message || 'Redeem failed'
      if (errorMsg.includes('WithdrawalNotAllowed')) {
        errorMsg = 'Withdrawals are currently disabled (cooldown period or pool inactive)'
      } else if (errorMsg.includes('RequestNotReady')) {
        errorMsg = 'Previous withdrawal request not yet ready'
      }
      setTxStatus({ type: 'error', message: errorMsg })
      setErrors({ withdraw: errorMsg })
    } finally {
      setLoading(false)
    }
  }

  const handleRequestWithdrawal = async () => {
    const errs = {}
    if (!walletClient) errs.wallet = 'Connect wallet'
    if (!withdrawAmount || Number(withdrawAmount) <= 0) errs.withdraw = 'Enter amount > 0'
    if (!previewWithdrawShares) errs.withdraw = 'Please wait for preview to load'
    if (previewWithdrawShares) {
      try {
        const sharesNeeded = parseEther(previewWithdrawShares)
        const userBalance = parseEther(balance)
        if (sharesNeeded > userBalance) {
          errs.withdraw = 'Insufficient shares. You have ' + balance + ' stBERA shares'
        }
      } catch (error) {
        console.error('Error comparing shares:', error)
        errs.withdraw = 'Error calculating shares needed'
      }
    }
    
    // Detect cooldown by simulating the withdrawal request
    if (thresholdReached && !errs.withdraw && !errs.wallet && previewWithdrawShares) {
      try {
        await client.simulateContract({
          address: poolConfig.withdrawalVault,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'requestWithdrawal',
          args: [poolConfig.validatorPubkey, BigInt(parseGwei(withdrawAmount)), BigInt(maxFee)],
          account,
          value: BigInt(maxFee)
        })
        setWithdrawalCooldownActive(false)
      } catch (simError) {
        const errorStr = String(simError)
        const errorMessage = simError?.message || simError?.cause?.message || simError?.shortMessage || ''
        const isWithdrawalNotAllowed = 
          errorMessage.includes('WithdrawalNotAllowed') || 
          errorStr.includes('WithdrawalNotAllowed') ||
          errorStr.includes('0x4134ed3a')
        
        if (isWithdrawalNotAllowed) {
          setWithdrawalCooldownActive(true)
          errs.cooldown = 'Withdrawals are currently disabled (cooldown period active)'
        } else {
          setWithdrawalCooldownActive(false)
        }
      }
    }
    
    const cooldownError = checkWithdrawalCooldown()
    if (cooldownError) errs.cooldown = cooldownError
    setErrors(errs)
    if (Object.keys(errs).length) return

    try {
      setLoading(true)
      setTxStatus({ type: 'pending', message: 'Sending withdrawal request...' })
      const hash = await walletClient.writeContract({
        address: poolConfig.withdrawalVault,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'requestWithdrawal',
        args: [poolConfig.validatorPubkey, BigInt(parseGwei(withdrawAmount)), BigInt(maxFee)],
        account,
        value: BigInt(maxFee)
      })
      setTxStatus({ type: 'pending', message: 'Withdrawal requested', hash })
      const receipt = await client.waitForTransactionReceipt({ hash })
      setTxStatus({ type: 'success', message: 'Withdrawal request confirmed!', hash })
      setWithdrawAmount('')
      setPreviewWithdrawShares(null)
      setTimeout(() => {
        loadData()
        setTxStatus(null)
      }, 2000)
    } catch (error) {
      console.error('Withdrawal request error:', error)
      let errorMsg = error.message || 'Withdrawal request failed'
      if (errorMsg.includes('WithdrawalNotAllowed')) {
        errorMsg = 'Withdrawals are currently disabled (cooldown period or pool inactive)'
      } else if (errorMsg.includes('RequestNotReady')) {
        errorMsg = 'Previous withdrawal request not yet ready'
      } else if (errorMsg.includes('NotEnoughFunds')) {
        errorMsg = 'Insufficient funds in withdrawal vault'
      }
      setTxStatus({ type: 'error', message: errorMsg })
      setErrors({ withdraw: errorMsg })
    } finally {
      setLoading(false)
    }
  }

  const handleFinalize = async (idParam, batchIds = null) => {
    const idsToFinalize = batchIds || [idParam]
    if (!walletClient || idsToFinalize.length === 0) return
    
    // Check all are ready
    const notReady = idsToFinalize.filter(id => {
      const req = requests.find(r => r.requestId === id)
      return !req || !req.isReady
    })
    if (notReady.length > 0) {
      setErrors({ finalize: 'Some withdrawals are not ready yet' })
      return
    }

    setShowConfirmDialog({
      type: batchIds ? 'batch' : 'single',
      requestIds: idsToFinalize,
      requests: idsToFinalize.map(id => requests.find(r => r.requestId === id)).filter(Boolean)
    })
  }

  const confirmFinalize = async () => {
    const { requestIds } = showConfirmDialog
    if (!walletClient) return
    
    try {
      setLoading(true)
      setShowConfirmDialog(null)
      setTxStatus({ type: 'pending', message: requestIds.length > 1 ? 'Finalizing withdrawals...' : 'Finalizing withdrawal...' })
      
      let hash
      if (requestIds.length === 1) {
        hash = await walletClient.writeContract({
          address: poolConfig.withdrawalVault,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'finalizeWithdrawalRequest',
          args: [BigInt(requestIds[0])],
          account
        })
      } else {
        hash = await walletClient.writeContract({
          address: poolConfig.withdrawalVault,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'finalizeWithdrawalRequests',
          args: [requestIds.map(id => BigInt(id))],
          account
        })
      }
      
      setTxStatus({ type: 'pending', message: 'Finalization sent', hash })
      const receipt = await client.waitForTransactionReceipt({ hash })
      setTxStatus({ type: 'success', message: `Successfully finalized ${requestIds.length} withdrawal(s)!`, hash })
      setSelectedRequests(new Set())
      setTimeout(() => {
        loadData()
        setTxStatus(null)
      }, 2000)
    } catch (error) {
      console.error('Finalize error:', error)
      let errorMsg = error.message || 'Finalize failed'
      if (errorMsg.includes('RequestNotReady')) {
        errorMsg = 'Withdrawal is not ready yet. Please wait for the delay period to complete.'
      } else if (errorMsg.includes('NotEnoughFunds')) {
        errorMsg = 'Insufficient funds in withdrawal vault to complete withdrawal'
      }
      setTxStatus({ type: 'error', message: errorMsg })
      setErrors({ finalize: errorMsg })
    } finally {
      setLoading(false)
    }
  }

  const toggleRequestSelection = (requestId) => {
    const newSelected = new Set(selectedRequests)
    if (newSelected.has(requestId)) {
      newSelected.delete(requestId)
    } else {
      const req = requests.find(r => r.requestId === requestId)
      if (req && req.isReady) {
        newSelected.add(requestId)
      }
    }
    setSelectedRequests(newSelected)
  }

  const readyRequests = requests.filter(r => r.isReady)
  const selectedReadyCount = Array.from(selectedRequests).filter(id => 
    requests.find(r => r.requestId === id && r.isReady)
  ).length

  if (!poolConfig) {
    return <div className="loading">No pool selected</div>
  }

  const explorerUrl = poolConfig.explorerUrl || 'https://berascan.com'
  const depositRoundedAmount = depositAmount ? (Math.floor(parseFloat(depositAmount) * 1e9) / 1e9).toFixed(9) : ''

  return (
    <div>
      <h2>User Dashboard</h2>

      {txStatus && (
        <div className={txStatus.type === 'error' ? 'error' : txStatus.type === 'success' ? 'success' : 'warning'}>
          {txStatus.message}
          {txStatus.hash && (
            <div style={{ marginTop: '0.5rem' }}>
              <a href={`${explorerUrl}/tx/${txStatus.hash}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                View on explorer
              </a>
            </div>
          )}
        </div>
      )}

      {isExited && (
        <div className="warning">
          This pool has triggered full exit. New deposits are disabled, but withdrawals continue to process normally.
        </div>
      )}

      {checkWithdrawalCooldown() && (
        <div className="warning">
          {checkWithdrawalCooldown()}
        </div>
      )}

      <div className="card">
        <h3>Pool Status</h3>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Pool Status</div>
            <div className="stat-value">{poolActive ? (isExited ? 'Fully Exited' : 'Active') : 'Inactive'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Pool Total Assets</div>
            <div className="stat-value">{parseFloat(totalAssets).toFixed(2)} BERA</div>
          </div>
          <div className="stat">
            <div className="stat-label">Activation Threshold</div>
            <div className="stat-value">{thresholdReached ? 'Reached' : 'Not Reached'}</div>
          </div>
          {thresholdReached && (
            <div className="stat">
              <div className="stat-label">Withdrawal Cooldown</div>
              <div className="stat-value">{withdrawalCooldownActive ? 'Active' : 'None'}</div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Your Position</h3>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Your Shares Balance</div>
            <div className="stat-value">{parseFloat(balance).toFixed(4)}</div>
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
                step="0.000000001"
              />
              {errors.amount && <div className="error">{errors.amount}</div>}
              {errors.pool && <div className="error">{errors.pool}</div>}
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
            <label>Amount</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button 
                  type="button"
                  onClick={() => setWithdrawMode('assets')}
                  style={{ 
                    padding: '0.5rem 1rem',
                    backgroundColor: withdrawMode === 'assets' ? '#ff6b35' : '#333',
                    color: 'white',
                    border: '1px solid #ff6b35',
                    cursor: 'pointer',
                    borderRadius: '4px'
                  }}
                >
                  BERA
                </button>
                <button 
                  type="button"
                  onClick={() => setWithdrawMode('shares')}
                  style={{ 
                    padding: '0.5rem 1rem',
                    backgroundColor: withdrawMode === 'shares' ? '#ff6b35' : '#333',
                    color: 'white',
                    border: '1px solid #ff6b35',
                    cursor: 'pointer',
                    borderRadius: '4px'
                  }}
                >
                  Shares
                </button>
              </div>
              <input 
                type="number" 
                value={withdrawAmount} 
                onChange={(e) => setWithdrawAmount(e.target.value)} 
                placeholder="0.0" 
                step={withdrawMode === 'assets' ? "0.000000001" : "0.0001"}
                style={{ flex: 1, minWidth: '120px' }}
              />
              {withdrawMode === 'shares' && withdrawAmount && (
                <button 
                  onClick={handleRequestRedeem} 
                  disabled={loading || !previewRedeemAmount}
                  style={{ padding: '0.5rem 1rem' }}
                >
                  {loading ? 'Requesting...' : 'Withdraw Shares'}
                </button>
              )}
              {withdrawMode === 'assets' && withdrawAmount && (
                <button 
                  onClick={handleRequestWithdrawal} 
                  disabled={loading || !previewWithdrawShares}
                  style={{ padding: '0.5rem 1rem' }}
                >
                  {loading ? 'Requesting...' : 'Withdraw BERA'}
                </button>
              )}
            </div>
            {withdrawMode === 'shares' && previewRedeemAmount && (
              <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '0.25rem' }}>
                You will receive approximately {parseFloat(previewRedeemAmount).toFixed(6)} BERA
              </div>
            )}
            {withdrawMode === 'assets' && previewWithdrawShares && (
              <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '0.25rem' }}>
                This will burn approximately {parseFloat(previewWithdrawShares).toFixed(6)} shares
              </div>
            )}
            {errors.withdraw && <div className="error">{errors.withdraw}</div>}
            {errors.cooldown && <div className="error">{errors.cooldown}</div>}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Outstanding Requests</h3>
        {requests.length === 0 ? (
          <div style={{ padding: '0.5rem', color: '#888' }}>No requests found</div>
        ) : (
          <>
            {readyRequests.length > 0 && selectedReadyCount > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <button 
                  onClick={() => handleFinalize(null, Array.from(selectedRequests))}
                  disabled={loading || selectedReadyCount === 0}
                >
                  Finalize Selected ({selectedReadyCount})
                </button>
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {readyRequests.length > 1 && <th style={{ textAlign: 'left', padding: '6px 8px' }}>Select</th>}
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>ID</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Assets (BERA)</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Shares</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.requestId}>
                    {readyRequests.length > 1 && (
                      <td style={{ padding: '6px 8px' }}>
                        {r.isReady && (
                          <input
                            type="checkbox"
                            checked={selectedRequests.has(r.requestId)}
                            onChange={() => toggleRequestSelection(r.requestId)}
                          />
                        )}
                      </td>
                    )}
                    <td style={{ padding: '6px 8px' }}>{r.requestId}</td>
                    <td style={{ padding: '6px 8px' }}>{formatEther(r.assetsRequested)} BERA</td>
                    <td style={{ padding: '6px 8px' }}>{formatEther(r.sharesBurnt)} shares</td>
                    <td style={{ padding: '6px 8px' }}>
                      {r.isReady ? (
                        <span style={{ color: '#35ff35', fontWeight: 'bold' }}>Ready</span>
                      ) : (
                        <span style={{ color: '#ffcc35' }}>
                          {formatTimeRemaining(r.blocksRemaining)} remaining
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <button 
                        onClick={() => handleFinalize(r.requestId)} 
                        disabled={loading || !r.isReady}
                        title={!r.isReady ? `Ready in ${formatTimeRemaining(r.blocksRemaining)}` : ''}
                      >
                        {r.isReady ? 'Finalize' : 'Not Ready'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {showConfirmDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="card" style={{ maxWidth: '500px', margin: '2rem' }}>
            <h3>Confirm Finalization</h3>
            <p>You are about to finalize {showConfirmDialog.requestIds.length} withdrawal(s):</p>
            <ul style={{ margin: '1rem 0', paddingLeft: '1.5rem' }}>
              {showConfirmDialog.requests.map(req => (
                <li key={req.requestId}>
                  Request #{req.requestId}: {formatEther(req.assetsRequested)} BERA
                </li>
              ))}
            </ul>
            <div className="actions">
              <button onClick={() => setShowConfirmDialog(null)}>Cancel</button>
              <button onClick={confirmFinalize} disabled={loading}>
                {loading ? 'Finalizing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
