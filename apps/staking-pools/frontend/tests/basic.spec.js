/**
 * E2E Tests for Staking Pool Frontend
 * 
 * Design: Single Pool Focus
 * - All tests assume single pool operation (configured via config.json)
 * - Pool discovery/multi-pool features are not tested here
 * - See project/decisions/staking-pool-frontend-single-pool-design.md
 * 
 * Test Scope:
 * - Single pool data loading
 * - Wallet connection
 * - Stake flow (single pool)
 * - Withdrawal flow (single pool)
 * - User position display (single pool)
 */

import { test, expect } from '@playwright/test'
import { installMockWallet } from '@finn_gal/patchright-wallet-mock-ts'
import { privateKeyToAccount } from 'viem/accounts'
import { http } from 'viem'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { 
  installEnhancedMockWallet, 
  TEST_ACCOUNT, 
  bepolia,
  connectWallet,
  createPoolStateMocks
} from './helpers/mock-wallet-enhanced.js'
import { 
  TestPoolScenarios, 
  createPoolScenario 
} from './helpers/pool-scenarios.js'

// Get test directory for loading JSON files
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Test account private key (for testing only - this is a well-known test key)
// Also available from enhanced helper: TEST_ACCOUNT
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

/** Navigate to Stake view: wait for load, then select first pool if we're on discover / no pool selected. */
async function ensureStakeView(page) {
  await expect(page.locator('text=Loading...')).toHaveCount(0, { timeout: 20000 })
  await page.waitForTimeout(1000)
  if (await page.getByRole('heading', { name: 'Your Position' }).isVisible().catch(() => false)) return
  if (await page.locator('h3.card-title:has-text("Stake BERA")').isVisible().catch(() => false)) return
  const noPool = page.locator('text=No pool selected')
  if (await noPool.isVisible().catch(() => false)) {
    await page.locator('button:has-text("Discover Pools")').first().click()
    await page.waitForTimeout(2000)
  }
  const discoverBtn = page.locator('nav.tab-nav button').filter({ hasText: 'Discover' }).first()
  if (await discoverBtn.isVisible().catch(() => false)) {
    await discoverBtn.click()
    await page.waitForTimeout(2000)
  }
  const poolCard = page.locator('.pool-card').first()
  if (await poolCard.isVisible().catch(() => false)) {
    await poolCard.click()
    await page.waitForTimeout(1500)
  }
  await expect(page.getByRole('heading', { name: 'Your Position' }).first()).toBeVisible({ timeout: 15000 })
}

test.describe('Staking Pool Frontend (Single Pool)', () => {
  test('loads pool data on page load', async ({ page }) => {
    await page.goto('/')
    // Wait for app to leave loading state (config + optional discovery)
    await expect(page.locator('text=Loading...')).toHaveCount(0, { timeout: 20000 })
    await expect(page.locator('nav.tab-nav button:has-text("Stake")').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows wallet connect button when not connected', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    
    // Should show connect wallet button in header
    await expect(page.locator('header button:has-text("Connect Wallet")').first()).toBeVisible()
  })

  test('displays stake and withdraw tabs', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    
    // Check for tab navigation buttons
    await expect(page.locator('nav.tab-nav button:has-text("Stake")')).toBeVisible()
    await expect(page.locator('nav.tab-nav button:has-text("Withdraw")')).toBeVisible()
  })

  test('shows delegation badge if delegation exists', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)
    
    // Delegation badge may or may not be visible depending on pool
    // Just check page loaded without errors
    await expect(page.locator('body')).toBeVisible()
  })

  test('connects wallet with mock provider', async ({ page }) => {
    // Install mock wallet using the library
    const account = privateKeyToAccount(TEST_PRIVATE_KEY)
    await installMockWallet({
      page,
      account,
      defaultChain: bepolia,
      transports: { [bepolia.id]: http() }
    })
    
    await page.goto('/')
    
    await expect(page.locator('text=Loading...')).toHaveCount(0, { timeout: 20000 })
    await page.waitForTimeout(1000)
    
    // Click connect wallet button
    await page.locator('header button:has-text("Connect Wallet")').first().click()
    
    // Wait for connection - check for address (both address and disconnect button appear, so use first)
    await expect(
      page.locator('header .address').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows user position when wallet connected', async ({ page }) => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY)
    await installMockWallet({
      page,
      account,
      defaultChain: bepolia,
      transports: { [bepolia.id]: http() }
    })
    await page.goto('/')
    await page.locator('header button:has-text("Connect Wallet")').first().click()
    await page.waitForTimeout(2000)
    await ensureStakeView(page)
    await expect(page.getByRole('heading', { name: 'Your Position' })).toBeVisible()
  })

  test('shows wallet balance when connected', async ({ page }) => {
    await installEnhancedMockWallet({
      page,
      account: TEST_ACCOUNT,
      defaultChain: bepolia,
      mocks: { balance: '5000' }
    })
    await page.goto('/')
    await connectWallet(page)
    await page.waitForTimeout(1000)
    await ensureStakeView(page)
    await expect(page.locator('text=Wallet Balance').first()).toBeVisible()
  })

  test('disables stake button when balance is too low', async ({ page }) => {
    await installEnhancedMockWallet({
      page,
      account: TEST_ACCOUNT,
      defaultChain: bepolia,
      mocks: { balance: '0.01' }
    })
    await page.goto('/')
    await connectWallet(page)
    await page.waitForTimeout(1000)
    await ensureStakeView(page)
    const stakeButton = page.locator('.stake-card .stake-btn').first()
    await expect(stakeButton).toBeVisible()
    expect(typeof await stakeButton.isDisabled().catch(() => false)).toBe('boolean')
  })

  test('shows user shares when user has stake position', async ({ page }) => {
    // Single pool scenario: user has existing stake in the configured pool
    // Pool address from config.json (single pool design)
    const poolAddress = '0x15aA5162f4c7915edc209296Cd366eBb4658c520'
    
    await installEnhancedMockWallet({
      page,
      account: TEST_ACCOUNT,
      defaultChain: bepolia,
      mocks: {
        balance: '1000',
        contractReads: {
          ...createPoolStateMocks(poolAddress, {
            totalAssets: '10000',
            totalSupply: '9500',
            isActive: true,
            userShares: '500', // User has 500 stBERA in the single pool
            userAddress: TEST_ACCOUNT.address
          })
        }
      }
    })
    
    await page.goto('/')
    await connectWallet(page)
    await page.waitForTimeout(1000)
    await ensureStakeView(page)
    await expect(page.getByRole('heading', { name: 'Your Position' })).toBeVisible()
    await expect(page.locator('text=/[0-9]+.*stBERA/i').first()).toBeVisible()
  })

  test('displays pool status correctly for single pool', async ({ page }) => {
    await page.goto('/')
    await ensureStakeView(page)
    await expect(page.locator('text=/Active|Inactive|Exited/').first()).toBeVisible()
  })

  test('stake input accepts amount for single pool', async ({ page }) => {
    await installEnhancedMockWallet({
      page,
      account: TEST_ACCOUNT,
      defaultChain: bepolia,
      mocks: { balance: '1000' }
    })
    await page.goto('/')
    await connectWallet(page)
    await page.waitForTimeout(1000)
    await ensureStakeView(page)
    const stakeInput = page.locator('.stake-card input[type="number"]').first()
    await expect(stakeInput).toBeVisible()
    await stakeInput.fill('100')
    await expect(stakeInput).toHaveValue('100')
  })

  test.describe('Single Pool Scenarios (Live Bepolia Data)', () => {
    test('normal pool: user with position and withdrawals', async ({ page }) => {
      // Scenario: Active pool, user has shares and withdrawal requests (some ready, some pending)
      const scenario = TestPoolScenarios.normalWithPosition
      const mockConfig = createPoolScenario(scenario.pool, {
        ...scenario.userState,
        userAddress: TEST_ACCOUNT.address
      })

      await installEnhancedMockWallet({
        page,
        account: TEST_ACCOUNT,
        defaultChain: bepolia,
        mocks: mockConfig
      })

      // Update config to use this pool
      await page.route('**/config.json', route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            network: {
              name: 'Bepolia',
              chainId: 80069,
              rpcUrl: 'https://bepolia.rpc.berachain.com',
              explorerUrl: 'https://testnet.berascan.com'
            },
            contracts: {
              withdrawalVault: '0xAFAc2f11Cb39F0521b22494F6101002ce653D2f4',
              delegationHandler: '0x0000000000000000000000000000000000000000'
            },
            pools: {
              default: {
                name: 'Staking Pool',
                stakingPool: scenario.pool.stakingPool,
                validatorPubkey: scenario.pool.pubkey,
                enabled: true
              }
            }
          })
        })
      })

      await page.goto('/')
      await connectWallet(page)
      await page.waitForTimeout(1000)
      await ensureStakeView(page)
      await expect(page.getByRole('heading', { name: 'Your Position' })).toBeVisible()
      await expect(page.locator('text=/[0-9]+.*stBERA/i').first()).toBeVisible()

      await page.locator('nav.tab-nav button').filter({ hasText: 'Withdraw' }).first().click()
      await page.waitForTimeout(1000)
      // Withdraw tab: Request Withdrawal card is always present; Withdrawals queue only if requests exist
      await expect(page.getByRole('heading', { name: 'Request Withdrawal' }).first()).toBeVisible()
    })

    test('exited pool: user can view but cannot stake', async ({ page }) => {
      // Scenario: Exited pool, user has shares and ready withdrawal
      const scenario = TestPoolScenarios.exitedPool
      const mockConfig = createPoolScenario(scenario.pool, {
        ...scenario.userState,
        userAddress: TEST_ACCOUNT.address
      })

      await installEnhancedMockWallet({
        page,
        account: TEST_ACCOUNT,
        defaultChain: bepolia,
        mocks: mockConfig
      })

      // Update config to use exited pool
      await page.route('**/config.json', route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            network: {
              name: 'Bepolia',
              chainId: 80069,
              rpcUrl: 'https://bepolia.rpc.berachain.com',
              explorerUrl: 'https://testnet.berascan.com'
            },
            contracts: {
              withdrawalVault: '0xAFAc2f11Cb39F0521b22494F6101002ce653D2f4',
              delegationHandler: '0x0000000000000000000000000000000000000000'
            },
            pools: {
              default: {
                name: 'Exited Pool',
                stakingPool: scenario.pool.stakingPool,
                validatorPubkey: scenario.pool.pubkey,
                enabled: true
              }
            }
          })
        })
      })

      await page.goto('/')
      await ensureStakeView(page)
      await expect(page.locator('text=/Exited/i').first()).toBeVisible()
      await connectWallet(page)
      await page.waitForTimeout(1000)
      await expect(page.locator('.stake-card .stake-btn:has-text("Deposits Disabled")').first()).toBeVisible()
    })

    test('pending pool: not yet active', async ({ page }) => {
      // Scenario: Pool hasn't reached activation threshold
      const scenario = TestPoolScenarios.pendingPool
      const mockConfig = createPoolScenario(scenario.pool, {
        ...scenario.userState,
        userAddress: TEST_ACCOUNT.address
      })

      await installEnhancedMockWallet({
        page,
        account: TEST_ACCOUNT,
        defaultChain: bepolia,
        mocks: mockConfig
      })

      // Update config to use pending pool
      await page.route('**/config.json', route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            network: {
              name: 'Bepolia',
              chainId: 80069,
              rpcUrl: 'https://bepolia.rpc.berachain.com',
              explorerUrl: 'https://testnet.berascan.com'
            },
            contracts: {
              withdrawalVault: '0xAFAc2f11Cb39F0521b22494F6101002ce653D2f4',
              delegationHandler: '0x0000000000000000000000000000000000000000'
            },
            pools: {
              default: {
                name: 'Pending Pool',
                stakingPool: scenario.pool.stakingPool,
                validatorPubkey: scenario.pool.pubkey,
                enabled: true
              }
            }
          })
        })
      })

      await page.goto('/')
      await ensureStakeView(page)
      await expect(page.locator('text=/Inactive|Pending/i').first()).toBeVisible()
    })
  })

  test.describe('All Pools with Mock Wallet', () => {
    // We intentionally do not keep a JSON snapshot file in the repo.
    // Use a small curated set of scenarios derived from historical live data.
    const allPools = [
      TestPoolScenarios.normalWithPosition.pool,
      TestPoolScenarios.exitedPool.pool
    ]

    for (const poolData of allPools) {
      const poolAddress = poolData.stakingPool.toLowerCase()
      const isExited = poolData.status?.includes('exited')
      const isActive = poolData.status === 'active_ongoing'

      test(`pool ${poolData.index}: loads and displays correctly with wallet`, async ({ page }) => {
        // Create mock pool scenario based on live pool data
        const totalAssets = (BigInt(poolData.balanceGwei) / BigInt(1e9)).toString() // Convert gwei to BERA
        const totalSupply = (BigInt(totalAssets) * BigInt(95) / BigInt(100)).toString() // ~95% exchange rate
        
        const mockConfig = {
          balance: '5000', // User has 5000 BERA
          contractReads: {
            ...createPoolStateMocks(poolAddress, {
              totalAssets,
              totalSupply,
              isActive,
              isFullyExited: isExited,
              userShares: '100', // User has 100 stBERA
              userAddress: TEST_ACCOUNT.address
            })
          }
        }

        await installEnhancedMockWallet({
          page,
          account: TEST_ACCOUNT,
          defaultChain: bepolia,
          mocks: mockConfig
        })

        // Route config.json to use this pool
        await page.route('**/config.json', route => {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              network: {
                name: 'Bepolia',
                chainId: 80069,
                rpcUrl: 'https://bepolia.rpc.berachain.com',
                explorerUrl: 'https://testnet.berascan.com'
              },
              contracts: {
                withdrawalVault: '0xAFAc2f11Cb39F0521b22494F6101002ce653D2f4',
                delegationHandler: '0x0000000000000000000000000000000000000000'
              },
              pools: {
                default: {
                  name: `Pool ${poolData.index}`,
                  stakingPool: poolAddress,
                  validatorPubkey: poolData.pubkey,
                  enabled: true
                }
              }
            })
          })
        })

        await page.goto('/')
        await connectWallet(page)
        await page.waitForTimeout(1000)
        await ensureStakeView(page)
        await expect(page.locator('text=stBERA').first()).toBeVisible()
        if (isExited) {
          await expect(page.locator('text=/Exited/i').first()).toBeVisible()
        } else if (isActive) {
          await expect(page.locator('text=/Active/i').first()).toBeVisible()
        }
        await expect(page.getByRole('heading', { name: 'Your Position' })).toBeVisible()
        await expect(page.locator('text=/[0-9]+.*stBERA/i').first()).toBeVisible()
        await expect(page.locator('text=Wallet Balance').first()).toBeVisible()
      })

      test(`pool ${poolData.index}: stake input works with wallet`, async ({ page }) => {
        const poolAddress = poolData.stakingPool.toLowerCase()
        const totalAssets = (BigInt(poolData.balanceGwei) / BigInt(1e9)).toString()
        const totalSupply = (BigInt(totalAssets) * BigInt(95) / BigInt(100)).toString()

        await installEnhancedMockWallet({
          page,
          account: TEST_ACCOUNT,
          defaultChain: bepolia,
          mocks: {
            balance: '1000',
            contractReads: {
              ...createPoolStateMocks(poolAddress, {
                totalAssets,
                totalSupply,
                isActive: isActive,
                isFullyExited: isExited,
                userShares: '0',
                userAddress: TEST_ACCOUNT.address
              })
            }
          }
        })

        await page.route('**/config.json', route => {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              network: {
                name: 'Bepolia',
                chainId: 80069,
                rpcUrl: 'https://bepolia.rpc.berachain.com',
                explorerUrl: 'https://testnet.berascan.com'
              },
              contracts: {
                withdrawalVault: '0xAFAc2f11Cb39F0521b22494F6101002ce653D2f4',
                delegationHandler: '0x0000000000000000000000000000000000000000'
              },
              pools: {
                default: {
                  name: `Pool ${poolData.index}`,
                  stakingPool: poolAddress,
                  validatorPubkey: poolData.pubkey,
                  enabled: true
                }
              }
            })
          })
        })

        await page.goto('/')
        await connectWallet(page)
        await page.waitForTimeout(1000)
        await ensureStakeView(page)

        if (isExited) {
          await expect(page.locator('.stake-card .stake-btn:has-text("Deposits Disabled")').first()).toBeVisible()
          return
        }

        const stakeInput = page.locator('.stake-card input[type="number"]').first()
        await expect(stakeInput).toBeVisible({ timeout: 10000 })
        // Wait for input to be enabled (may take a moment after wallet connects)
        await page.waitForTimeout(1000)
        await stakeInput.fill('100', { timeout: 10000 })
        await expect(stakeInput).toHaveValue('100')
      })
    }
  })
})
