import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.SMOKE_URL || 'http://127.0.0.1:4173/model-verification-dashboard/'
const errors = []
const logs = []
let server
let browser
let page
let succeeded = false

function insist(value, message) {
  if (!value) throw new Error(message)
}

async function record() {
  await mkdir('diagnostics', { recursive: true })
  await writeFile('diagnostics/browser-smoke.txt', [
    'Real Chromium / Playwright deployment smoke test',
    new Date().toISOString(),
    'Result: ' + (succeeded ? 'PASS' : 'FAIL'),
    'Page: ' + base,
    'JavaScript errors: ' + errors.length,
    ...errors.map((s) => 'ERROR ' + s),
    'Browser and checks:',
    ...logs,
  ].join('\n') + '\n')
  if (!succeeded && page) {
    try { await page.screenshot({ path: 'diagnostics/browser-smoke-failure.png', fullPage: true }) }
    catch (err) { logs.push('Screenshot unavailable: ' + err) }
  }
}

async function main() {
  if (!process.env.SMOKE_URL) server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview',
    '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GITHUB_PAGES: 'true' },
  })
  if (server) server.on('error', e => logs.push('Preview server failed: ' + e))
  if (server) server.stderr.on('data', b => logs.push('Preview: ' + String(b).slice(0, 1200)))
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  page.on('pageerror', error => errors.push(error.stack || String(error)))
  const pageOrigin = new URL(base).origin
  page.on('console', msg => {
    // The browser also emits generic resource errors for optional third-party
    // fonts; capture exact same-origin network failures below instead.
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource'))
      errors.push('console: ' + msg.text())
  })
  page.on('requestfailed', request => {
    if (new URL(request.url()).origin === pageOrigin)
      errors.push('request failed: ' + request.url() + ' ' + (request.failure()?.errorText || 'unknown'))
  })
  page.on('response', response => {
    if (new URL(response.url()).origin === pageOrigin && response.status() >= 400 &&
      /\.(?:js|css|json)(?:\?|$)/.test(response.url()))
      errors.push('HTTP ' + response.status() + ': ' + response.url())
  })

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 4000 })
      if (response?.ok()) break
    } catch (e) {
      if (attempt === 39) throw e
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  // A deployed React app may have valid HTML and still render a completely
  // white screen. Check actual DOM content and surface uncaught JS errors.
  await page.locator('.app-root .page h1').first().waitFor({ state: 'visible', timeout: 16000 })
  insist((await page.locator('.page').innerText()).length > 150,
    'Main application rendered insufficient content — possible blank screen')
  logs.push('Default guidance landing page: rendered')

  await page.getByRole('button', { name: /NBM percentiles/i }).click()
  await page.locator('#qmd-station').waitFor({ state: 'visible' })
  await page.locator('.verification-chart-card').waitFor({ state: 'visible' })
  logs.push('Percentile page: rendered')

  // Wait for active data fetch; the view must be useful, not merely have a
  // blank Recharts canvas. An initial empty state is okay if no cases exist.
  await page.waitForFunction(() => {
    const chart = document.querySelector('.verification-chart-card')
    return Boolean(chart?.querySelector('.recharts-surface') ||
      chart?.querySelector('.verification-chart-empty'))
  }, { timeout: 16000 })
  logs.push('QMD chart or grounded empty state: rendered')

  await page.locator('#qmd-element').selectOption('tmax18')
  await page.locator('#qmd-lead').selectOption('24')
  await page.locator('.verification-chart-card').waitFor({ state: 'visible' })
  logs.push('Daytime maximum selection: rendered')

  await page.getByRole('button', { name: /Compare stations/i }).click()
  await page.locator('.station-table').waitFor({ state: 'visible' })
  logs.push('Station comparison: rendered')

  insist(errors.length === 0, 'Browser reported ' + errors.length + ' JS/asset errors')
  succeeded = true
  logs.push('Browser smoke test completed without uncaught runtime exceptions')
}

try { await main() }
catch (error) {
  errors.push('TEST FAILURE: ' + (error.stack || error))
  process.exitCode = 1
} finally {
  await record()
  if (page) await page.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (server) server.kill('SIGTERM')
}
