import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8 bg-bg">
          <div className="bg-surface-2 border-2 border-border rounded-[5px] p-8 max-w-md w-full flex flex-col items-center gap-5 text-center shadow-brutal">
            <div className="w-12 h-12 rounded-[5px] bg-rose-dim border-2 border-rose flex items-center justify-center">
              <AlertTriangle size={24} className="text-rose" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg text-text-primary mb-1">
                Что-то пошло не так
              </h2>
              <p className="text-sm text-text-muted">
                Произошла непредвиденная ошибка при отображении этого раздела.
              </p>
            </div>
            {this.state.error && (
              <div className="w-full bg-rose-dim border-2 border-rose rounded-[5px] px-4 py-2 text-xs text-rose font-mono text-left break-all">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 rounded-[5px] bg-amber text-black text-sm font-bold uppercase brutal-btn"
            >
              Попробовать снова
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
