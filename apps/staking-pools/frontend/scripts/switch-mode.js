#!/usr/bin/env node

/**
 * Helper script to switch between single pool and discovery modes
 * Usage: node scripts/switch-mode.js [single|discovery]
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const configPath = join(__dirname, '../public/config.json')

const mode = process.argv[2]

if (!mode || !['single', 'discovery'].includes(mode)) {
  console.error('Usage: node scripts/switch-mode.js [single|discovery]')
  console.error('')
  console.error('Modes:')
  console.error('  single     - Single pool mode (one pool from config.json)')
  console.error('  discovery  - Multi-pool discovery mode (API + on-chain factory discovery)')
  process.exit(1)
}

try {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  
  config.mode = mode
  
  if (mode === 'discovery') {
    // Clear pools for discovery mode
    config.pools = {}
    console.log('✓ Switched to discovery mode')
    console.log('  - Pools will be discovered via api.berachain.com/graphql + on-chain factory calls')
  } else {
    // Single mode - check if pools exist
    if (!config.pools || Object.keys(config.pools).length === 0) {
      console.log('✓ Switched to single pool mode')
      console.log('  ⚠ Warning: No pools configured!')
      console.log('  - Add a pool to the "pools" section in config.json')
      console.log('  - See config.example.json for an example')
    } else {
      console.log('✓ Switched to single pool mode')
      console.log(`  - Using pool: ${Object.keys(config.pools)[0]}`)
    }
  }
  
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  console.log('✓ Updated config.json')
  
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('Error: config.json not found')
    console.error('  Run: cp public/config.example.json public/config.json')
    process.exit(1)
  } else {
    console.error('Error:', err.message)
    process.exit(1)
  }
}
