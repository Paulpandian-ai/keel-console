/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static site: no server component lives in this repo.
export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default; the page tests opt into jsdom with a file docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
