import { ref } from 'vue'
import { formatEther } from 'viem'
import { STAKING_POOL_FACTORY_ABI, STAKING_POOL_ABI } from '../utils/abis.js'

// Factory addresses per network
const FACTORY_ADDRESSES = {
  80094: '0xb79b43dBA821Cb67751276Ce050fF4111445fB99', // mainnet
  80069: '0x176c081E95C82CA68DEa20CA419C7506Aa063C24'  // bepolia
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const GRAPHQL_ENDPOINT = 'https://api.berachain.com/graphql'
const CHAIN_ENUM_BY_ID = {
  80094: 'BERACHAIN',
  80069: 'BEPOLIA'
}

export function usePoolDiscovery(publicClient, chainId, configPools = null, configMode = null) {
  const validators = ref([])
  const pools = ref([])
  const isLoading = ref(false)
  const error = ref(null)

  // Mode detection:
  // - Explicit mode: "single" or "discovery" in config.mode
  // - Auto-detect: If pools exist and enabled → single, else → discovery
  async function discoverPools() {
    isLoading.value = true
    error.value = null

    // Handle both direct objects and computed refs
    const poolsObj = configPools?.value || configPools
    const mode = configMode?.value || configMode

    // Determine mode: explicit mode takes precedence, then auto-detect
    let useSingleMode = false

    if (mode === 'single' || mode === 'discovery') {
      useSingleMode = (mode === 'single')
    } else {
      if (poolsObj && typeof poolsObj === 'object' && Object.keys(poolsObj).length > 0) {
        const configPoolList = Object.entries(poolsObj)
          .filter(([_, p]) => p.enabled)
          .map(([key, p]) => ({ key, ...p }))

        useSingleMode = (configPoolList.length > 0)
      }
    }

    if (useSingleMode) {
      if (!poolsObj || typeof poolsObj !== 'object' || Object.keys(poolsObj).length === 0) {
        error.value = 'Single pool mode requires pools in config.json. Add a pool to the "pools" section, or set mode to "discovery" to use multi-pool mode.'
        isLoading.value = false
        return
      }

      const configPoolList = Object.entries(poolsObj)
        .filter(([_, p]) => p.enabled)
        .map(([key, p]) => ({ key, ...p }))

      if (configPoolList.length === 0) {
        error.value = 'No enabled pools found in config.json. Set "enabled": true for at least one pool, or set mode to "discovery" to use multi-pool mode.'
        isLoading.value = false
        return
      }

      await loadPoolsFromConfig(configPoolList)
    } else {
      await loadPoolsFromDiscovery()
    }
  }

  // Path 1: Load single pool from config
  async function loadPoolsFromConfig(configPoolList) {
    try {
      const client = publicClient?.value || publicClient

      const discoveredPools = await Promise.all(
        configPoolList.map(async (poolConfig) => {
          try {
            let totalAssets = '0'
            let exchangeRate = '1.0'
            let isActive = false
            let isFullyExited = false

            if (poolConfig.stakingPool && client) {
              try {
                const assets = await client.readContract({
                  address: poolConfig.stakingPool,
                  abi: STAKING_POOL_ABI,
                  functionName: 'totalAssets'
                })

                const totalSupply = await client.readContract({
                  address: poolConfig.stakingPool,
                  abi: STAKING_POOL_ABI,
                  functionName: 'totalSupply'
                })

                const contractIsActive = await client.readContract({
                  address: poolConfig.stakingPool,
                  abi: STAKING_POOL_ABI,
                  functionName: 'isActive'
                })

                isFullyExited = await client.readContract({
                  address: poolConfig.stakingPool,
                  abi: STAKING_POOL_ABI,
                  functionName: 'isFullyExited'
                })

                isActive = contractIsActive && !isFullyExited

                if (totalSupply > 0n) {
                  exchangeRate = (Number(assets) / Number(totalSupply)).toFixed(4)
                }

                totalAssets = formatEther(assets)
              } catch (err) {
                console.warn(`Failed to fetch metadata for config pool ${poolConfig.stakingPool}:`, err)
              }
            }

            return {
              validator: {
                index: null,
                pubkey: poolConfig.validatorPubkey || '0x',
                balance: null,
                status: null
              },
              stakingPool: poolConfig.stakingPool,
              smartOperator: poolConfig.smartOperator,
              stakingRewardsVault: poolConfig.stakingRewardsVault,
              incentiveCollector: poolConfig.incentiveCollector,
              totalAssets,
              exchangeRate,
              isActive,
              isFullyExited,
              name: poolConfig.name || 'Staking Pool',
              fromConfig: true
            }
          } catch (err) {
            console.warn('Failed to process config pool:', err)
            return null
          }
        })
      )

      pools.value = discoveredPools.filter(p => p !== null)
    } catch (err) {
      error.value = err.message || 'Failed to load pools from config'
      console.error('Config pool loading error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Path 2: Discovery mode (API-first, then JSON snapshot fallback on bepolia)
  async function loadPoolsFromDiscovery() {
    try {
      const chain = chainId?.value || chainId
      const client = publicClient?.value || publicClient

      if (!chain || !client) {
        error.value = 'Public client and chain ID required'
        return
      }

      const apiPools = await loadPoolsFromApi(chain, client)
      if (apiPools.length > 0) {
        pools.value = apiPools
        return
      }

      error.value = `No pools discovered from API for chain ${chain}`
    } catch (err) {
      error.value = err.message || 'Failed to discover pools'
      console.error('Pool discovery error:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function graphqlRequest(query, variables) {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    })

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`)
    }

    const json = await response.json()
    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message || 'GraphQL error')
    }
    return json.data
  }

  function chunk(array, size) {
    const out = []
    for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size))
    return out
  }

  async function fetchAllValidators(chainEnum) {
    const query = `
      query Validators($chain: GqlChain!, $first: Int!, $skip: Int!) {
        polGetValidators(chain: $chain, first: $first, skip: $skip) {
          pagination { currentPage pageSize totalCount totalPages }
          validators {
            id
            pubkey
            operator
            metadata { name logoURI website twitter }
          }
        }
      }
    `

    const first = 200
    let skip = 0
    const all = []
    let guard = 0

    while (guard++ < 100) {
      const data = await graphqlRequest(query, { chain: chainEnum, first, skip })
      const page = data?.polGetValidators
      const pageVals = page?.validators || []

      all.push(...pageVals)

      if (pageVals.length < first) break
      skip += first

      const totalCount = page?.pagination?.totalCount
      if (typeof totalCount === 'number' && all.length >= totalCount) break
    }

    return all
  }

  async function loadPoolsFromApi(chain, client) {
    const chainEnum = CHAIN_ENUM_BY_ID[chain]
    if (!chainEnum) {
      throw new Error(`Unsupported chainId for API discovery: ${chain}`)
    }

    const factoryAddress = FACTORY_ADDRESSES[chain]
    if (!factoryAddress) {
      throw new Error(`Factory address not found for chain ID ${chain}`)
    }

    const vals = await fetchAllValidators(chainEnum)
    validators.value = vals

    if (!vals.length) return []

    // Resolve core contracts for each validator via factory.
    const coreCalls = vals.map((v) => {
      const pubkey = v.pubkey?.startsWith('0x') ? v.pubkey : `0x${v.pubkey || ''}`
      return {
        address: factoryAddress,
        abi: STAKING_POOL_FACTORY_ABI,
        functionName: 'getCoreContracts',
        args: [pubkey]
      }
    })

    const coreResults = []
    for (const batch of chunk(coreCalls, 200)) {
      const res = await client.multicall({ contracts: batch, allowFailure: true })
      coreResults.push(...res)
    }

    const discovered = []
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]
      const r = coreResults[i]
      const result = r?.result
      if (!result) continue

      const stakingPool = (result[1] || '').toLowerCase()
      if (!stakingPool || stakingPool === ZERO_ADDRESS) continue

      discovered.push({
        validator: {
          index: null,
          pubkey: v.pubkey,
          balance: null,
          status: null,
          operator: v.operator,
          metadata: v.metadata || null
        },
        stakingPool,
        smartOperator: result[0],
        stakingRewardsVault: result[2],
        incentiveCollector: result[3],
        totalAssets: '0',
        exchangeRate: '1.0',
        isActive: false,
        isFullyExited: false,
        name: v.metadata?.name || null
      })
    }

    if (!discovered.length) return []

    // Fetch pool state (multicall) for discovered pools.
    const stateCalls = []
    for (const p of discovered) {
      stateCalls.push({ address: p.stakingPool, abi: STAKING_POOL_ABI, functionName: 'totalAssets' })
      stateCalls.push({ address: p.stakingPool, abi: STAKING_POOL_ABI, functionName: 'totalSupply' })
      stateCalls.push({ address: p.stakingPool, abi: STAKING_POOL_ABI, functionName: 'isActive' })
      stateCalls.push({ address: p.stakingPool, abi: STAKING_POOL_ABI, functionName: 'isFullyExited' })
    }

    const stateResults = []
    for (const batch of chunk(stateCalls, 400)) {
      const res = await client.multicall({ contracts: batch, allowFailure: true })
      stateResults.push(...res)
    }

    for (let i = 0; i < discovered.length; i++) {
      const base = i * 4
      const totalAssets = stateResults[base]?.result ?? 0n
      const totalSupply = stateResults[base + 1]?.result ?? 0n
      const contractIsActive = Boolean(stateResults[base + 2]?.result ?? false)
      const isFullyExited = Boolean(stateResults[base + 3]?.result ?? false)

      discovered[i].isFullyExited = isFullyExited
      discovered[i].isActive = contractIsActive && !isFullyExited

      if (typeof totalAssets === "bigint" && typeof totalSupply === "bigint") {
        if (totalSupply > 0n) {
          discovered[i].exchangeRate = (Number(totalAssets) / Number(totalSupply)).toFixed(4)
        }
        discovered[i].totalAssets = formatEther(totalAssets)
      }
    }

    return discovered
  }

  return {
    validators,
    pools,
    isLoading,
    error,
    discoverPools
  }
}
