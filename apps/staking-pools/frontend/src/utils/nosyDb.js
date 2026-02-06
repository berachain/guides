/**
 * IndexedDB schema for Nosy Mode: pools, events, scannedRanges.
 * Storage partitioned by chainId:poolAddress. See project/briefs/staking-pool-nosy-mode.md.
 */

import {
  DB_NAME,
  DB_VERSION,
  STORE_POOLS,
  STORE_EVENTS,
  STORE_SCANNED_RANGES
} from '../constants/nosy-mode.js'

/**
 * @returns {Promise<IDBDatabase>}
 */
export function openNosyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result

      if (!db.objectStoreNames.contains(STORE_POOLS)) {
        const pools = db.createObjectStore(STORE_POOLS, { keyPath: 'poolKey' })
        pools.createIndex('byChain', 'chainId', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const events = db.createObjectStore(STORE_EVENTS, { keyPath: 'id', autoIncrement: true })
        events.createIndex('byPool', ['chainId', 'poolAddress'], { unique: false })
        events.createIndex('byPoolBlock', ['chainId', 'poolAddress', 'blockNumber'], { unique: false })
      }

      if (!db.objectStoreNames.contains(STORE_SCANNED_RANGES)) {
        db.createObjectStore(STORE_SCANNED_RANGES, { keyPath: 'poolKey' })
      }
    }
  })
}

/**
 * Delete the Nosy Mode IndexedDB database.
 * Useful for debugging when you want to wipe cached events/ranges.
 *
 * Note: delete can be blocked if another tab or an open connection is holding it.
 * Callers should stop/close any active users of `openNosyDb()` first.
 *
 * @returns {Promise<'success' | 'blocked'>}
 */
export function deleteNosyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve('blocked')
    req.onsuccess = () => resolve('success')
  })
}

/**
 * @param {number} chainId
 * @param {string} poolAddress
 * @returns {string}
 */
export function poolKey(chainId, poolAddress) {
  const addr = typeof poolAddress === 'string' ? poolAddress.toLowerCase() : ''
  return `${chainId}:${addr}`
}

/**
 * @param {IDBDatabase} db
 * @param {string} poolKeyVal
 * @param {{ chainId: number, poolAddress: string, smartOperatorAddress: string, withdrawalVaultAddress: string }} meta
 * @returns {Promise<void>}
 */
export function putPool(db, poolKeyVal, meta) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_POOLS, 'readwrite')
    const store = tx.objectStore(STORE_POOLS)
    const record = { poolKey: poolKeyVal, ...meta, createdAt: Date.now() }
    const req = store.put(record)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * @param {IDBDatabase} db
 * @param {string} poolKeyVal
 * @returns {Promise<{ poolKey: string, chainId: number, poolAddress: string, smartOperatorAddress: string, withdrawalVaultAddress: string } | undefined>}
 */
export function getPool(db, poolKeyVal) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_POOLS, 'readonly')
    const req = tx.objectStore(STORE_POOLS).get(poolKeyVal)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * @param {IDBDatabase} db
 * @param {Array<{ chainId: number, poolAddress: string, blockNumber: number, transactionHash: string, eventName: string, sourceAddress: string, args: Record<string, unknown> }>} events
 * @returns {Promise<void>}
 */
export function putEvents(db, events) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite')
    const store = tx.objectStore(STORE_EVENTS)
    for (const e of events) {
      store.add(e)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * @param {IDBDatabase} db
 * @param {number} chainId
 * @param {string} poolAddress
 * @param {{ fromBlock: number, toBlock: number } | null} range - optional range filter
 * @returns {Promise<Array<{ id?: number, chainId: number, poolAddress: string, blockNumber: number, transactionHash: string, eventName: string, sourceAddress: string, args: Record<string, unknown> }>>}
 */
export function getEvents(db, chainId, poolAddress, range = null) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readonly')
    const index = tx.objectStore(STORE_EVENTS).index('byPool')
    const addr = poolAddress.toLowerCase()
    if (range) {
      // Use byPoolBlock index for range queries
      const blockIndex = tx.objectStore(STORE_EVENTS).index('byPoolBlock')
      const keyRange = IDBKeyRange.bound(
        [chainId, addr, range.fromBlock],
        [chainId, addr, range.toBlock],
        false,
        false
      )
      const req = blockIndex.getAll(keyRange)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    } else {
      // Use byPool index (2-part compound) to get all events for this pool
      const keyRange = IDBKeyRange.only([chainId, addr])
      const req = index.getAll(keyRange)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    }
  })
}

/**
 * @param {IDBDatabase} db
 * @param {string} poolKeyVal
 * @returns {Promise<{ poolKey: string, chainId: number, poolAddress: string, ranges: Array<{ fromBlock: number, toBlock: number }>, updatedAt: number } | undefined>}
 */
export function getScannedRanges(db, poolKeyVal) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SCANNED_RANGES, 'readonly')
    const req = tx.objectStore(STORE_SCANNED_RANGES).get(poolKeyVal)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Merge new range into existing list and consolidate adjacent/overlapping.
 * @param {Array<{ fromBlock: number, toBlock: number }>} existing
 * @param {{ fromBlock: number, toBlock: number }} newRange
 * @returns {Array<{ fromBlock: number, toBlock: number }>}
 */
export function consolidateRanges(existing, newRange) {
  const merged = [...existing, { fromBlock: newRange.fromBlock, toBlock: newRange.toBlock }]
  merged.sort((a, b) => a.fromBlock - b.fromBlock)
  const out = []
  for (const r of merged) {
    if (out.length === 0) {
      out.push({ ...r })
      continue
    }
    const last = out[out.length - 1]
    if (r.fromBlock <= last.toBlock + 1) {
      last.toBlock = Math.max(last.toBlock, r.toBlock)
    } else {
      out.push({ ...r })
    }
  }
  return out
}

/**
 * @param {IDBDatabase} db
 * @param {string} poolKeyVal
 * @param {number} chainId
 * @param {string} poolAddress
 * @param {Array<{ fromBlock: number, toBlock: number }>} ranges
 * @returns {Promise<void>}
 */
export function putScannedRanges(db, poolKeyVal, chainId, poolAddress, ranges) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SCANNED_RANGES, 'readwrite')
    const store = tx.objectStore(STORE_SCANNED_RANGES)
    const record = { poolKey: poolKeyVal, chainId, poolAddress: poolAddress.toLowerCase(), ranges, updatedAt: Date.now() }
    const req = store.put(record)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * Atomic: write events then update scanned ranges in one transaction.
 * Ensures range is only marked scanned after events are committed.
 * @param {IDBDatabase} db
 * @param {Array<{ chainId: number, poolAddress: string, blockNumber: number, transactionHash: string, eventName: string, sourceAddress: string, args: Record<string, unknown> }>} eventsToAdd
 * @param {string} poolKeyVal
 * @param {number} chainId
 * @param {string} poolAddress
 * @param {Array<{ fromBlock: number, toBlock: number }>} ranges
 * @returns {Promise<void>}
 */
export function putEventsAndRanges(db, eventsToAdd, poolKeyVal, chainId, poolAddress, ranges) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_EVENTS, STORE_SCANNED_RANGES], 'readwrite')
    const eventsStore = tx.objectStore(STORE_EVENTS)
    const rangesStore = tx.objectStore(STORE_SCANNED_RANGES)
    for (const e of eventsToAdd) {
      eventsStore.add(e)
    }
    const record = { poolKey: poolKeyVal, chainId, poolAddress: poolAddress.toLowerCase(), ranges, updatedAt: Date.now() }
    rangesStore.put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
