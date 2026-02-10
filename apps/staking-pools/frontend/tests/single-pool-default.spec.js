/**
 * Single Pool Default Loading Test
 * 
 * Verifies that in single-pool mode, the configured pool loads automatically
 * without requiring user interaction or navigation to a discover tab.
 */

import { test, expect } from '@playwright/test'
import { installEnhancedMockWallet, TEST_ACCOUNT, bepolia } from './helpers/mock-wallet-enhanced.js'

test.describe('Single Pool Default Loading', () => {
  test('should load configured pool automatically on page load', async ({ page }) => {
    await installEnhancedMockWallet({
      page,
      account: TEST_ACCOUNT,
      defaultChain: bepolia,
      mocks: {}
    })

    const singlePoolConfig = {
      mode: 'single',
      network: {
        chainId: 80069,
        name: 'Bepolia',
        rpcUrl: 'https://bepolia.rpc.berachain.com',
        explorerUrl: 'https://testnet.berascan.com'
      },
      branding: {
        name: 'Test Pool',
        logo: null,
        theme: null
      },
      contracts: {
        withdrawalVault: '0x1234567890123456789012345678901234567890',
        delegationHandler: '0x2345678901234567890123456789012345678901'
      },
      pools: {
        default: {
          name: 'Test Staking Pool',
          stakingPool: '0x15aA5162f4c7915edc209296Cd366eBb4658c520',
          validatorPubkey: '0xa6ce5adefe9d089ffd772297d77d147beff8fa8bf3c1b5a6b8ff204fc168a026968278214a8dd1624cb5947bb009d70f',
          enabled: true
        }
      }
    }

    await page.route('**/config.json', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(singlePoolConfig)
      })
    })

    await page.goto('/')
    
    // Wait for loading to complete
    await expect(page.locator('text=Loading...')).toHaveCount(0, { timeout: 10000 })
    
    // Should NOT show "No pool selected" or "Discover Pools" button
    await expect(page.locator('text=No pool selected')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /discover pools/i })).toHaveCount(0)
    
    // Should show stake interface with pool loaded
    await expect(page.locator('text=Stake BERA')).toBeVisible()
    
    // Should NOT show Discover tab in single-pool mode
    await expect(page.getByRole('button', { name: /discover/i })).toHaveCount(0)
    
    // Should show Stake and Withdraw tabs only
    await expect(page.getByRole('button', { name: /stake/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /withdraw/i })).toBeVisible()
  })

  test('should load pool when navigating with pubkey in URL', async ({ page }) => {
    await installEnhancedMockWallet({
      page,
      account: TEST_ACCOUNT,
      defaultChain: bepolia,
      mocks: {}
    })

    const singlePoolConfig = {
      mode: 'single',
      network: { chainId: 80069 },
      pools: {
        default: {
          name: 'Test Pool',
          stakingPool: '0x15aA5162f4c7915edc209296Cd366eBb4658c520',
          validatorPubkey: '0xa6ce5adefe9d089ffd772297d77d147beff8fa8bf3c1b5a6b8ff204fc168a026968278214a8dd1624cb5947bb009d70f',
          enabled: true
        }
      }
    }

    await page.route('**/config.json', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(singlePoolConfig)
      })
    })

    // Navigate with pubkey in URL (simulating deep link)
    await page.goto('/?tab=stake&pubkey=0xa6ce5adefe9d089ffd772297d77d147beff8fa8bf3c1b5a6b8ff204fc168a026968278214a8dd1624cb5947bb009d70f')
    
    await expect(page.locator('text=Loading...')).toHaveCount(0, { timeout: 10000 })
    
    // Should load the pool, not show empty state
    await expect(page.locator('text=No pool selected')).toHaveCount(0)
    await expect(page.locator('text=Stake BERA')).toBeVisible()
  })
})
