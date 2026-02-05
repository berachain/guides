let cachedConfig = null

export async function loadConfig() {
  if (cachedConfig) return cachedConfig
  
  const response = await fetch('/config.json')
  if (!response.ok) {
    throw new Error('Failed to load config.json')
  }
  
  cachedConfig = await response.json()
  return cachedConfig
}

export function getConfig() {
  if (!cachedConfig) {
    throw new Error('Config not loaded. Call loadConfig() first.')
  }
  return cachedConfig
}

export function loadTheme(themeName) {
  if (!themeName || themeName === 'custom') return
  
  // Remove any existing theme link
  const existing = document.getElementById('theme-preset')
  if (existing) {
    existing.remove()
  }
  
  // Load preset theme. Append so it comes after theme.css (injected by Vite from main.js)
  // and after theme-overrides.css, so the preset actually overrides the default accent.
  const link = document.createElement('link')
  link.id = 'theme-preset'
  link.rel = 'stylesheet'
  link.href = `/theme-overrides.example-${themeName}.css`
  document.head.appendChild(link)
}
