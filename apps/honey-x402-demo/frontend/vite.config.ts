import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // Load .env from project root (parent of frontend/)
  envDir: '../',
  // Expose PRIVATE_KEY* env vars to the frontend
  envPrefix: ['VITE_', 'PRIVATE_KEY'],
})
