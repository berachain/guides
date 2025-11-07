import { useState, useEffect } from 'react'

// Common role hashes
const ROLES = {
  DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000',
  VALIDATOR_ADMIN_ROLE: '0x' + Array.from(
    new TextEncoder().encode('VALIDATOR_ADMIN_ROLE()')
  ).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function useRoleCheck(client, contractAddress, role, account) {
  const [hasRole, setHasRole] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!client || !contractAddress || !account) {
      setHasRole(false)
      setLoading(false)
      return
    }

    const checkRole = async () => {
      try {
        setLoading(true)
        const result = await client.readContract({
          address: contractAddress,
          abi: [{
            name: 'hasRole',
            type: 'function',
            stateMutability: 'view',
            inputs: [
              { name: 'role', type: 'bytes32' },
              { name: 'account', type: 'address' }
            ],
            outputs: [{ name: '', type: 'bool' }]
          }],
          functionName: 'hasRole',
          args: [role, account]
        })
        setHasRole(result)
      } catch (error) {
        console.error('Role check error:', error)
        setHasRole(false)
      } finally {
        setLoading(false)
      }
    }

    checkRole()
  }, [client, contractAddress, role, account])

  return { hasRole, loading }
}

export { ROLES }





