import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/model-verification-dashboard/' : '/',
  build: { outDir: 'dist', sourcemap: false },
})
