import { useState } from 'react'
import { useRoleCheck, ROLES } from '../hooks/useRoleCheck'
import config from '../../config.json'

export default function DelegatorPage({ account, client, walletClient }) {
  if (!config.contracts.delegationHandlerFactory || config.contracts.delegationHandlerFactory === '') {
    return (
      <div className="warning">
        <h3>⚠️ Delegation Not Configured</h3>
        <p>The DelegationHandlerFactory address is not configured in config.json</p>
        <p>Delegation features are not available for this deployment.</p>
      </div>
    )
  }

  return (
    <div>
      <h2>Delegator Dashboard</h2>
      
      <div className="card">
        <h3>Delegation Management</h3>
        <p style={{ color: '#888' }}>
          Deploy delegation handlers, delegate funds, and manage delegated positions.
        </p>
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#1a1a2e', borderRadius: '6px' }}>
          <p>Delegation features coming soon...</p>
        </div>
      </div>
    </div>
  )
}
