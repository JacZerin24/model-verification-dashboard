import React from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './ErrorBoundary'
import './styles.css'

const target = document.getElementById('root')
if (!target) throw new Error('Application mounting element missing')
const root = createRoot(target)

function showStartupError(error: unknown) {
  console.error('Guidance / Verify failed to initialize', error)
  const message = error instanceof Error ? error.message : String(error)
  target!.innerHTML = ''
  const surface = document.createElement('section')
  surface.setAttribute('role', 'alert')
  surface.className = 'runtime-failure'
  surface.style.cssText = 'max-width:680px;margin:9vh auto;padding:30px;border:1px solid #d6e6e9;border-radius:14px;background:#fff;color:#1d3a49;font-family:system-ui,sans-serif'
  const heading = document.createElement('h1')
  heading.textContent = 'The dashboard could not start'
  heading.style.fontSize = '24px'
  const details = document.createElement('p')
  details.textContent = 'A website resource failed to load. Try reloading the page. Diagnostic: ' + message.slice(0, 350)
  details.style.lineHeight = '1.7'
  const button = document.createElement('button')
  button.textContent = 'Reload dashboard'
  button.style.cssText = 'cursor:pointer;border:0;border-radius:8px;background:#1b756f;color:#fff;padding:11px 16px'
  button.addEventListener('click', () => location.reload())
  surface.append(heading, details, button)
  target!.append(surface)
}

// Separating the app module allows us to recover even from a failed JS chunk
// instead of returning an entirely empty body when import evaluation throws.
import('./App').then(({ default: App }) => {
  root.render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>)
}).catch(showStartupError)
