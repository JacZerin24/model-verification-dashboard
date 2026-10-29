import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages is always hosted under this repository prefix. Avoid an
  // environment-dependent base that can produce valid builds with 404 JS files.
  base: '/model-verification-dashboard/',
  build: { outDir: 'dist', sourcemap: false },
})
