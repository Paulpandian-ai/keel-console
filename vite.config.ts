/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static site: no server component lives in this repo.
//
// `VITE_BASE_PATH` is the path the site is served under — `/` on a custom
// domain or a Railway static service, `/keel-console/` on GitHub project pages.
// Vite rewrites asset URLs with it, and `main.tsx` hands it to the router.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  test: {
    // Node by default; the page tests opt into jsdom with a file docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
