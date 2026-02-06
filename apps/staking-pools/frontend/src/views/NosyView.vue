<template>
  <div class="nosy-view">
    <header class="nosy-header">
      <div class="nosy-header-main">
        <div class="nosy-header-left">
          <h2 class="nosy-title" id="nosy-heading">Nosy Mode</h2>
          <div v-if="nosy" class="status-pills-inline">
            <div class="status-pill-group">
              <span class="status-pill-label">Pool</span>
              <span :class="['pill pill-sm', nosy.poolPaused ? 'pill-warning' : 'pill-ok']">
                {{ nosy.poolPaused ? 'Paused' : (nosy.isFullyExited ? 'Exited' : (nosy.isActive ? 'Active' : 'Inactive')) }}
              </span>
            </div>
            <div class="status-pill-group">
              <span class="status-pill-label">Vault</span>
              <span :class="['pill pill-sm', nosy.withdrawalVaultPaused ? 'pill-warning' : 'pill-ok']">
                {{ nosy.withdrawalVaultPaused ? 'Paused' : 'Active' }}
              </span>
            </div>
          </div>
        </div>
        <div class="nosy-header-actions">
          <button
            v-if="isScanning"
            type="button"
            class="btn btn-sm btn-secondary"
            aria-label="Stop scan"
            @click="stopScan"
          >
            Stop
          </button>
          <button
            v-else-if="scanStatus !== 'complete'"
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="!canScan"
            @click="startScan"
          >
            Scan
          </button>
        </div>
      </div>
      <div v-if="scanError" class="nosy-subheader">
        <span class="scan-error-inline" role="alert">{{ scanError }}</span>
      </div>
      <div v-else-if="isScanning" class="scan-pill-row">
        <span class="scan-pill" role="status" aria-live="polite">
          <span class="scan-pill-bar" :style="{ width: Math.min(100, Math.max(0, scanProgressPercent ?? 0)) + '%' }" />
          <span class="scan-pill-text">{{ scanProgressPercent != null ? Math.round(scanProgressPercent) + '%' : '…' }}</span>
        </span>
      </div>
    </header>

    <!-- Risk Dashboard -->
    <section v-if="nosy" class="risk-dashboard" aria-labelledby="risk-heading">
      <h3 id="risk-heading" class="risk-heading">Risk Dashboard</h3>
      <p v-if="nosy.error" class="risk-error" role="alert">{{ nosy.error }}</p>
      <div v-else class="risk-grid" @keydown.esc="closeMathPopup">
        <div class="risk-card">
          <div class="risk-label-row">
            <span class="risk-label">Liquidity coverage</span>
            <button
              type="button"
              class="info-btn"
              :aria-expanded="openMathPopup === 'liquidityCoverage'"
              aria-controls="math-liquidity-coverage"
              aria-label="Show liquidity coverage math"
              @click="toggleMathPopup('liquidityCoverage')"
            >
              ⓘ
            </button>
          </div>
          <span :class="['risk-value', liquidityCoverageClass]">
            {{ liquidityCoverage != null ? liquidityCoverage.toFixed(1) + '%' : '—' }}
          </span>
          <span class="risk-hint">Can the pool pay finalized withdrawals right now without operator action?</span>
          <div
            v-if="openMathPopup === 'liquidityCoverage'"
            id="math-liquidity-coverage"
            class="info-pop"
            role="note"
          >
            <div class="info-pop-title">Math</div>
            <div class="mono info-pop-body">
              (bufferedAssets + stakingRewardsVault.balance) / allocatedWithdrawalsAmount(pubkey)
            </div>
          </div>
        </div>
        <div class="risk-card">
          <div class="risk-label-row">
            <span class="risk-label">Stake headroom</span>
            <button
              type="button"
              class="info-btn"
              :aria-expanded="openMathPopup === 'floorHeadroom'"
              aria-controls="math-floor-headroom"
              aria-label="Show headroom math"
              @click="toggleMathPopup('floorHeadroom')"
            >
              ⓘ
            </button>
          </div>
          <span :class="['risk-value', floorHeadroomClass]">
            {{ floorHeadroomWei != null ? formatWeiCompact(floorHeadroomWei) : '—' }} BERA
            <span class="risk-value-pct">{{ floorHeadroom != null ? '(' + floorHeadroom.toFixed(1) + '%)' : '' }}</span>
          </span>
          <span class="risk-hint">How much room before deposits drop below the validator's effective-balance floor?</span>
          <div
            v-if="openMathPopup === 'floorHeadroom'"
            id="math-floor-headroom"
            class="info-pop"
            role="note"
          >
            <div class="info-pop-title">Math</div>
            <div class="mono info-pop-body">
              (totalDeposits - minEffectiveBalance) / totalDeposits
            </div>
          </div>
        </div>
        <div class="risk-card">
          <div class="risk-label-row">
            <span class="risk-label">Available liquidity</span>
            <button
              type="button"
              class="info-btn"
              :aria-expanded="openMathPopup === 'liquiditySources'"
              aria-controls="math-liquidity-sources"
              aria-label="Show available liquidity sources"
              @click="toggleMathPopup('liquiditySources')"
            >
              ⓘ
            </button>
          </div>
          <span class="risk-value">{{ formatWei(availableLiquidity) }} BERA</span>
          <span class="risk-hint">Liquid BERA available for withdrawals immediately.</span>
          <div
            v-if="openMathPopup === 'liquiditySources'"
            id="math-liquidity-sources"
            class="info-pop"
            role="note"
          >
            <div class="info-pop-title">Math</div>
            <div class="mono info-pop-body">
              bufferedAssets + stakingRewardsVault.balance
            </div>
          </div>
        </div>
        <div class="risk-card">
          <div class="risk-label-row">
            <span class="risk-label">Potential liquidity (BGT)</span>
            <button
              type="button"
              class="info-btn"
              :aria-expanded="openMathPopup === 'potentialLiquidity'"
              aria-controls="math-potential-liquidity"
              aria-label="Show potential liquidity math"
              @click="toggleMathPopup('potentialLiquidity')"
            >
              ⓘ
            </button>
          </div>
          <span class="risk-value">{{ formatWei(nosy.unboostedBalance) }} BERA</span>
          <span class="risk-hint">BGT worth BERA but trapped behind manual redemption. {{ hasBgtRedeemedInEvents ? 'BGT has been redeemed.' : 'Never redeemed.' }}</span>
          <div
            v-if="openMathPopup === 'potentialLiquidity'"
            id="math-potential-liquidity"
            class="info-pop"
            role="note"
          >
            <div class="info-pop-title">Math</div>
            <div class="mono info-pop-body">
              SmartOperator.unboostedBalance()
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Accordion sections -->
    <div class="accordions">
      <div class="accordion">
        <button
          type="button"
          class="accordion-trigger"
          :aria-expanded="isAccordionOpen('pool')"
          aria-controls="accordion-pool"
          id="accordion-pool-trigger"
          @click="toggleAccordion('pool')"
        >
          Pool Financials
        </button>
        <div id="accordion-pool" class="accordion-panel" role="region" aria-labelledby="accordion-pool-trigger" :hidden="!isAccordionOpen('pool')">
          <dl v-if="nosy" class="metric-list">
            <dt>Total assets</dt><dd>{{ formatWei(nosy.totalAssets) }} BERA</dd>
            <dt>Total supply (shares)</dt><dd>{{ formatWei(nosy.totalSupply) }}</dd>
            <dt>Buffered assets</dt><dd>{{ formatWei(nosy.bufferedAssets) }} BERA</dd>
            <dt>Total deposits</dt><dd>{{ formatWei(nosy.totalDeposits) }} BERA</dd>
            <dt>Min effective balance</dt><dd>{{ formatWei(nosy.minEffectiveBalance) }} BERA</dd>
          </dl>
        </div>
      </div>

      <div class="accordion">
        <button
          type="button"
          class="accordion-trigger"
          :aria-expanded="isAccordionOpen('bgt')"
          aria-controls="accordion-bgt"
          id="accordion-bgt-trigger"
          @click="toggleAccordion('bgt')"
        >
          BGT &amp; Rewards
        </button>
        <div id="accordion-bgt" class="accordion-panel" role="region" aria-labelledby="accordion-bgt-trigger" :hidden="!isAccordionOpen('bgt')">
          <div v-if="nosy" class="bgt-layout">
            <div class="bgt-left">
              <div class="bgt-hero-metric">
                <span class="bgt-hero-value">{{ formatWei(nosy.unboostedBalance) }}</span>
                <span class="bgt-hero-label">Redeemable BGT (unboosted)</span>
              </div>
              <dl class="metric-list bgt-secondary">
                <dt class="has-info">Staking rewards vault <button type="button" class="info-btn" @click="showStakingVaultInfo = !showStakingVaultInfo" aria-label="What is the staking rewards vault?">?</button></dt><dd>{{ formatWei(nosy.stakingRewardsVaultBalance) }} BERA</dd>
              </dl>
              <p v-if="showStakingVaultInfo" class="info-popup">
                Receives redeemed BGT (converted to BERA) and incentive payouts. The validator must configure their CL client's fee recipient to point here for tips/MEV to flow to shareholders. Balance is included in total assets.
              </p>
            </div>
            <div class="bgt-right">
              <table class="rebase-calc">
                <tbody>
                  <tr>
                    <td class="calc-label">BGT held</td>
                    <td class="calc-value">{{ formatWei(nosy.bgtBalanceOfSmartOperator ?? nosy.bgtFeeState?.currentBalance) }}</td>
                  </tr>
                  <tr>
                    <td class="calc-label">Less: protocol fee ({{ nosy.protocolFeePercentage != null ? Number(nosy.protocolFeePercentage) / 100 + '%' : '—' }})</td>
                    <td class="calc-value calc-negative">{{ formatProtocolFee(nosy) }}</td>
                  </tr>
                  <tr class="calc-total">
                    <td class="calc-label has-info">Equals: Rebaseable BGT <button type="button" class="info-btn" @click="showRebaseableInfo = !showRebaseableInfo" aria-label="What is Rebaseable BGT?">?</button></td>
                    <td class="calc-value">{{ formatWei(nosy.rebaseableBgtAmount) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="showRebaseableInfo" class="info-popup">
                BGT held by the SmartOperator minus the protocol fee. This amount is included in the pool's total assets calculation, meaning it "rebases" into the value of stBERA shares.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="accordion">
        <button
          type="button"
          class="accordion-trigger"
          :aria-expanded="isAccordionOpen('incentive')"
          aria-controls="accordion-incentive"
          id="accordion-incentive-trigger"
          @click="toggleAccordion('incentive')"
        >
          Incentive Collector
        </button>
        <div id="accordion-incentive" class="accordion-panel" role="region" aria-labelledby="accordion-incentive-trigger" :hidden="!isAccordionOpen('incentive')">
          <div class="incentive-layout">
            <dl v-if="nosy" class="metric-list incentive-metrics">
              <dt>Payout amount</dt><dd>{{ formatWei(nosy.payoutAmount) }} BERA</dd>
              <dt>Queued payout amount</dt><dd>{{ formatWei(nosy.queuedPayoutAmount) }} BERA</dd>
              <dt>Fee percentage</dt><dd>{{ nosy.feePercentage != null ? Number(nosy.feePercentage) / 100 + '%' : '—' }}</dd>
            </dl>
            <section v-if="nosy?.incentiveTokenBalances?.length" class="incentive-token-section" aria-labelledby="incentive-token-heading">
              <h4 id="incentive-token-heading" class="incentive-token-heading">Token balances</h4>
              <dl class="token-balance-dl">
                <template v-for="tb in nosy.incentiveTokenBalances" :key="tb.address">
                  <dt>{{ tb.name || tb.symbol || shortAddr(tb.address) }}</dt>
                  <dd>{{ formatWei(tb.balance) }}</dd>
                </template>
              </dl>
            </section>
          </div>
        </div>
      </div>

      <div class="accordion">
        <button
          type="button"
          class="accordion-trigger"
          :aria-expanded="isAccordionOpen('withdrawal')"
          aria-controls="accordion-withdrawal"
          id="accordion-withdrawal-trigger"
          @click="toggleAccordion('withdrawal')"
        >
          Withdrawal Queue
        </button>
        <div id="accordion-withdrawal" class="accordion-panel" role="region" aria-labelledby="accordion-withdrawal-trigger" :hidden="!isAccordionOpen('withdrawal')">
          <dl v-if="nosy" class="metric-list">
            <dt>Allocated withdrawals (this pool)</dt><dd>{{ formatWei(nosy.allocatedWithdrawalsAmount) }} BERA</dd>
            <dt>Request NFTs (total supply)</dt><dd>{{ nosy.withdrawalVaultTotalSupply != null ? String(nosy.withdrawalVaultTotalSupply) : '—' }}</dd>
            <dt>Withdrawal request fee</dt><dd>{{ formatWei(nosy.withdrawalRequestFee) }} BERA</dd>
            <dt>Vault paused</dt><dd>{{ nosy.withdrawalVaultPaused ? 'Yes' : 'No' }}</dd>
          </dl>
        </div>
      </div>

      <div v-if="nosy && (nosy.delegatedAmount > 0n || nosy.delegatedAmountAvailable > 0n)" class="accordion">
        <button
          type="button"
          class="accordion-trigger"
          :aria-expanded="isAccordionOpen('delegation')"
          aria-controls="accordion-delegation"
          id="accordion-delegation-trigger"
          @click="toggleAccordion('delegation')"
        >
          Delegation
        </button>
        <div id="accordion-delegation" class="accordion-panel" role="region" aria-labelledby="accordion-delegation-trigger" :hidden="!isAccordionOpen('delegation')">
          <dl class="metric-list">
            <dt>Delegated amount</dt><dd>{{ formatWei(nosy.delegatedAmount) }} BERA</dd>
            <dt>Delegated amount available</dt><dd>{{ formatWei(nosy.delegatedAmountAvailable) }} BERA</dd>
            <dt>Delegated funds pending withdrawal</dt><dd>{{ formatWei(nosy.delegatedFundsPendingWithdrawal) }} BERA</dd>
          </dl>
        </div>
      </div>

      <div class="accordion">
        <button
          type="button"
          class="accordion-trigger"
          :aria-expanded="isAccordionOpen('shareholders')"
          aria-controls="accordion-shareholders"
          id="accordion-shareholders-trigger"
          @click="toggleAccordion('shareholders')"
        >
          Shareholders
        </button>
        <div id="accordion-shareholders" class="accordion-panel" role="region" aria-labelledby="accordion-shareholders-trigger" :hidden="!isAccordionOpen('shareholders')">
          <p v-if="!shareholders.length" class="placeholder-text">No shareholders from cached events. Run a scan to backfill.</p>
          <template v-else>
            <div class="shareholders-wrap">
              <table class="shareholders-table" aria-label="Shareholders">
                <thead>
                  <tr>
                    <th scope="col">
                      <button type="button" class="th-sort" :aria-sort="sortColumn === 'address' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined" :aria-label="sortAriaLabel('address')" @click="setSort('address')">{{ sortButtonLabel('address') }}</button>
                    </th>
                    <th scope="col">
                      <button type="button" class="th-sort" :aria-sort="sortColumn === 'currentShares' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined" :aria-label="sortAriaLabel('currentShares')" @click="setSort('currentShares')">{{ sortButtonLabel('currentShares') }}</button>
                    </th>
                    <th scope="col">
                      <button type="button" class="th-sort" :aria-sort="sortColumn === 'sharesAcquired' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined" :aria-label="sortAriaLabel('sharesAcquired')" @click="setSort('sharesAcquired')">{{ sortButtonLabel('sharesAcquired') }}</button>
                    </th>
                    <th scope="col">
                      <button type="button" class="th-sort" :aria-sort="sortColumn === 'sharesDisposed' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined" :aria-label="sortAriaLabel('sharesDisposed')" @click="setSort('sharesDisposed')">{{ sortButtonLabel('sharesDisposed') }}</button>
                    </th>
                    <th scope="col">
                      <button type="button" class="th-sort" :aria-sort="sortColumn === 'firstBlock' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined" :aria-label="sortAriaLabel('firstBlock')" @click="setSort('firstBlock')">{{ sortButtonLabel('firstBlock') }}</button>
                    </th>
                    <th scope="col">
                      <button type="button" class="th-sort" :aria-sort="sortColumn === 'zeroedBlock' ? sortDirection === 'asc' ? 'ascending' : 'descending' : undefined" :aria-label="sortAriaLabel('zeroedBlock')" @click="setSort('zeroedBlock')">{{ sortButtonLabel('zeroedBlock') }}</button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="s in sortedShareholders"
                    :key="s.address"
                    class="shareholder-row"
                    tabindex="0"
                    role="button"
                    @click="openDrawer(s.address)"
                    @keydown.enter="openDrawer(s.address)"
                    @keydown.space.prevent="openDrawer(s.address)"
                  >
                    <td><span class="mono">{{ shortAddr(s.address) }}</span></td>
                    <td>{{ formatWei(s.currentShares) }}</td>
                    <td>{{ formatWei(s.sharesAcquired) }}</td>
                    <td>{{ formatWei(s.sharesDisposed) }}</td>
                    <td>{{ s.firstBlock != null ? s.firstBlock.toLocaleString() : '—' }}</td>
                    <td>{{ s.zeroedBlock != null ? s.zeroedBlock.toLocaleString() : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="shareholders-cards">
              <div
                v-for="s in sortedShareholders"
                :key="'card-' + s.address"
                class="shareholder-card"
                tabindex="0"
                role="button"
                @click="openDrawer(s.address)"
                @keydown.enter="openDrawer(s.address)"
                @keydown.space.prevent="openDrawer(s.address)"
              >
                <div class="card-address mono">{{ shortAddr(s.address) }}</div>
                <dl>
                  <dt>Current shares</dt><dd>{{ formatWei(s.currentShares) }}</dd>
                  <dt>Acquired</dt><dd>{{ formatWei(s.sharesAcquired) }}</dd>
                  <dt>Disposed</dt><dd>{{ formatWei(s.sharesDisposed) }}</dd>
                  <dt>First block</dt><dd>{{ s.firstBlock != null ? s.firstBlock.toLocaleString() : '—' }}</dd>
                  <dt>Zeroed block</dt><dd>{{ s.zeroedBlock != null ? s.zeroedBlock.toLocaleString() : '—' }}</dd>
                </dl>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div class="accordion">
        <button
          type="button"
          class="accordion-trigger"
          :aria-expanded="isAccordionOpen('activity')"
          aria-controls="accordion-activity"
          id="accordion-activity-trigger"
          @click="toggleAccordion('activity')"
        >
          <span class="accordion-trigger-text">Activity Log</span>
          <span class="accordion-trigger-count">{{ events.length }} events</span>
        </button>
        <div id="accordion-activity" class="accordion-panel" role="region" aria-labelledby="accordion-activity-trigger" :hidden="!isAccordionOpen('activity')">
          <div v-if="events.length > 0" class="activity-virtual-wrap" @scroll="onActivityScroll">
            <div class="activity-virtual-inner" :style="{ minHeight: activityTotalHeight + 'px' }">
              <div class="activity-virtual-window" :style="{ transform: 'translateY(' + activityOffsetY + 'px)' }">
                <div
                  v-for="(ev, i) in visibleActivityRange.events"
                  :key="(ev.id ?? visibleActivityRange.start + i)"
                  class="event-item event-item-fixed"
                  :style="{ height: ACTIVITY_ITEM_HEIGHT + 'px' }"
                >
                  <span class="event-name">{{ ev.eventName }}</span>
                  <span class="event-meta">Block {{ ev.blockNumber }}</span>
                  <a
                    v-if="ev.transactionHash && explorerUrl"
                    :href="`${explorerUrl}/tx/${ev.transactionHash}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="event-tx-link"
                  >
                    View tx
                  </a>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="placeholder-text">No events cached. Start a scan to backfill.</p>
        </div>
      </div>
    </div>

    <!-- Shareholder detail drawer (focus trap: focus stays in drawer until close) -->
    <div
      v-if="selectedShareholder"
      ref="drawerRef"
      class="drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      @keydown.esc="closeDrawer"
      @focusout="onDrawerFocusOut"
    >
      <div class="drawer-panel" tabindex="-1">
        <div class="drawer-header">
          <h3 id="drawer-title" class="drawer-title">Shareholder detail</h3>
          <button
            ref="drawerCloseRef"
            type="button"
            class="drawer-close"
            aria-label="Close drawer"
            @click="closeDrawer"
          >
            ×
          </button>
        </div>
        <p class="drawer-address mono">{{ selectedShareholder }}</p>
        <h4 class="drawer-subtitle">Transaction history</h4>
        <ul v-if="drawerEvents.length > 0" class="drawer-events" aria-label="Events for this address">
          <li v-for="(ev, i) in drawerEvents" :key="i" class="drawer-event-item">
            <span class="event-name">{{ ev.eventName }}</span>
            <span class="event-meta">Block {{ ev.blockNumber }}</span>
            <a
              v-if="ev.transactionHash && explorerUrl"
              :href="`${explorerUrl}/tx/${ev.transactionHash}`"
              target="_blank"
              rel="noopener noreferrer"
              class="event-tx-link"
            >
              View tx
            </a>
          </li>
        </ul>
        <p v-else class="placeholder-text">No events for this address in cache.</p>
      </div>
    </div>

    <footer class="nosy-footer" role="contentinfo">
      <div class="footer-row">
        <span class="footer-status">{{ footerStatus }}</span>
        <button
          v-if="resetNosyBrowserState"
          type="button"
          class="btn btn-secondary btn-reset"
          :disabled="isResetting"
          @click="handleReset"
        >
          {{ isResetting ? 'Resetting…' : 'Reset Nosy state' }}
        </button>
      </div>
      <p v-if="resetStatus" class="footer-reset-status" role="status" aria-live="polite">{{ resetStatus }}</p>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { formatEther } from 'viem'
import { formatBeraDisplay, formatNumber } from '../utils/format.js'
import { computeShareholderRegistry } from '../utils/shareholderFromEvents.js'

const props = defineProps({
  poolAddress: { type: String, default: null },
  explorerUrl: { type: String, default: 'https://berascan.com' },
  scanStatus: { type: String, default: 'idle' },
  scanError: { type: String, default: null },
  scannedRanges: { type: Array, default: () => [] },
  events: { type: Array, default: () => [] },
  lastScannedBlock: { type: Number, default: null },
  scanStartBlock: { type: Number, default: null },
  tipWatcherActive: { type: Boolean, default: false },
  tipBlocksScanned: { type: Number, default: 0 },
  canScan: { type: Boolean, default: false },
  startScan: { type: Function, default: () => {} },
  stopScan: { type: Function, default: () => {} },
  startTipWatcher: { type: Function, default: () => {} },
  nosyData: { type: Object, default: null },
  resetNosyBrowserState: { type: Function, default: null }
})

const isResetting = ref(false)
const resetStatus = ref(null)
const showRebaseableInfo = ref(false)
const showStakingVaultInfo = ref(false)
async function handleReset() {
  if (!props.resetNosyBrowserState) return
  const ok = typeof window !== 'undefined'
    ? window.confirm('Reset Nosy browser state? This deletes the nosy-mode IndexedDB cache for all pools in this browser.')
    : true
  if (!ok) return

  isResetting.value = true
  resetStatus.value = null
  try {
    closeDrawer()
    closedAccordions.value = new Set()
    await props.resetNosyBrowserState()
    resetStatus.value = 'Nosy state cleared.'
  } catch (e) {
    resetStatus.value = e?.message ?? 'Reset failed.'
  } finally {
    isResetting.value = false
  }
}

const isScanning = computed(() => props.scanStatus === 'scanning')

// Auto-start scan on mount if not already complete; auto-start tip watcher when scan completes
onMounted(() => {
  if (props.canScan && props.scanStatus !== 'complete' && props.scanStatus !== 'scanning') {
    props.startScan?.()
  } else if (props.scanStatus === 'complete' && !props.tipWatcherActive) {
    props.startTipWatcher?.()
  }
})

// Auto-start tip watcher when scan completes
watch(() => props.scanStatus, (status) => {
  if (status === 'complete' && !props.tipWatcherActive) {
    props.startTipWatcher?.()
  }
})

const statusText = computed(() => {
  switch (props.scanStatus) {
    case 'scanning':
      if (props.scanStartBlock != null && props.lastScannedBlock != null) {
        const pct = scanProgressPercent.value
        return `Scanning backwards… to block ${props.lastScannedBlock.toLocaleString()} (${pct != null ? Math.round(pct) : 0}%)`
      }
      return 'Scanning backwards…'
    case 'complete':
      return 'Scan complete.'
    case 'error':
      return 'Scan failed.'
    default:
      return 'Idle. Start a scan to cache pool events.'
  }
})

const scanProgressPercent = computed(() => {
  const start = props.scanStartBlock
  const last = props.lastScannedBlock
  if (start == null || last == null || start <= 0) return null
  const blocksScanned = start - last
  return Math.min(100, (blocksScanned / start) * 100)
})

const scanProgressAriaLabel = computed(() => {
  const pct = scanProgressPercent.value
  if (pct == null) return 'Historical scan in progress'
  return `Historical scan ${Math.round(pct)}% — scanned to block ${(props.lastScannedBlock ?? 0).toLocaleString()}`
})

const progressValue = computed(() => {
  const ranges = props.scannedRanges
  if (!ranges?.length) return 0
  const total = ranges.reduce((acc, r) => acc + (r.toBlock - r.fromBlock + 1), 0)
  const maxReasonable = 1_000_000
  return Math.min(100, Math.round((total / maxReasonable) * 100))
})

const progressAriaLabel = computed(() =>
  `Scanned ${props.scannedRanges?.length ?? 0} range(s); ${props.events?.length ?? 0} events cached`
)

const eventsSlice = computed(() => props.events.slice(0, 20))

// Unwrap nosyData refs for template (nosyData is the composable return object with refs).
const nosy = computed(() => {
  const d = props.nosyData
  if (!d) return null
  return {
    isLoading: d.isLoading?.value ?? false,
    error: d.error?.value ?? null,
    totalAssets: d.totalAssets?.value ?? 0n,
    totalSupply: d.totalSupply?.value ?? 0n,
    bufferedAssets: d.bufferedAssets?.value ?? 0n,
    totalDeposits: d.totalDeposits?.value ?? 0n,
    minEffectiveBalance: d.minEffectiveBalance?.value ?? 0n,
    poolPaused: d.poolPaused?.value ?? false,
    isActive: d.isActive?.value ?? false,
    isFullyExited: d.isFullyExited?.value ?? false,
    stakingRewardsVaultBalance: d.stakingRewardsVaultBalance?.value ?? 0n,
    protocolFeePercentage: d.protocolFeePercentage?.value ?? 0n,
    rebaseableBgtAmount: d.rebaseableBgtAmount?.value ?? 0n,
    unboostedBalance: d.unboostedBalance?.value ?? 0n,
    bgtFeeState: d.bgtFeeState?.value ?? null,
    bgtBalanceOfSmartOperator: d.bgtBalanceOfSmartOperator?.value ?? null,
    payoutAmount: d.payoutAmount?.value ?? 0n,
    queuedPayoutAmount: d.queuedPayoutAmount?.value ?? 0n,
    feePercentage: d.feePercentage?.value ?? 0n,
    incentiveTokenBalances: d.incentiveTokenBalances?.value ?? [],
    allocatedWithdrawalsAmount: d.allocatedWithdrawalsAmount?.value ?? 0n,
    withdrawalVaultTotalSupply: d.withdrawalVaultTotalSupply?.value ?? 0n,
    withdrawalRequestFee: d.withdrawalRequestFee?.value ?? 0n,
    withdrawalVaultPaused: d.withdrawalVaultPaused?.value ?? false,
    delegatedAmount: d.delegatedAmount?.value ?? 0n,
    delegatedAmountAvailable: d.delegatedAmountAvailable?.value ?? 0n,
    delegatedFundsPendingWithdrawal: d.delegatedFundsPendingWithdrawal?.value ?? 0n
  }
})

// Risk indicators (brief: liquidity coverage, stake headroom, potential liquidity, BGT redemption, warnings).
const availableLiquidity = computed(() => {
  if (!nosy.value) return 0n
  return nosy.value.bufferedAssets + nosy.value.stakingRewardsVaultBalance
})

const liquidityCoverage = computed(() => {
  if (!nosy.value) return null
  const allocated = nosy.value.allocatedWithdrawalsAmount
  if (allocated === 0n) return null
  const avail = availableLiquidity.value
  return Number((avail * 10000n) / allocated) / 100
})

const liquidityCoverageClass = computed(() => {
  const c = liquidityCoverage.value
  if (c == null) return ''
  if (c < 100) return 'risk-warning'
  if (c < 150) return 'risk-amber'
  return ''
})

const floorHeadroomWei = computed(() => {
  if (!nosy.value) return null
  const td = nosy.value.totalDeposits
  const minEff = nosy.value.minEffectiveBalance
  if (td <= minEff) return 0n
  return td - minEff
})

const floorHeadroom = computed(() => {
  if (!nosy.value) return null
  const td = nosy.value.totalDeposits
  if (td === 0n) return null
  const minEff = nosy.value.minEffectiveBalance
  if (td <= minEff) return 0
  return Number(((td - minEff) * 10000n) / td) / 100
})

const floorHeadroomClass = computed(() => {
  const h = floorHeadroom.value
  if (h == null) return ''
  if (h < 5) return 'risk-warning'
  if (h < 15) return 'risk-amber'
  return ''
})

const hasBgtRedeemedInEvents = computed(() =>
  (props.events || []).some(e => e.eventName === 'BGTRedeemed')
)

// Small (i) popups for “math” on risk cards.
const openMathPopup = ref(null) // string | null
function toggleMathPopup(id) {
  openMathPopup.value = openMathPopup.value === id ? null : id
}
function closeMathPopup() {
  openMathPopup.value = null
}

const shareholders = computed(() => computeShareholderRegistry(props.events || []))

// In-page sort: re-evaluates when shareholders (or sort state) changes.
const sortColumn = ref('currentShares')
const sortDirection = ref('desc') // 'asc' | 'desc'

const sortedShareholders = computed(() => {
  const list = shareholders.value
  if (!list.length) return list
  const col = sortColumn.value
  const dir = sortDirection.value
  const mult = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    let cmp = 0
    if (col === 'address') {
      cmp = (a.address || '').toLowerCase().localeCompare((b.address || '').toLowerCase())
    } else if (col === 'currentShares' || col === 'sharesAcquired' || col === 'sharesDisposed') {
      const va = a[col] ?? 0n
      const vb = b[col] ?? 0n
      cmp = va < vb ? -1 : va > vb ? 1 : 0
    } else {
      const va = a[col] ?? -1
      const vb = b[col] ?? -1
      cmp = va < vb ? -1 : va > vb ? 1 : 0
    }
    return cmp * mult
  })
})

function setSort(col) {
  if (sortColumn.value === col) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = col
    sortDirection.value = col === 'address' ? 'asc' : 'desc'
  }
}

const SORT_LABELS = { address: 'Address', currentShares: 'Current shares', sharesAcquired: 'Acquired', sharesDisposed: 'Disposed', firstBlock: 'First block', zeroedBlock: 'Zeroed block' }
function sortAriaLabel(col) {
  const name = SORT_LABELS[col] || col
  const dir = sortColumn.value === col ? (sortDirection.value === 'asc' ? 'ascending' : 'descending') : 'none'
  return `${name}, sort ${dir}. Click to sort.`
}
function sortButtonLabel(col) {
  const name = SORT_LABELS[col] || col
  if (sortColumn.value !== col) return name
  return sortDirection.value === 'asc' ? `${name} ↑` : `${name} ↓`
}

// All accordions open by default; user can close individually
const closedAccordions = ref(new Set())
function isAccordionOpen(id) {
  return !closedAccordions.value.has(id)
}
function toggleAccordion(id) {
  const next = new Set(closedAccordions.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  closedAccordions.value = next
}

// Virtualized activity log
const ACTIVITY_ITEM_HEIGHT = 52
const ACTIVITY_VIEWPORT_HEIGHT = 320
const activityScrollTop = ref(0)
const visibleActivityRange = computed(() => {
  const events = props.events || []
  const len = events.length
  if (len === 0) return { start: 0, end: 0, events: [] }
  const start = Math.max(0, Math.floor(activityScrollTop.value / ACTIVITY_ITEM_HEIGHT))
  const end = Math.min(len - 1, Math.ceil((activityScrollTop.value + ACTIVITY_VIEWPORT_HEIGHT) / ACTIVITY_ITEM_HEIGHT) - 1)
  return { start, end, events: events.slice(start, end + 1) }
})
const activityTotalHeight = computed(() => (props.events?.length || 0) * ACTIVITY_ITEM_HEIGHT)
const activityOffsetY = computed(() => visibleActivityRange.value.start * ACTIVITY_ITEM_HEIGHT)
function onActivityScroll(e) {
  activityScrollTop.value = e.target?.scrollTop ?? 0
}

// Shareholder detail drawer
const selectedShareholder = ref(null)
const drawerEvents = computed(() => {
  const addr = selectedShareholder.value
  if (!addr) return []
  const key = addr.toLowerCase()
  const events = (props.events || []).filter((ev) => {
    const args = ev.args || {}
    switch (ev.eventName) {
      case 'DepositSubmitted':
        return normAddr(args.receiver) === key
      case 'WithdrawalRequested':
        return normAddr(args.user) === key
      case 'Transfer':
        return normAddr(args.from) === key || normAddr(args.to) === key
      default:
        return false
    }
  })
  return [...events].sort((a, b) => (a.blockNumber || 0) - (b.blockNumber || 0))
})
function normAddr(a) {
  if (!a || typeof a !== 'string') return ''
  return a.toLowerCase()
}
function openDrawer(address) {
  selectedShareholder.value = address
}
const drawerRef = ref(null)
const drawerCloseRef = ref(null)
function closeDrawer() {
  selectedShareholder.value = null
}
watch(selectedShareholder, (addr) => {
  if (addr) {
    setTimeout(() => drawerCloseRef.value?.focus(), 0)
  }
})

function onDrawerFocusOut(e) {
  if (!selectedShareholder.value || !drawerRef.value) return
  const next = e.relatedTarget
  if (next && drawerRef.value.contains(next)) return
  drawerCloseRef.value?.focus()
}

function formatWei(wei) {
  if (wei == null || wei === undefined) return '—'
  const ether = Number(formatEther(wei))
  return formatBeraDisplay(ether) ?? '—'
}

function formatWeiCompact(wei) {
  if (wei == null || wei === undefined) return '—'
  const ether = Number(formatEther(wei))
  return formatNumber(ether, 1)
}

function formatProtocolFee(nosy) {
  if (!nosy) return '—'
  const bgtHeld = nosy.bgtBalanceOfSmartOperator ?? nosy.bgtFeeState?.currentBalance
  const rebaseable = nosy.rebaseableBgtAmount
  if (bgtHeld == null || rebaseable == null) return '—'
  const fee = bgtHeld - rebaseable
  if (fee <= 0n) return '—'
  return '(' + formatWei(fee) + ')'
}

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return ''
  const a = addr.startsWith('0x') ? addr.slice(2) : addr
  if (a.length <= 12) return addr
  return '0x' + a.slice(0, 6) + '…' + a.slice(-4)
}

const footerStatus = computed(() => {
  const tipBlocks = props.tipBlocksScanned > 0 ? ` · ${props.tipBlocksScanned} tip blocks` : ''
  if (props.scanStatus === 'scanning') return 'Scanning…'
  if (props.scanStatus === 'complete') return `${props.events?.length ?? 0} events cached${tipBlocks}`
  if (props.scanError) return 'Error'
  return 'Nosy Mode — event cache for this pool'
})
</script>

<style scoped>
.nosy-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-height: 200px;
}

.has-info {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-bg-muted);
  color: var(--color-text-muted);
  font-size: 0.65rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1;
}

.info-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.info-popup {
  grid-column: 1 / -1;
  padding: var(--space-3);
  margin: var(--space-2) 0;
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: 1.5;
}

.rebase-calc {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.rebase-calc td {
  padding: var(--space-1) 0;
}

.rebase-calc .calc-label {
  color: var(--color-text-muted);
}

.rebase-calc .calc-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.rebase-calc .calc-negative {
  color: var(--color-text-muted);
}

.rebase-calc .calc-total {
  border-top: 1px solid var(--color-border);
}

.rebase-calc .calc-total .calc-label,
.rebase-calc .calc-total .calc-value {
  font-weight: 600;
  padding-top: var(--space-2);
}

.nosy-header {
  margin-bottom: var(--space-4);
}

.nosy-header-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.nosy-header-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.nosy-title {
  font-size: var(--font-size-2xl);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.status-pills-inline {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.status-pill-group {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.status-pill-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.pill-sm {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
}

.nosy-header-actions {
  display: flex;
  gap: var(--space-2);
}

.btn-sm {
  min-height: 32px;
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-size-sm);
}

.nosy-subheader {
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.scan-error-inline {
  color: var(--color-error);
}

.scan-pill-row {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.scan-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 20px;
  padding: 0 var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: var(--color-bg-input);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.scan-pill-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--color-accent);
  opacity: 0.3;
  transition: width 0.2s ease;
}

.scan-pill-text {
  position: relative;
  z-index: 1;
  font-variant-numeric: tabular-nums;
}

.nosy-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.button-row .btn {
  min-height: 44px;
  min-width: 120px;
  padding: var(--space-3) var(--space-4);
}

.btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin: 0;
}


/* Risk Dashboard */
.risk-dashboard {
  padding: var(--space-4);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
}

.risk-heading {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 var(--space-4) 0;
}

.risk-error {
  color: var(--color-error);
  margin: 0;
}

.risk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-4);
}

.risk-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.risk-card.risk-pills {
  flex-direction: row;
  align-items: center;
  gap: var(--space-3);
}

.risk-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.risk-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.info-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  padding: 0 var(--space-2);
  height: 24px;
  border-radius: var(--radius-full);
  cursor: pointer;
  line-height: 1;
}

.info-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
}

.info-btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.info-pop {
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
}

.info-pop-title {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-bottom: var(--space-2);
}

.info-pop-body {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.3;
  word-break: break-word;
}

.risk-value {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
}

.risk-value.risk-warning {
  color: var(--color-error);
}

.risk-value.risk-amber {
  color: var(--color-warning);
}

.risk-value-pct {
  font-size: var(--font-size-sm);
  font-weight: 400;
  color: var(--color-text-muted);
  margin-left: var(--space-1);
}

.risk-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.risk-info {
  margin: 0 0 var(--space-4) 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-secondary);
}

.risk-info-title {
  margin: 0 0 var(--space-2) 0;
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: var(--font-size-sm);
}

.risk-info-list {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.4;
}

.risk-info-key {
  color: var(--color-text-primary);
  font-weight: 600;
  margin-right: var(--space-2);
}

.risk-info-val {
  color: var(--color-text-secondary);
}

.risk-path {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.pill {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.pill-ok {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-success);
}

.pill-warning {
  background: rgba(234, 179, 8, 0.2);
  color: var(--color-warning);
}

/* Accordions */
.accordions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.accordion {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--color-bg-card);
}

.accordion-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  border: none;
  cursor: pointer;
  text-align: left;
  min-height: 44px;
}

.accordion-trigger:hover {
  background: var(--color-bg-card-hover);
}

.accordion-trigger:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.accordion-trigger[aria-expanded="true"]::after {
  content: '−';
}

.accordion-trigger[aria-expanded="false"]::after {
  content: '+';
}

.accordion-trigger-text {
  flex: 1 1 auto;
}

.accordion-trigger-count {
  font-size: var(--font-size-sm);
  font-weight: 400;
  color: var(--color-text-muted);
  margin-right: var(--space-3);
}

.accordion-panel {
  padding: 0 var(--space-4) var(--space-4);
}

.accordion-panel[hidden] {
  display: none;
}

.metric-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-6);
  font-size: var(--font-size-sm);
  margin: 0;
}

.metric-list dt {
  color: var(--color-text-muted);
  font-weight: 400;
}

.metric-list dd {
  margin: 0;
  color: var(--color-text-primary);
}

/* Incentive Collector two-column layout */
.incentive-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-6);
  align-items: start;
}

.incentive-metrics {
  margin: 0;
}

.incentive-token-section {
  margin: 0;
}

.incentive-token-heading {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 0 0 var(--space-2);
}

.token-balance-dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: var(--font-size-sm);
}

.token-balance-dl dt {
  color: var(--color-text-primary);
}

.token-balance-dl dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
}

/* BGT & Rewards hero layout */
.bgt-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-6);
  align-items: start;
}

.bgt-left {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.bgt-right {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.bgt-hero-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--space-4);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  min-width: 180px;
}

.bgt-hero-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.bgt-hero-unit {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin-top: var(--space-1);
}

.bgt-hero-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-top: var(--space-2);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.bgt-secondary {
  margin: 0;
}

.token-balance-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.token-balance-list li {
  padding: var(--space-1) 0;
}

.placeholder-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin: 0;
}

.shareholders-wrap {
  overflow-x: auto;
}

.shareholders-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.shareholders-table th,
.shareholders-table td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

.shareholders-table th {
  color: var(--color-text-muted);
  font-weight: 500;
}

.th-sort {
  display: block;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
}

.th-sort:hover {
  color: var(--color-text-primary);
}

.th-sort:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.discovery-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.shareholders-table td {
  color: var(--color-text-primary);
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, monospace;
}

/* Virtualized activity list */
.activity-virtual-wrap {
  height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.activity-virtual-inner {
  position: relative;
}

.activity-virtual-window {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
}

.event-item-fixed {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  box-sizing: border-box;
}

.shareholder-row {
  cursor: pointer;
}

.shareholder-row:hover {
  background: var(--color-bg-card-hover);
}

.shareholder-row:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

/* Shareholder detail drawer */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: var(--space-4);
}

.drawer-panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  max-width: 480px;
  width: 100%;
  max-height: 80vh;
  overflow: auto;
  padding: var(--space-4);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-3);
}

.drawer-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.drawer-close {
  width: 44px;
  height: 44px;
  border: none;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-size: 1.5rem;
  line-height: 1;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.drawer-close:hover {
  background: var(--color-bg-card-hover);
}

.drawer-close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.drawer-address {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  word-break: break-all;
  margin: 0 0 var(--space-4) 0;
}

.drawer-subtitle {
  font-size: var(--font-size-base);
  font-weight: 600;
  margin: 0 0 var(--space-2) 0;
  color: var(--color-text-primary);
}

.drawer-events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.drawer-event-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.events-heading {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 var(--space-2) 0;
}

.events-count {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-3) 0;
}

.events-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.event-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.event-name {
  font-weight: 500;
  color: var(--color-text-primary);
}

.event-meta {
  color: var(--color-text-muted);
}

.event-tx-link {
  color: var(--color-accent);
  text-decoration: none;
  margin-left: auto;
}

.event-tx-link:hover {
  text-decoration: underline;
}

.event-tx-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.nosy-footer {
  padding: var(--space-3) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.btn-reset {
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
}

.footer-reset-status {
  margin: var(--space-2) 0 0 0;
  color: var(--color-text-secondary);
}

.footer-status {
  font-variant-numeric: tabular-nums;
}

/* Responsive: tablet horizontal scroll on tables is via .shareholders-wrap overflow-x: auto */
@media (max-width: 768px) {
  .nosy-header-row {
    flex-direction: column;
  }

  .status-pills-row {
    margin-top: var(--space-2);
  }

  .button-row {
    flex-direction: column;
    align-items: stretch;
  }

  .button-row .btn {
    width: 100%;
  }

  .risk-grid {
    grid-template-columns: 1fr;
  }

  .incentive-layout {
    grid-template-columns: 1fr;
  }

  .bgt-layout {
    grid-template-columns: 1fr;
  }

  .bgt-hero-metric {
    width: 100%;
  }
}

/* Mobile: card view for shareholders */
@media (max-width: 480px) {
  .shareholders-table {
    display: none;
  }

  .shareholders-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .shareholder-card {
    padding: var(--space-4);
    background: var(--color-bg-secondary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
  }

  .shareholder-card .card-address {
    font-weight: 600;
    margin-bottom: var(--space-2);
    word-break: break-all;
  }

  .shareholder-card dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-4);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  .shareholder-card dt {
    color: var(--color-text-muted);
  }

  .shareholder-card dd {
    margin: 0;
    text-align: right;
  }
}

@media (min-width: 481px) {
  .shareholders-cards {
    display: none;
  }
}
</style>
