import { createApp } from 'vue'
import App from './App.vue'
import './theme.css'
import { parseError } from './utils/errors.js'

const app = createApp(App)

app.config.errorHandler = (err, instance, info) => {
  const parsed = parseError(err)
  console.error('[Vue error]', parsed.summary || parsed.message, { component: instance?.$options?.name ?? instance?.$?.type?.__name, info })
}

app.mount('#app')
