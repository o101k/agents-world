import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { WorldScreen } from './screens/WorldScreen.tsx';
import { WorldsScreen } from './screens/WorldsScreen.tsx';
import { useApp } from './store.ts';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Agents World UI error:', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="splash" role="alert">
          <div className="splash-title">Something went wrong</div>
          <p className="muted">
            {this.state.error.message || 'An unexpected display error occurred.'}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                useApp.getState().setShowWorldsScreen(true);
                this.setState({ error: null });
              }}
            >
              Back to worlds
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const connection = useApp((s) => s.connection);
  const loaded = useApp((s) => s.loaded);
  const activeWorldId = useApp((s) => s.activeWorldId);
  const showWorldsScreen = useApp((s) => s.showWorldsScreen);

  return (
    <ErrorBoundary>
      {connection === 'offline' && (
        <div className="banner banner-error" role="alert">
          Can’t reach the Agents World helper. Is it running? Start it with <code>npm start</code>{' '}
          in the project folder — this page reconnects automatically.
        </div>
      )}
      {!loaded ? (
        <div className="splash">
          <div className="splash-title">Agents World</div>
          <div className="muted">Connecting to the local helper…</div>
        </div>
      ) : activeWorldId && !showWorldsScreen ? (
        <WorldScreen key={activeWorldId} worldId={activeWorldId} />
      ) : (
        <WorldsScreen />
      )}
      <SettingsDialog />
    </ErrorBoundary>
  );
}
