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
            @click="emit('stop-scan')"
          >
            Stop
          </button>
          <button
            v-else-if="scanStatus !== 'complete'"
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="!canScan"
            @click="emit('start-scan')"
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
          <span class="scan-pill-bar" :style="{ width: scanProgressWidth }" />
          <span class="scan-pill-text">{{ scanProgressPercent != null ? Math.round(scanProgressPercent) + '%' : '\u2026' }}</span>
        </span>
      </div>
    </header>

    <!-- Risk Dashboard -->
    <section v-if="nosy" class="risk-dashboard" aria-labelledby="risk-heading">
      <h3 id="risk-heading" class="risk-heading">Risk Dashboard</h3>
      <p v-if="nosy.error" class="risk-error" role="alert">{{ nosy.error }}</p>
      <div v-else class="risk-grid" @keydown.esc="closeMathPopup">
        <RiskCard
          label="Liquidity coverage"
          math-id="math-liquidity-coverage"
          hint="Can the pool pay finalized withdrawals right now without operator action?"
          math="(bufferedAssets + stakingRewardsVault.balance) / allocatedWithdrawalsAmount(pubkey)"
          :show-math="openMathPopup === 'liquidityCoverage'"
          @toggle-math="toggleMathPopup('liquidityCoverage')"
        >
          <span :class="['risk-value', riskLiquidityCoverageClass]">
            {{ liquidityCoverage != null ? liquidityCoverage.toFixed(1) + '%' : '\u2014' }}
          </span>
        </RiskCard>

        <RiskCard
          label="Stake headroom"
          math-id="math-floor-headroom"
          hint="How much room before deposits drop below the validator's effective-balance floor?"
          math="(totalDeposits - minEffectiveBalance) / totalDeposits"
          :show-math="openMathPopup === 'floorHeadroom'"
          @toggle-math="toggleMathPopup('floorHeadroom')"
        >
          <span :class="['risk-value', riskFloorHeadroomClass]">
            {{ floorHeadroomWei != null ? formatWeiCompact(floorHeadroomWei) : '\u2014' }} BERA
            <span class="risk-value-pct">{{ floorHeadroom != null ? '(' + floorHeadroom.toFixed(1) + '%)' : '' }}</span>
          </span>
        </RiskCard>

        <RiskCard
          label="Available liquidity"
          math-id="math-liquidity-sources"
          hint="Liquid BERA available for withdrawals immediately."
          math="bufferedAssets + stakingRewardsVault.balance"
          :show-math="openMathPopup === 'liquiditySources'"
          @toggle-math="toggleMathPopup('liquiditySources')"
        >
          <span class="risk-value">{{ formatWei(availableLiquidity) }} BERA</span>
        </RiskCard>

        <RiskCard
          label="Potential liquidity (BGT)"
          math-id="math-potential-liquidity"
          hint=""
          math="SmartOperator.unboostedBalance()"
          :show-math="openMathPopup === 'potentialLiquidity'"
          @toggle-math="toggleMathPopup('potentialLiquidity')"
        >
          <template #default>
            <span class="risk-value">{{ formatWei(nosy.unboostedBalance) }} BERA</span>
            <span class="risk-hint">BGT worth BERA but trapped behind manual redemption. {{ bgtRedeemed ? 'BGT has been redeemed.' : 'Never redeemed.' }}</span>
          </template>
        </RiskCard>
      </div>
    </section>

    <!-- Accordion sections -->
    <div class="accordions">
      <AccordionItem id="pool" :open="isAccordionOpen('pool')" @toggle="toggleAccordion('pool')">
        <template #title>Pool Financials</template>
        <dl v-if="nosy" class="metric-list">
          <dt>Total assets</dt><dd>{{ formatWei(nosy.totalAssets) }} BERA</dd>
          <dt>Total supply (shares)</dt><dd>{{ formatWei(nosy.totalSupply) }}</dd>
          <dt>Buffered assets</dt><dd>{{ formatWei(nosy.bufferedAssets) }} BERA</dd>
          <dt>Total deposits</dt><dd>{{ formatWei(nosy.totalDeposits) }} BERA</dd>
          <dt>Min effective balance</dt><dd>{{ formatWei(nosy.minEffectiveBalance) }} BERA</dd>
        </dl>
      </AccordionItem>

      <AccordionItem id="bgt" :open="isAccordionOpen('bgt')" @toggle="toggleAccordion('bgt')">
        <template #title>BGT &amp; Rewards</template>
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
                  <td class="calc-label">Less: protocol fee ({{ nosy.protocolFeePercentage != null ? Number(nosy.protocolFeePercentage) / 100 + '%' : '\u2014' }})</td>
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
      </AccordionItem>

      <AccordionItem id="incentive" :open="isAccordionOpen('incentive')" @toggle="toggleAccordion('incentive')">
        <template #title>Incentive Collector</template>
        <div class="incentive-layout">
          <dl v-if="nosy" class="metric-list incentive-metrics">
            <dt>Payout amount</dt><dd>{{ formatWei(nosy.payoutAmount) }} BERA</dd>
            <dt>Queued payout amount</dt><dd>{{ formatWei(nosy.queuedPayoutAmount) }} BERA</dd>
            <dt>Fee percentage</dt><dd>{{ nosy.feePercentage != null ? Number(nosy.feePercentage) / 100 + '%' : '\u2014' }}</dd>
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
      </AccordionItem>

      <AccordionItem id="withdrawal" :open="isAccordionOpen('withdrawal')" @toggle="toggleAccordion('withdrawal')">
        <template #title>Withdrawal Queue</template>
        <dl v-if="nosy" class="metric-list">
          <dt>Allocated withdrawals (this pool)</dt><dd>{{ formatWei(nosy.allocatedWithdrawalsAmount) }} BERA</dd>
          <dt>Request NFTs (total supply)</dt><dd>{{ nosy.withdrawalVaultTotalSupply != null ? String(nosy.withdrawalVaultTotalSupply) : '\u2014' }}</dd>
          <dt>Withdrawal request fee</dt><dd>{{ formatWei(nosy.withdrawalRequestFee) }} BERA</dd>
          <dt>Vault paused</dt><dd>{{ nosy.withdrawalVaultPaused ? 'Yes' : 'No' }}</dd>
        </dl>
      </AccordionItem>

      <AccordionItem
        v-if="nosy && (nosy.delegatedAmount > 0n || nosy.delegatedAmountAvailable > 0n)"
        id="delegation"
        :open="isAccordionOpen('delegation')"
        @toggle="toggleAccordion('delegation')"
      >
        <template #title>Delegation</template>
        <dl class="metric-list">
          <dt>Delegated amount</dt><dd>{{ formatWei(nosy.delegatedAmount) }} BERA</dd>
          <dt>Delegated amount available</dt><dd>{{ formatWei(nosy.delegatedAmountAvailable) }} BERA</dd>
          <dt>Delegated funds pending withdrawal</dt><dd>{{ formatWei(nosy.delegatedFundsPendingWithdrawal) }} BERA</dd>
        </dl>
      </AccordionItem>

      <AccordionItem id="shareholders" :open="isAccordionOpen('shareholders')" @toggle="toggleAccordion('shareholders')">
        <template #title>Shareholders</template>
        <p v-if="!shareholders.length" class="placeholder-text">No shareholders from cached events. Run a scan to backfill.</p>
        <template v-else>
          <div class="shareholders-wrap">
            <table class="shareholders-table" aria-label="Shareholders">
              <thead>
                <tr>
                  <th v-for="col in SHAREHOLDER_COLUMNS" :key="col.key" scope="col">
                    <button
                      type="button"
                      class="th-sort"
                      :aria-sort="sortColumn === col.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined"
                      :aria-label="colAriaLabel(col.key)"
                      @click="setSort(col.key)"
                    >{{ colButtonLabel(col.key) }}</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="s in sortedList"
                  :key="s.address"
                  class="shareholder-row"
                  tabindex="0"
                  role="button"
                  @click="selectedShareholder = s.address"
                  @keydown.enter="selectedShareholder = s.address"
                  @keydown.space.prevent="selectedShareholder = s.address"
                >
                  <td><span class="mono">{{ shortAddr(s.address) }}</span></td>
                  <td>{{ formatWei(s.currentShares) }}</td>
                  <td>{{ formatWei(s.sharesAcquired) }}</td>
                  <td>{{ formatWei(s.sharesDisposed) }}</td>
                  <td>{{ s.firstBlock != null ? s.firstBlock.toLocaleString() : '\u2014' }}</td>
                  <td>{{ s.zeroedBlock != null ? s.zeroedBlock.toLocaleString() : '\u2014' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="shareholders-cards">
            <div
              v-for="s in sortedList"
              :key="'card-' + s.address"
              class="shareholder-card"
              tabindex="0"
              role="button"
              @click="selectedShareholder = s.address"
              @keydown.enter="selectedShareholder = s.address"
              @keydown.space.prevent="selectedShareholder = s.address"
            >
              <div class="card-address mono">{{ shortAddr(s.address) }}</div>
              <dl>
                <dt>Current shares</dt><dd>{{ formatWei(s.currentShares) }}</dd>
                <dt>Acquired</dt><dd>{{ formatWei(s.sharesAcquired) }}</dd>
                <dt>Disposed</dt><dd>{{ formatWei(s.sharesDisposed) }}</dd>
                <dt>First block</dt><dd>{{ s.firstBlock != null ? s.firstBlock.toLocaleString() : '\u2014' }}</dd>
                <dt>Zeroed block</dt><dd>{{ s.zeroedBlock != null ? s.zeroedBlock.toLocaleString() : '\u2014' }}</dd>
              </dl>
            </div>
          </div>
        </template>
      </AccordionItem>

      <AccordionItem id="activity" :open="isAccordionOpen('activity')" @toggle="toggleAccordion('activity')">
        <template #title>Activity Log</template>
        <template #badge>{{ events.length }} events</template>
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
      </AccordionItem>
    </div>

    <!-- Shareholder detail drawer -->
    <ShareholderDrawer
      :address="selectedShareholder"
      :events="drawerEvents"
      :explorer-url="explorerUrl"
      @close="selectedShareholder = null"
    />

    <footer class="nosy-footer" role="contentinfo">
      <div class="footer-row">
        <span class="footer-status">{{ footerStatus }}</span>
        <button
          v-if="hasReset"
          type="button"
          class="btn btn-secondary btn-reset"
          :disabled="isResetting"
          @click="handleReset"
        >
          {{ isResetting ? 'Resetting\u2026' : 'Reset Nosy state' }}
        </button>
      </div>
      <p v-if="resetStatus" class="footer-reset-status" role="status" aria-live="polite">{{ resetStatus }}</p>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { computeShareholderRegistry } from '../utils/shareholderFromEvents.js'
import { formatWei, formatWeiCompact, formatProtocolFee, shortAddr } from '../utils/nosyFormat.js'
import {
  calcAvailableLiquidity,
  calcLiquidityCoverage,
  liquidityCoverageClass,
  calcFloorHeadroomWei,
  calcFloorHeadroom,
  floorHeadroomClass,
  hasBgtRedeemedInEvents
} from '../utils/nosyRisk.js'
import { sortShareholders, nextSortState, sortAriaLabel, sortButtonLabel } from '../utils/nosySort.js'
import RiskCard from '../components/common/RiskCard.vue'
import AccordionItem from '../components/common/AccordionItem.vue'
import ShareholderDrawer from '../components/common/ShareholderDrawer.vue'

const props = defineProps({
  poolAddress: { type: String, default: null },
  explorerUrl: { type: String, default: 'https://berascan.com' },
  scanStatus: { type: String, default: 'idle' },
  scanError: { type: String, default: null },
  events: { type: Array, default: () => [] },
  lastScannedBlock: { type: Number, default: null },
  scanStartBlock: { type: Number, default: null },
  tipWatcherActive: { type: Boolean, default: false },
  tipBlocksScanned: { type: Number, default: 0 },
  canScan: { type: Boolean, default: false },
  nosyData: { type: Object, default: null },
  hasReset: { type: Boolean, default: false }
})

const emit = defineEmits(['start-scan', 'stop-scan', 'start-tip-watcher', 'reset'])

// -- Nosy data unwrap --
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

// -- Scan state --
const isScanning = computed(() => props.scanStatus === 'scanning')

const scanProgressPercent = computed(() => {
  const start = props.scanStartBlock
  const last = props.lastScannedBlock
  if (start == null || last == null || start <= 0) return null
  return Math.min(100, ((start - last) / start) * 100)
})

const scanProgressWidth = computed(() =>
  Math.min(100, Math.max(0, scanProgressPercent.value ?? 0)) + '%'
)

// Auto-start scan on mount; auto-start tip watcher when scan completes
onMounted(() => {
  if (props.canScan && props.scanStatus !== 'complete' && props.scanStatus !== 'scanning') {
    emit('start-scan')
  } else if (props.scanStatus === 'complete' && !props.tipWatcherActive) {
    emit('start-tip-watcher')
  }
})

watch(() => props.scanStatus, (status) => {
  if (status === 'complete' && !props.tipWatcherActive) {
    emit('start-tip-watcher')
  }
})

// -- Risk indicators (delegated to pure functions) --
const availableLiquidity = computed(() => calcAvailableLiquidity(nosy.value))
const liquidityCoverage = computed(() => calcLiquidityCoverage(nosy.value, availableLiquidity.value))
const riskLiquidityCoverageClass = computed(() => liquidityCoverageClass(liquidityCoverage.value))
const floorHeadroomWei = computed(() => calcFloorHeadroomWei(nosy.value))
const floorHeadroom = computed(() => calcFloorHeadroom(nosy.value))
const riskFloorHeadroomClass = computed(() => floorHeadroomClass(floorHeadroom.value))
const bgtRedeemed = computed(() => hasBgtRedeemedInEvents(props.events))

// -- Math popups --
const openMathPopup = ref(null)
function toggleMathPopup(id) { openMathPopup.value = openMathPopup.value === id ? null : id }
function closeMathPopup() { openMathPopup.value = null }

// -- Info popups --
const showRebaseableInfo = ref(false)
const showStakingVaultInfo = ref(false)

// -- Shareholders & sort --
const shareholders = computed(() => computeShareholderRegistry(props.events || []))

const SHAREHOLDER_COLUMNS = [
  { key: 'address' },
  { key: 'currentShares' },
  { key: 'sharesAcquired' },
  { key: 'sharesDisposed' },
  { key: 'firstBlock' },
  { key: 'zeroedBlock' }
]

const sortColumn = ref('currentShares')
const sortDirection = ref('desc')

const sortedList = computed(() => sortShareholders(shareholders.value, sortColumn.value, sortDirection.value))

function setSort(col) {
  const next = nextSortState(sortColumn.value, sortDirection.value, col)
  sortColumn.value = next.column
  sortDirection.value = next.direction
}

function colAriaLabel(col) { return sortAriaLabel(col, sortColumn.value, sortDirection.value) }
function colButtonLabel(col) { return sortButtonLabel(col, sortColumn.value, sortDirection.value) }

// -- Accordions (open by default) --
const closedAccordions = ref(new Set())
function isAccordionOpen(id) { return !closedAccordions.value.has(id) }
function toggleAccordion(id) {
  const next = new Set(closedAccordions.value)
  next.has(id) ? next.delete(id) : next.add(id)
  closedAccordions.value = next
}

// -- Virtualized activity log --
const ACTIVITY_ITEM_HEIGHT = 52
const ACTIVITY_VIEWPORT_HEIGHT = 320
const activityScrollTop = ref(0)

const visibleActivityRange = computed(() => {
  const evts = props.events || []
  const len = evts.length
  if (len === 0) return { start: 0, end: 0, events: [] }
  const start = Math.max(0, Math.floor(activityScrollTop.value / ACTIVITY_ITEM_HEIGHT))
  const end = Math.min(len - 1, Math.ceil((activityScrollTop.value + ACTIVITY_VIEWPORT_HEIGHT) / ACTIVITY_ITEM_HEIGHT) - 1)
  return { start, end, events: evts.slice(start, end + 1) }
})

const activityTotalHeight = computed(() => (props.events?.length || 0) * ACTIVITY_ITEM_HEIGHT)
const activityOffsetY = computed(() => visibleActivityRange.value.start * ACTIVITY_ITEM_HEIGHT)
function onActivityScroll(e) { activityScrollTop.value = e.target?.scrollTop ?? 0 }

// -- Shareholder drawer --
const selectedShareholder = ref(null)

function normAddr(a) {
  if (!a || typeof a !== 'string') return ''
  return a.toLowerCase()
}

const drawerEvents = computed(() => {
  const addr = selectedShareholder.value
  if (!addr) return []
  const key = addr.toLowerCase()
  const filtered = (props.events || []).filter((ev) => {
    const args = ev.args || {}
    switch (ev.eventName) {
      case 'DepositSubmitted': return normAddr(args.receiver) === key
      case 'WithdrawalRequested': return normAddr(args.user) === key
      case 'Transfer': return normAddr(args.from) === key || normAddr(args.to) === key
      default: return false
    }
  })
  return [...filtered].sort((a, b) => (a.blockNumber || 0) - (b.blockNumber || 0))
})

// -- Reset --
const isResetting = ref(false)
const resetStatus = ref(null)

async function handleReset() {
  if (!props.hasReset) return
  const ok = typeof window !== 'undefined'
    ? window.confirm('Reset Nosy browser state? This deletes the nosy-mode IndexedDB cache for all pools in this browser.')
    : true
  if (!ok) return

  isResetting.value = true
  resetStatus.value = null
  try {
    selectedShareholder.value = null
    closedAccordions.value = new Set()
    emit('reset')
    resetStatus.value = 'Nosy state cleared.'
  } catch (e) {
    resetStatus.value = e?.message ?? 'Reset failed.'
  } finally {
    isResetting.value = false
  }
}

// -- Footer --
const footerStatus = computed(() => {
  const tipBlocks = props.tipBlocksScanned > 0 ? ` \u00b7 ${props.tipBlocksScanned} tip blocks` : ''
  if (props.scanStatus === 'scanning') return 'Scanning\u2026'
  if (props.scanStatus === 'complete') return `${props.events?.length ?? 0} events cached${tipBlocks}`
  if (props.scanError) return 'Error'
  return 'Nosy Mode \u2014 event cache for this pool'
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

/* Accordions container */
.accordions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
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

/* Incentive Collector layout */
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

/* BGT & Rewards layout */
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

.placeholder-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin: 0;
}

/* Shareholders table */
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

.shareholders-table td {
  color: var(--color-text-primary);
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

/* Footer */
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

.btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* Responsive */
@media (max-width: 768px) {
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
