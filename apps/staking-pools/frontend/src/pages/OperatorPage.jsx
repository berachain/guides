import { useState, useEffect } from 'react'
import { formatEther, parseEther, keccak256, toHex } from 'viem'
import { useRoleCheck, ROLES } from '../hooks/useRoleCheck'

const SMART_OPERATOR_ABI = [
  { name: 'queueValCommission', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'commission', type: 'uint96' }], outputs: [] },
  { name: 'setProtocolFeePercentage', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'protocolFeePercentage_', type: 'uint96' }], outputs: [] },
  { name: 'queueBoost', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'activateBoost', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'queueDropBoost', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint128' }], outputs: [] },
  { name: 'redeemBGT', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'protocolFeePercentage', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint96' }] },
  { name: 'unboostedBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }
]

// Calculate VALIDATOR_ADMIN_ROLE hash
const VALIDATOR_ADMIN_ROLE = keccak256(toHex('VALIDATOR_ADMIN_ROLE()'))

export default function OperatorPage({ account, client, walletClient, poolConfig }) {
  const [protocolFee, setProtocolFee] = useState('0')
  const [unboostedBgt, setUnboostedBgt] = useState('0')
  const [newCommission, setNewCommission] = useState('')
  const [newProtocolFee, setNewProtocolFee] = useState('')
  const [loading, setLoading] = useState(false)

  const { hasRole: isValidatorAdmin, loading: roleLoading } = useRoleCheck(
    client,
    poolConfig?.smartOperator,
    VALIDATOR_ADMIN_ROLE,
    account
  )

  const loadData = async () => {
    if (!client || !poolConfig) return

    try {
      const [fee, unboosted] = await Promise.all([
        client.readContract({
          address: poolConfig.smartOperator,
          abi: SMART_OPERATOR_ABI,
          functionName: 'protocolFeePercentage'
        }),
        client.readContract({
          address: poolConfig.smartOperator,
          abi: SMART_OPERATOR_ABI,
          functionName: 'unboostedBalance'
        })
      ])
      setProtocolFee((Number(fee) / 100).toString())
      setUnboostedBgt(formatEther(unboosted))
    } catch (error) {
      console.error('Load error:', error)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [client, poolConfig])

  const handleSetCommission = async () => {
    if (!walletClient || !newCommission) return

    try {
      setLoading(true)
      const basisPoints = Math.floor(parseFloat(newCommission) * 100)
      const hash = await walletClient.writeContract({
        address: poolConfig.smartOperator,
        abi: SMART_OPERATOR_ABI,
        functionName: 'queueValCommission',
        args: [basisPoints],
        account
      })
      alert(`Transaction sent: ${hash}`)
      setNewCommission('')
    } catch (error) {
      console.error('Commission error:', error)
      alert('Failed: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleQueueBoost = async () => {
    if (!walletClient) return

    try {
      setLoading(true)
      const hash = await walletClient.writeContract({
        address: poolConfig.smartOperator,
        abi: SMART_OPERATOR_ABI,
        functionName: 'queueBoost',
        account
      })
      alert(`Boost queued: ${hash}`)
      setTimeout(loadData, 3000)
    } catch (error) {
      console.error('Queue boost error:', error)
      alert('Failed: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  if (!poolConfig) {
    return <div className="loading">No pool selected</div>
  }

  if (roleLoading) {
    return <div className="loading">Checking permissions...</div>
  }

  if (!isValidatorAdmin) {
    return (
      <div className="error">
        <h3>⚠️ Access Denied</h3>
        <p>You do not have VALIDATOR_ADMIN_ROLE for this pool.</p>
        <p>Connected account: <span className="address">{account}</span></p>
      </div>
    )
  }

  return (
    <div>
      <div className="success">
        ✅ You have VALIDATOR_ADMIN_ROLE
      </div>

      <h2>Operator Dashboard</h2>

      <div className="card">
        <h3>Current Status</h3>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Protocol Fee</div>
            <div className="stat-value">{protocolFee}%</div>
          </div>
          <div className="stat">
            <div className="stat-label">Unboosted BGT</div>
            <div className="stat-value">{parseFloat(unboostedBgt).toFixed(4)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Set Commission Rate</h3>
        <p style={{ color: '#888', marginBottom: '1rem' }}>
          Commission on incentive tokens (0-20%)
        </p>
        <div className="form">
          <div className="form-group">
            <label>Commission (%)</label>
            <input
              type="number"
              value={newCommission}
              onChange={(e) => setNewCommission(e.target.value)}
              placeholder="0-20"
              min="0"
              max="20"
              step="0.01"
            />
          </div>
          <button onClick={handleSetCommission} disabled={loading || !newCommission}>
            {loading ? 'Submitting...' : 'Queue Commission Change'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>BGT Management</h3>
        <div className="actions">
          <button onClick={handleQueueBoost} disabled={loading}>
            Queue Boost
          </button>
          <button disabled>Activate Boost</button>
          <button disabled>Queue Drop Boost</button>
          <button disabled>Redeem BGT</button>
        </div>
        <p style={{ color: '#888', marginTop: '1rem', fontSize: '0.9rem' }}>
          Additional functions available - implement as needed
        </p>
      </div>
    </div>
  )
}
