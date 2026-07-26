import { Component, type PropsWithChildren } from 'react';

type State = {
  error: Error | null;
};

/**
 * Last-resort crash screen. Without this, any uncaught render error leaves
 * the app as an unrecoverable white window. Text is intentionally hardcoded
 * bilingual — i18n itself may be what crashed.
 */
export class ErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-[#0a0a0a] px-8 text-gray-200">
        <div className="text-4xl">⚠️</div>
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-lg font-semibold">
            出错了 / Something went wrong
          </div>
          <div className="max-w-xl text-sm text-neutral-500">
            应用遇到未处理的错误。重新加载即可恢复,你的文件不受影响。
          </div>
          <div className="max-w-xl text-sm text-neutral-500">
            The app hit an unhandled error. Reloading recovers it — your files
            are untouched.
          </div>
        </div>
        <pre className="max-h-40 max-w-2xl overflow-auto rounded-lg bg-white/5 px-4 py-3 text-xs text-red-300">
          {this.state.error.message}
          {'\n'}
          {this.state.error.stack?.split('\n').slice(1, 5).join('\n')}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-105"
        >
          重新加载 / Reload
        </button>
      </div>
    );
  }
}
