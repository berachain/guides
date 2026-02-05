# Developer Guide

Quick reference for working with the refactored codebase.

## Getting Started

```bash
# Install dependencies (includes new: vue-router, pinia)
npm install

# Run dev server
npm run dev

# Build for production
npm run build
```

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│ App.vue (Router + Store + Layout)              │
│ - Initializes config, router, store            │
│ - Provides header, navigation, container       │
│ - Handles periodic refresh                     │
└─────────────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼────────┐         ┌────────▼────────┐
│ Vue Router     │         │ Pinia Store     │
│ - Routes       │◄────────│ - State         │
│ - Guards       │         │ - Actions       │
│ - Navigation   │         │ - Computed      │
└────────────────┘         └─────────────────┘
        │                           │
        └─────────────┬─────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼────────┐         ┌────────▼────────┐
│ Views          │         │ Composables     │
│ - StakeView    │         │ - useWallet     │
│ - WithdrawView │         │ - useStaking... │
│ - PoolListView │         │ - useWithdraw.. │
└────────────────┘         └─────────────────┘
```

## Error Handling

### Throwing Errors (in composables)

```javascript
import { ValidationError, PoolStateError, parseError } from '../utils/errors.js'

// Validation errors
if (!amount) {
  throw new ValidationError('Amount is required', 'amount')
}

// Pool state errors
if (pool.isExited) {
  throw new PoolStateError('Pool has exited', poolAddress, 'exited')
}

// Parse raw errors
try {
  await contract.call()
} catch (err) {
  const typedError = parseError(err)
  throw typedError
}
```

### Displaying Errors (in components)

```vue
<script setup>
import { ref } from 'vue'
import { parseError } from '../utils/errors.js'
import ErrorDisplay from '../components/common/ErrorDisplay.vue'

const error = ref(null)

async function doSomething() {
  try {
    // ... operation
  } catch (err) {
    error.value = parseError(err)
  }
}

function retry() {
  error.value = null
  doSomething()
}
</script>

<template>
  <ErrorDisplay 
    :error="error"
    :on-retry="retry"
    @dismiss="error = null"
  />
</template>
```

## Routing

### Navigate Programmatically

```javascript
import { useRouter } from 'vue-router'

const router = useRouter()

// Navigate to discover
router.push({ name: 'discover' })

// Navigate to pool stake view
router.push({
  name: 'stake',
  params: { address: poolAddress },
  query: { pubkey: validatorPubkey }
})

// Navigate to pool withdraw view
router.push({
  name: 'withdraw',
  params: { address: poolAddress },
  query: { pubkey: validatorPubkey }
})
```

### Access Route Params

```javascript
import { useRoute } from 'vue-router'

const route = useRoute()

// Get pool address from URL
const poolAddress = route.params.address

// Get validator pubkey from query
const pubkey = route.query.pubkey
```

### Add New Routes

Edit `src/router/index.js`:

```javascript
const routes = [
  // ... existing routes
  {
    path: '/pool/:address/my-new-view',
    name: 'myNewView',
    component: () => import('../views/MyNewView.vue'),
    meta: { requiresPool: true, requiresConfig: true }
  }
]
```

## Store Usage

### In Components

```javascript
import { usePoolStore } from '../stores/poolStore.js'

const poolStore = usePoolStore()

// Access state
poolStore.config
poolStore.poolAddress
poolStore.wallet.isConnected.value

// Access computed
poolStore.explorerUrl
poolStore.hasSelectedPool

// Call actions
await poolStore.initialize(config)
await poolStore.selectPool(pool)
await poolStore.stake(amount, { resolve, reject })
```

### Adding Store Actions

Edit `src/stores/poolStore.js`:

```javascript
export const usePoolStore = defineStore('pool', () => {
  // ... existing code
  
  async function myNewAction(param) {
    try {
      // Do something with composables
      const result = await pool.someMethod(param)
      
      // Update state if needed
      someState.value = result
      
      return result
    } catch (err) {
      const typedError = parseError(err)
      console.error('My action failed:', typedError)
      throw typedError
    }
  }
  
  return {
    // ... existing exports
    myNewAction
  }
})
```

## Creating New Views

```vue
<!-- src/views/MyNewView.vue -->
<template>
  <div class="my-new-view">
    <h1>{{ poolStore.poolConfig?.name }}</h1>
    <button @click="doSomething">Do Something</button>
  </div>
</template>

<script setup>
import { usePoolStore } from '../stores/poolStore.js'

const poolStore = usePoolStore()

async function doSomething() {
  await poolStore.myNewAction('param')
}
</script>

<style scoped>
.my-new-view {
  padding: var(--space-6);
}
</style>
```

## Common Patterns

### Loading State

```javascript
const isLoading = ref(false)

async function fetchData() {
  isLoading.value = true
  try {
    // ... fetch
  } finally {
    isLoading.value = false
  }
}
```

```vue
<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else>{{ data }}</div>
</template>
```

### Error + Retry Pattern

```javascript
const error = ref(null)

async function operation() {
  error.value = null
  try {
    // ... operation
  } catch (err) {
    error.value = parseError(err)
  }
}

function retry() {
  error.value = null
  operation()
}
```

```vue
<template>
  <ErrorDisplay 
    :error="error"
    :on-retry="retry"
    @dismiss="error = null"
  />
</template>
```

### Wallet Connection Check

```javascript
import { usePoolStore } from '../stores/poolStore.js'

const poolStore = usePoolStore()

async function requiresWallet() {
  if (!poolStore.wallet.isConnected.value) {
    throw new ValidationError('Wallet not connected')
  }
  // ... proceed
}
```

```vue
<template>
  <button 
    v-if="!poolStore.wallet.isConnected.value"
    @click="poolStore.wallet.connect"
  >
    Connect Wallet
  </button>
  <button 
    v-else
    @click="doAction"
  >
    Do Action
  </button>
</template>
```

### Preview Before Action

```javascript
async function handleStake(amount) {
  // Preview first
  const preview = await poolStore.pool.previewDeposit(amount)
  if (!preview.success) {
    error.value = parseError(preview.error)
    return
  }
  
  // Show preview to user
  console.log('Expected shares:', preview.shares)
  
  // Execute
  await poolStore.stake(amount, { resolve, reject })
}
```

## Testing

### Unit Test a Store Action

```javascript
import { setActivePinia, createPinia } from 'pinia'
import { usePoolStore } from '@/stores/poolStore'
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('poolStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stakes successfully', async () => {
    const store = usePoolStore()
    
    // Mock composables
    store.wallet.isConnected.value = true
    store.poolAddress = '0x123'
    
    const mockStake = vi.fn().mockResolvedValue({ hash: '0xabc' })
    store.pool.stake = mockStake
    
    // Execute
    await store.stake('1.0', {
      resolve: vi.fn(),
      reject: vi.fn()
    })
    
    expect(mockStake).toHaveBeenCalledWith('1.0')
  })
})
```

### Component Test with Store

```javascript
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import StakeView from '@/views/StakeView.vue'

describe('StakeView', () => {
  it('displays pool info', () => {
    const wrapper = mount(StakeView, {
      global: {
        plugins: [createPinia()]
      }
    })
    
    // ... assertions
  })
})
```

## Debugging

### Vue DevTools

1. Install Vue DevTools browser extension
2. Open DevTools → Vue tab
3. Pinia tab shows store state, actions, getters
4. Router tab shows current route, navigation history

### Error Tracking

All errors pass through global error handler in `main.js`:

```javascript
app.config.errorHandler = (err, instance, info) => {
  // Errors are logged with full context
  console.error('Unhandled error:', { error, component, info })
}
```

Add error tracking service:

```javascript
import * as Sentry from '@sentry/vue'

app.config.errorHandler = (err, instance, info) => {
  const typedError = parseError(err)
  Sentry.captureException(typedError, { extra: { component, info } })
}
```

## Style Guide

### File Organization

```
src/
├── components/
│   ├── common/           # Shared components
│   ├── stake/            # Stake-specific
│   └── withdraw/         # Withdraw-specific
├── composables/          # Reusable logic
├── constants/            # Constants, addresses
├── router/               # Route definitions
├── stores/               # Pinia stores
├── utils/                # Utilities, errors
└── views/                # Page-level components
```

### Naming Conventions

- **Components:** PascalCase (`StakeCard.vue`)
- **Composables:** camelCase with `use` prefix (`useWallet.js`)
- **Stores:** camelCase with `use` prefix (`usePoolStore.js`)
- **Utils:** camelCase (`parseError`, `formatNumber`)
- **Constants:** SCREAMING_SNAKE_CASE (`ZERO_ADDRESS`)

### Component Structure

```vue
<template>
  <!-- Template -->
</template>

<script setup>
// Imports
import { ref } from 'vue'
import { usePoolStore } from '../stores/poolStore.js'

// Store/composables
const poolStore = usePoolStore()

// Local state
const localState = ref(null)

// Computed
const computed = computed(() => ...)

// Methods
function method() { ... }

// Lifecycle
onMounted(() => { ... })
</script>

<style scoped>
/* Styles */
</style>
```

## Performance Tips

1. **Lazy load routes:** Already done with `() => import()`
2. **Computed properties:** Use computed for derived state
3. **Avoid watchers:** Use computed when possible
4. **Debounce inputs:** Already done in preview functions
5. **Batch updates:** Store actions batch related updates

## Common Pitfalls

### ❌ Don't Access .value in Template

```vue
<!-- Wrong -->
<template>{{ poolStore.wallet.isConnected.value }}</template>

<!-- Right -->
<template>{{ poolStore.wallet.isConnected }}</template>
```

### ❌ Don't Mutate Store State Directly

```javascript
// Wrong
poolStore.poolAddress = '0x123'

// Right
await poolStore.selectPool(pool)
```

### ❌ Don't Forget Error Handling

```javascript
// Wrong
async function stake() {
  await poolStore.stake(amount)
}

// Right
async function stake() {
  try {
    await poolStore.stake(amount, { resolve, reject })
  } catch (err) {
    error.value = parseError(err)
  }
}
```

### ❌ Don't Skip Address Validation

```javascript
// Wrong
const address = route.params.address
await contract.call({ address })

// Right
import { isValidAddress } from '../constants/addresses.js'
const address = route.params.address
if (!isValidAddress(address)) {
  throw new ValidationError('Invalid address')
}
```
