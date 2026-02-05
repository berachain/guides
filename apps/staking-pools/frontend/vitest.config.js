import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.js', 'tests/unit/**/*.test.js'],
    globals: false
  }
})
