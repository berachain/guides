/**
 * Nosy Mode: IndexedDB-backed event scanning for a single pool.
 * Scans backwards until the pool's Initialized event; tip watcher polls for new blocks.
 * See project/briefs/staking-pool-nosy-mode.md.
 */

import { ref, toValue, watch, onUnmounted } from 'vue'
import { openNosyDb, poolKey, putPool, putEventsAndRanges, getEvents, getScannedRanges, consolidateRanges } from '../utils/nosyDb.js'
import { normalizeLog, fetchLogsChunked } from '../utils/nosyScanCore.js'
import { SCAN_BATCH_SIZE, SCAN_DELAY_MS, TIP_POLL_INTERVAL_MS, STAKING_POOL_GENESIS_BLOCK } from '../constants/nosy-mode.js'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {import('vue').Ref<import('viem').PublicClient>} publicClient
 * @param {import('vue').Ref<number>} chainId
 * @param {import('vue').Ref<string>} poolAddress
 * @param {import('vue').Ref<string>} smartOperatorAddress
 * @param {import('vue').Ref<string>} withdrawalVaultAddress
 * @param {import('vue').Ref<string>} factoryAddress
 */
export function usePoolEventScan(publicClient, chainId, poolAddress, smartOperatorAddress, withdrawalVaultAddress, factoryAddress) {
  const scanStatus = ref('idle') // 'idle' | 'scanning' | 'complete' | 'error'
  const scanError = ref(null)
  const scannedRanges = ref([])
  const events = ref([])
  const lastScannedBlock = ref(null)
  const scanStartBlock = ref(null) // top of range when scanning (for progress)
  const tipWatcherActive = ref(false)
  const tipBlocksScanned = ref(0) // blocks scanned by tip watcher since page load

  let db = null
  let tipIntervalId = null
  let scanAborted = false

  async function ensureDb() {
    if (db) return db
    db = await openNosyDb()
    return db
  }

  /** Run one backwards batch; returns true if pool's Initialized event was found (stop signal). */
  async function scanBackwardsBatch(client, chainIdVal, poolAddr, operatorAddr, vaultAddr, factoryAddr, fromBlock, toBlock) {
    const addresses = [poolAddr, operatorAddr, vaultAddr, factoryAddr].filter(Boolean).map((a) => a.toLowerCase())
    if (addresses.length === 0) return false
    const logs = await fetchLogsChunked(client, fromBlock, toBlock, addresses)
    let foundInitialized = false
    const toStore = []
    for (const log of logs) {
      // Initialized event from the pool itself marks the beginning of time for this pool
      if (log.eventName === 'Initialized' && log.address?.toLowerCase() === poolAddr.toLowerCase()) {
        foundInitialized = true
      }
      // Skip Initialized events from other contracts (operator, vault, factory) - only store pool's
      if (log.eventName === 'Initialized' && log.address?.toLowerCase() !== poolAddr.toLowerCase()) {
        continue
      }
      toStore.push(normalizeLog(log, chainIdVal, poolAddr))
    }
    const database = await ensureDb()
    const key = poolKey(chainIdVal, poolAddr)
    const existing = await getScannedRanges(database, key)
    const existingRanges = existing?.ranges || []
    const merged = consolidateRanges(existingRanges, { fromBlock, toBlock })
    await putEventsAndRanges(database, toStore, key, chainIdVal, poolAddr, merged)
    return foundInitialized
  }

  /** Backwards historical scan: 10k blocks at a time, 1s delay, stop at pool's Initialized. */
  async function startScan() {
    const client = toValue(publicClient)
    const chainIdVal = toValue(chainId)
    const poolAddr = toValue(poolAddress)
    const operatorAddr = toValue(smartOperatorAddress)
    const vaultAddr = toValue(withdrawalVaultAddress)
    const factoryAddr = toValue(factoryAddress)
    if (!client || chainIdVal == null || !poolAddr) {
      scanError.value = 'Missing public client, chain ID, or pool address'
      scanStatus.value = 'error'
      return
    }
    if (!operatorAddr || !vaultAddr || !factoryAddr) {
      scanError.value = 'Smart operator, withdrawal vault, and factory addresses required for scan'
      scanStatus.value = 'error'
      return
    }

    scanAborted = false
    scanError.value = null
    scanStatus.value = 'scanning'

    try {
      await ensureDb()
      const key = poolKey(chainIdVal, poolAddr)
      await putPool(db, key, {
        chainId: chainIdVal,
        poolAddress: poolAddr.toLowerCase(),
        smartOperatorAddress: operatorAddr.toLowerCase(),
        withdrawalVaultAddress: vaultAddr.toLowerCase()
      })

      // Check if pool's Initialized event is already cached (scan was previously completed)
      const cachedEvents = await getEvents(db, chainIdVal, poolAddr)
      const hasInitialized = cachedEvents.some((e) => e.eventName === 'Initialized' && e.sourceAddress?.toLowerCase() === poolAddr.toLowerCase())
      if (hasInitialized) {
        scanStatus.value = 'complete'
        scanStartBlock.value = null
        events.value = cachedEvents.sort((a, b) => a.blockNumber - b.blockNumber)
        const rangesRecord = await getScannedRanges(db, key)
        scannedRanges.value = rangesRecord?.ranges || []
        return
      }

      const currentBlock = Number(await client.getBlockNumber())
      let toBlock = currentBlock
      const existing = await getScannedRanges(db, key)
      const existingRanges = existing?.ranges || []
      if (existingRanges.length > 0) {
        // First, fill the gap between current block and max cached block
        const maxTo = Math.max(...existingRanges.map((r) => r.toBlock))
        if (currentBlock > maxTo) {
          console.log(`[Nosy] Filling gap: scanning blocks ${maxTo + 1} to ${currentBlock}`)
          await scanBackwardsBatch(client, chainIdVal, poolAddr, operatorAddr, vaultAddr, factoryAddr, maxTo + 1, currentBlock)
          console.log(`[Nosy] Gap filled, reloading events from DB`)
          await loadEventsFromDb()
        }
        // Then resume backwards scan from oldest cached block
        const minFrom = Math.min(...existingRanges.map((r) => r.fromBlock))
        toBlock = minFrom - 1
        if (toBlock < STAKING_POOL_GENESIS_BLOCK) {
          scanStatus.value = 'complete'
          lastScannedBlock.value = STAKING_POOL_GENESIS_BLOCK
          scanStartBlock.value = null
          await loadEventsFromDb()
          return
        }
      }

      scanStartBlock.value = toBlock
      lastScannedBlock.value = toBlock

      while (!scanAborted && toBlock >= STAKING_POOL_GENESIS_BLOCK) {
        const fromBlock = Math.max(STAKING_POOL_GENESIS_BLOCK, toBlock - SCAN_BATCH_SIZE + 1)
        const found = await scanBackwardsBatch(client, chainIdVal, poolAddr, operatorAddr, vaultAddr, factoryAddr, fromBlock, toBlock)
        lastScannedBlock.value = fromBlock
        if (found) {
          scanStatus.value = 'complete'
          scanStartBlock.value = null
          await loadEventsFromDb()
          return
        }
        toBlock = fromBlock - 1
        await delay(SCAN_DELAY_MS)
      }

      if (toBlock < STAKING_POOL_GENESIS_BLOCK) scanStatus.value = 'complete'
      scanStartBlock.value = null
      await loadEventsFromDb()
    } catch (err) {
      scanError.value = err?.message || 'Scan failed'
      scanStatus.value = 'error'
      scanStartBlock.value = null
      console.error('[usePoolEventScan]', err)
    }
  }

  /** Load events and scanned ranges from DB into refs. Sets scanStatus to 'complete' if pool's Initialized event found. */
  async function loadEventsFromDb() {
    const chainIdVal = toValue(chainId)
    const poolAddr = toValue(poolAddress)
    if (chainIdVal == null || !poolAddr) return
    try {
      const database = await ensureDb()
      const key = poolKey(chainIdVal, poolAddr)
      const [eventList, rangesRecord] = await Promise.all([
        getEvents(database, chainIdVal, poolAddr),
        getScannedRanges(database, key)
      ])
      eventList.sort((a, b) => a.blockNumber - b.blockNumber)
      events.value = eventList
      scannedRanges.value = rangesRecord?.ranges || []

      // Debug logging
      console.log(`[Nosy DB] Pool: ${poolAddr}`)
      console.log(`[Nosy DB] Events cached: ${eventList.length}`)
      console.log(`[Nosy DB] Ranges:`, rangesRecord?.ranges || [])
      if (eventList.length > 0) {
        console.log(`[Nosy DB] Block range: ${eventList[0].blockNumber} to ${eventList[eventList.length - 1].blockNumber}`)
        const sharesMinted = eventList.filter(e => e.eventName === 'SharesMinted')
        console.log(`[Nosy DB] SharesMinted events: ${sharesMinted.length}`)
      }

      // If pool's Initialized event is cached, scan is already complete
      const hasInitialized = eventList.some((e) => e.eventName === 'Initialized' && e.sourceAddress?.toLowerCase() === poolAddr.toLowerCase())
      if (hasInitialized && scanStatus.value === 'idle') {
        scanStatus.value = 'complete'
      }
    } catch (err) {
      console.error('[usePoolEventScan] loadEventsFromDb', err)
    }
  }

  /** Tip watcher: poll for new blocks and scan forward. */
  async function runTipScan() {
    const client = toValue(publicClient)
    const chainIdVal = toValue(chainId)
    const poolAddr = toValue(poolAddress)
    const operatorAddr = toValue(smartOperatorAddress)
    const vaultAddr = toValue(withdrawalVaultAddress)
    const factoryAddr = toValue(factoryAddress)
    if (!client || chainIdVal == null || !poolAddr || !operatorAddr || !vaultAddr) return
    try {
      const database = await ensureDb()
      const key = poolKey(chainIdVal, poolAddr)
      const currentBlock = Number(await client.getBlockNumber())
      const existing = await getScannedRanges(database, key)
      const existingRanges = existing?.ranges || []
      const maxTo = existingRanges.length > 0 ? Math.max(...existingRanges.map((r) => r.toBlock)) : 0
      if (currentBlock <= maxTo) return
      const fromBlock = maxTo + 1
      const toBlock = currentBlock
      await scanBackwardsBatch(client, chainIdVal, poolAddr, operatorAddr, vaultAddr, factoryAddr, fromBlock, toBlock)
      tipBlocksScanned.value += (toBlock - fromBlock + 1)
      await loadEventsFromDb()
    } catch (err) {
      console.warn('[usePoolEventScan] tip scan failed', err)
    }
  }

  function startTipWatcher() {
    if (tipIntervalId) return
    tipWatcherActive.value = true
    tipIntervalId = setInterval(runTipScan, TIP_POLL_INTERVAL_MS)
  }

  function stopScan() {
    scanAborted = true
    if (tipIntervalId) {
      clearInterval(tipIntervalId)
      tipIntervalId = null
    }
    tipWatcherActive.value = false
    if (scanStatus.value === 'scanning') scanStatus.value = 'idle'
  }

  /**
   * Reset all in-memory state for the current pool and close the DB handle.
   * Intended for debugging; persistent data should be wiped separately via indexedDB.deleteDatabase().
   */
  function resetState() {
    stopScan()
    scanError.value = null
    scanStatus.value = 'idle'
    scannedRanges.value = []
    events.value = []
    lastScannedBlock.value = null
    scanStartBlock.value = null
    tipBlocksScanned.value = 0

    try {
      db?.close?.()
    } catch {
      // ignore
    }
    db = null
  }

  watch([chainId, poolAddress], () => {
    loadEventsFromDb()
  }, { immediate: true })

  onUnmounted(() => {
    stopScan()
  })

  return {
    scanStatus,
    scanError,
    scannedRanges,
    events,
    lastScannedBlock,
    scanStartBlock,
    tipWatcherActive,
    tipBlocksScanned,
    startScan,
    stopScan,
    resetState,
    loadEventsFromDb,
    startTipWatcher
  }
}
