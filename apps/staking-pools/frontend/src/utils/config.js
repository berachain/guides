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
  
  // Find theme-overrides.css link to insert preset before it
  const customOverride = document.querySelector('link[href="/theme-overrides.css"]')
  
  // Load preset theme
  const link = document.createElement('link')
  link.id = 'theme-preset'
  link.rel = 'stylesheet'
  link.href = `/theme-overrides.example-${themeName}.css`
  
  // Insert before custom overrides so custom can override preset
  if (customOverride) {
    document.head.insertBefore(link, customOverride)
  } else {
    document.head.appendChild(link)
  }
}
