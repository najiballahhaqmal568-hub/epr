import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * If a screen breaks, the owner sees plain Dari and a way forward — never a blank page.
 * Nothing is lost: every sale and payment is already in this phone's database before any screen draws.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('screen error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main role="alert" className="error-screen">
        <p className="error-screen-mark" aria-hidden="true">!</p>
        <h1>یک صفحه درست باز نشد</h1>
        <p>معلومات شما در همین موبایل محفوظ است — هیچ فروش، پول یا قرضی گم نشده است.</p>
        <p>«دوباره باز کردن» را بزنید. اگر باز هم همین صفحه آمد، عکس این صفحه را برای کسی که اپ را درست می‌کند بفرستید.</p>
        <button className="primary-button" onClick={() => window.location.reload()}>دوباره باز کردن</button>
        <details>
          <summary>معلومات برای درست‌کننده</summary>
          <pre dir="ltr">{this.state.error.message}</pre>
        </details>
      </main>
    )
  }
}
