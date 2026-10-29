import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error: Error | null }
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Guidance / Verify caught an application render error', error, info.componentStack)
  }
  render() {
    if (this.state.error) return (
      <div className="runtime-failure" role="alert" style={{
        maxWidth: 680, margin: '9vh auto', padding: 30,
        background: '#fff', border: '1px solid #d6e6e9', borderRadius: 14,
        color: '#1d3a49', fontFamily: 'system-ui, sans-serif',
      }}>
        <h1 style={{ fontSize: 24, marginBottom: 10 }}>The verification dashboard hit a display error</h1>
        <p style={{ lineHeight: 1.7 }}>
          The site loaded, but a chart or page component could not be displayed.
          Your forecast archives and verification data are unaffected.
        </p>
        <p style={{ margin: '14px 0', fontSize: 12, color: '#5b7480' }}>
          Diagnostic: {this.state.error.message.slice(0, 400)}
        </p>
        <button style={{ border: 0, borderRadius: 8, background: '#1b756f',
          padding: '11px 16px', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
          onClick={() => window.location.reload()}>Reload dashboard</button>
      </div>
    )
    return this.props.children
  }
}
